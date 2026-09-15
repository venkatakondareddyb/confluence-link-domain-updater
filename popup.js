// Baked-in defaults for the automation. Update here if Confluence's DOM
// changes and the automation stops finding the edit/save UI.
const SELECTORS = {
  editBtn: 'button[datalink-id="edit-link"]',
  urlInput: 'input[datatest-id="link-url"]',
  saveBtn: 'button[datalink-id="save-link"]',
};
const STEP_DELAY = 800; // ms between UI steps

const els = {
  matchValue: document.getElementById("matchValue"),
  replaceValue: document.getElementById("replaceValue"),
  scanBtn: document.getElementById("scanBtn"),
  runBtn: document.getElementById("runBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),
  statusLine: document.getElementById("statusLine"),
  logBody: document.getElementById("logBody"),
};

function setStatus(text) {
  els.statusLine.textContent = text || "";
}

async function clearLog() {
  els.logBody.innerHTML = "";
  setStatus("");
  const tab = await getActiveTab();
  await chrome.storage.session.remove(`results:${tab.id}`);
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

function getRowStatus(statusCell) {
  const cls = Array.from(statusCell.classList).find(
    (c) => c.startsWith("status-") && c !== "status-cell"
  );
  return cls ? cls.replace("status-", "") : undefined;
}

function collectRowsData() {
  return Array.from(els.logBody.querySelectorAll("tr")).map((row) => {
    const input = row.querySelector(".updated-url-input");
    const statusCell = row.querySelector(".status-cell");
    return {
      index: parseInt(row.id.replace("log-row-", ""), 10),
      oldUrl: row.dataset.oldUrl,
      newUrl: input.value,
      touched: input.dataset.touched === "1",
      status: getRowStatus(statusCell),
      message: statusCell.title || undefined,
    };
  });
}

async function saveSnapshot() {
  const tab = await getActiveTab();
  await chrome.storage.session.set({
    [`results:${tab.id}`]: {
      statusText: els.statusLine.textContent,
      rows: collectRowsData(),
    },
  });
}

function restoreRow(r) {
  upsertRow({ index: r.index, oldUrl: r.oldUrl, status: r.status, message: r.message });
  const row = document.getElementById(`log-row-${r.index}`);
  const input = row.querySelector(".updated-url-input");
  input.value = r.newUrl;
  if (r.touched) input.dataset.touched = "1";
  autoGrow(input);
}

async function restoreResults() {
  const tab = await getActiveTab();
  const key = `results:${tab.id}`;
  const stored = await chrome.storage.session.get(key);
  const data = stored[key];
  if (!data) return;
  setStatus(data.statusText || "");
  data.rows.forEach(restoreRow);
}

function upsertRow({ index, oldUrl, newUrl, status, message }) {
  let row = document.getElementById(`log-row-${index}`);
  if (!row) {
    row = document.createElement("tr");
    row.id = `log-row-${index}`;
    row.innerHTML = `
      <td>${index + 1}</td>
      <td class="url-cell">
        <div class="original-url"></div>
        <div class="updated-url-row">
          <span class="bullet">↳</span>
          <textarea class="updated-url-input" rows="1"></textarea>
        </div>
      </td>
      <td class="status-cell"></td>
    `;
    els.logBody.appendChild(row);
    const textarea = row.querySelector(".updated-url-input");
    textarea.addEventListener("input", (e) => {
      e.target.dataset.touched = "1";
      autoGrow(e.target);
      saveSnapshot();
    });
  }
  const [, urlCell, statusCell] = row.children;
  const oldDiv = urlCell.querySelector(".original-url");
  const newInput = urlCell.querySelector(".updated-url-input");
  if (oldUrl !== undefined) {
    oldDiv.textContent = oldUrl;
    row.dataset.oldUrl = oldUrl;
  }
  // Don't clobber a value the user already tweaked by hand
  if (newUrl !== undefined && !newInput.dataset.touched) {
    newInput.value = newUrl;
    autoGrow(newInput);
  }
  if (status !== undefined) {
    statusCell.textContent = message || status;
    statusCell.title = message || "";
    statusCell.className = "status-cell status-" + status;
  }
  row.scrollIntoView({ block: "nearest" });
}

function getPlanFromTable() {
  return Array.from(els.logBody.querySelectorAll("tr"))
    .map((row) => ({
      index: parseInt(row.id.replace("log-row-", ""), 10),
      oldUrl: row.dataset.oldUrl,
      newUrl: row.querySelector(".updated-url-input")?.value.trim(),
    }))
    .filter((entry) => entry.oldUrl && entry.newUrl);
}

function setRowsEditable(editable) {
  els.logBody.querySelectorAll(".updated-url-input").forEach((input) => {
    input.disabled = !editable;
  });
}

function getConfig() {
  return {
    matchValue: els.matchValue.value.trim(),
    replaceValue: els.replaceValue.value.trim(),
    selectors: SELECTORS,
    stepDelay: STEP_DELAY,
  };
}

async function restoreSettings() {
  const stored = await chrome.storage.sync.get({
    matchValue: "gitlab.com",
    replaceValue: "gitlab-dedicated.com",
  });
  els.matchValue.value = stored.matchValue;
  els.replaceValue.value = stored.replaceValue;
}

function saveSettings(config) {
  chrome.storage.sync.set({
    matchValue: config.matchValue,
    replaceValue: config.replaceValue,
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.source !== "confluence-link-updater") return;
  if (message.type === "summary") setStatus(message.text);
  else if (message.type === "row") upsertRow(message);
  saveSnapshot();
});

// ---------------------------------------------------------------
// Injected into the page via chrome.scripting.executeScript.
// Runs in an isolated content-script world (chrome.runtime available,
// page's own JS globals are not).
// ---------------------------------------------------------------
function injectedScan(config) {
  const send = (msg) => chrome.runtime.sendMessage({ source: "confluence-link-updater", ...msg });
  const links = Array.from(document.querySelectorAll("a[href]")).filter((a) =>
    a.getAttribute("href").includes(config.matchValue)
  );

  send({ type: "summary", text: `Scan complete: ${links.length} matching link(s) found.` });

  links.forEach((a, index) => {
    const oldUrl = a.getAttribute("href");
    const newUrl = oldUrl.split(config.matchValue).join(config.replaceValue);
    send({ type: "row", index, oldUrl, newUrl, status: "match", message: "match found" });
  });

  return links.length;
}

function injectedRun(config) {
  window.__cluStop = false;

  const send = (msg) => chrome.runtime.sendMessage({ source: "confluence-link-updater", ...msg });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function waitFor(checkFn, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const existing = checkFn();
      if (existing) return resolve(existing);

      let timer;
      const observer = new MutationObserver(() => {
        const el = checkFn();
        if (el) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  function doClick(el, useElementFromPoint) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = useElementFromPoint ? document.elementFromPoint(x, y) || el : el;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      const EventClass = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      target.dispatchEvent(new EventClass(type, opts));
    });
  }

  function findLinkByHref(href) {
    return Array.from(document.querySelectorAll("a[href]")).find(
      (a) => a.getAttribute("href") === href
    );
  }

  async function processEntry(entry) {
    const { index, oldUrl, newUrl } = entry;
    send({ index, status: "pending", type: "row" });

    const link = findLinkByHref(oldUrl);
    if (!link) {
      send({ index, status: "error", message: "link not found on page (did the page change since scan?)", type: "row" });
      return false;
    }

    link.closest('[contenteditable="true"]')?.focus();

    const range = document.createRange();
    range.selectNodeContents(link);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await sleep(150);

    doClick(link, true);

    const editBtn = await waitFor(() => document.querySelector(config.selectors.editBtn));
    if (!editBtn) {
      send({ index, status: "error", message: "edit-link button not found", type: "row" });
      return false;
    }
    doClick(editBtn);

    const urlInput = await waitFor(() => document.querySelector(config.selectors.urlInput));
    if (!urlInput) {
      send({ index, status: "error", message: "url input not found", type: "row" });
      return false;
    }

    urlInput.focus();
    urlInput.setSelectionRange(0, urlInput.value.length);
    document.execCommand("insertText", false, newUrl);
    await sleep(config.stepDelay);

    const saveBtn = await waitFor(() => document.querySelector(config.selectors.saveBtn));
    if (!saveBtn) {
      send({ index, status: "error", message: "save button not found", type: "row" });
      return false;
    }
    doClick(saveBtn);
    await sleep(config.stepDelay);

    send({ index, status: "success", message: "updated", type: "row" });
    return true;
  }

  return (async () => {
    const total = config.plan.length;
    send({ type: "summary", text: `Starting run. ${total} link(s) to update.` });
    let done = 0;

    for (const entry of config.plan) {
      if (window.__cluStop) {
        send({ type: "summary", text: "Stopped by user." });
        break;
      }
      const ok = await processEntry(entry);
      if (!ok) break;
      done++;
    }

    send({ type: "summary", text: `Finished. ${done}/${total} updated. Click Confluence's page Save/Update to publish.` });
  })();
}

// ---------------------------------------------------------------

els.scanBtn.addEventListener("click", async () => {
  const config = getConfig();
  saveSettings(config);
  const tab = await getActiveTab();
  await clearLog();
  setStatus("Scanning page...");
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: injectedScan,
    args: [config],
  });
});

els.runBtn.addEventListener("click", async () => {
  const plan = getPlanFromTable();
  if (plan.length === 0) {
    setStatus("Run a scan first, review/tweak the New URL values, then Run.");
    return;
  }

  const config = getConfig();
  saveSettings(config);
  config.plan = plan;

  const tab = await getActiveTab();
  setRowsEditable(false);
  setStatus("Running...");
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: injectedRun,
    args: [config],
  });
  setRowsEditable(true);
});

els.stopBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => { window.__cluStop = true; },
  });
  setStatus("Stop signal sent.");
});

els.clearBtn.addEventListener("click", async () => {
  await clearLog();
});

restoreSettings();
restoreResults();
