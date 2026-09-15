const SRC = "confluence-link-updater";

// Selectors live in Advanced so a DOM change in Confluence doesn't mean a reinstall.
const DEFAULTS = {
  matchValue: "gitlab.com",
  replaceValue: "gitlab-dedicated.com",
  editBtn: 'button[datalink-id="edit-link"]',
  urlInput: 'input[datatest-id="link-url"]',
  saveBtn: 'button[datalink-id="save-link"]',
  stepDelay: 800,
};

const els = Object.fromEntries(
  [
    "matchValue",
    "replaceValue",
    "editBtn",
    "urlInput",
    "saveBtn",
    "stepDelay",
    "scanBtn",
    "runBtn",
    "stopBtn",
    "clearBtn",
    "resetDefaultsBtn",
    "statusLine",
    "logBody",
  ].map((id) => [id, document.getElementById(id)])
);

let tabId = null;

// --- rendering ---------------------------------------------------------

function setStatus(text) {
  els.statusLine.textContent = text || "";
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

function upsertRow({ index, oldUrl, newUrl, touched, status, message }) {
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
          <textarea class="updated-url-input" rows="1" spellcheck="false"></textarea>
        </div>
      </td>
      <td class="status-cell"></td>
    `;
    els.logBody.appendChild(row);
    row.querySelector(".updated-url-input").addEventListener("input", (e) => {
      e.target.dataset.touched = "1";
      autoGrow(e.target);
      send({ type: "patch", from: "popup", index, newUrl: e.target.value, touched: true });
    });
  }

  const urlCell = row.querySelector(".url-cell");
  const statusCell = row.querySelector(".status-cell");
  const input = urlCell.querySelector(".updated-url-input");

  if (oldUrl !== undefined) {
    urlCell.querySelector(".original-url").textContent = oldUrl;
    row.dataset.oldUrl = oldUrl;
  }
  if (touched) input.dataset.touched = "1";
  if (newUrl !== undefined && (touched || !input.dataset.touched) && input.value !== newUrl) {
    input.value = newUrl;
    autoGrow(input);
  }
  if (status !== undefined) {
    statusCell.textContent = message || status;
    statusCell.title = message || "";
    statusCell.className = "status-cell status-" + status;
    row.scrollIntoView({ block: "nearest" });
  }
}

function setRunning(running) {
  els.scanBtn.disabled = running;
  els.runBtn.disabled = running;
  els.clearBtn.disabled = running;
  els.logBody.querySelectorAll(".updated-url-input").forEach((i) => (i.disabled = running));
}

function render(state) {
  setStatus(state.status);
  Object.values(state.rows)
    .sort((a, b) => a.index - b.index)
    .forEach(upsertRow);
  setRunning(state.running);
}

// --- state / config ----------------------------------------------------

function send(msg) {
  chrome.runtime.sendMessage({ source: SRC, tabId, ...msg }).catch(() => {});
}

function readConfig() {
  const delay = parseInt(els.stepDelay.value, 10);
  return {
    matchValue: els.matchValue.value.trim(),
    replaceValue: els.replaceValue.value.trim(),
    editBtn: els.editBtn.value.trim(),
    urlInput: els.urlInput.value.trim(),
    saveBtn: els.saveBtn.value.trim(),
    stepDelay: Number.isFinite(delay) ? delay : DEFAULTS.stepDelay,
  };
}

function writeConfig(config) {
  Object.keys(DEFAULTS).forEach((k) => (els[k].value = config[k]));
}

function toInjectable(config) {
  return {
    matchValue: config.matchValue,
    replaceValue: config.replaceValue,
    stepDelay: config.stepDelay,
    selectors: { editBtn: config.editBtn, urlInput: config.urlInput, saveBtn: config.saveBtn },
  };
}

async function inject(func, args) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return true;
  } catch (err) {
    setStatus(`Can't run here: ${err.message}`);
    setRunning(false);
    return false;
  }
}

function clearTable() {
  els.logBody.innerHTML = "";
  setStatus("");
}

// --- injected: scan ----------------------------------------------------

function injectedScan(config) {
  const send = (msg) => {
    const p = chrome.runtime.sendMessage({ source: "confluence-link-updater", ...msg });
    if (p?.catch) p.catch(() => {});
  };

  const links = Array.from(document.querySelectorAll("a[href]")).filter((a) =>
    a.getAttribute("href").includes(config.matchValue)
  );

  links.forEach((a, index) => {
    const oldUrl = a.getAttribute("href");
    send({
      type: "row",
      index,
      oldUrl,
      newUrl: oldUrl.split(config.matchValue).join(config.replaceValue),
      status: "match",
      message: "match found",
    });
  });

  send({
    type: "summary",
    text: links.length
      ? `${links.length} matching link(s). Review the new URLs, then Run.`
      : `No links containing "${config.matchValue}". Open the page in edit mode and rescan.`,
  });
}

// --- injected: run -----------------------------------------------------
// Isolated content-script world: chrome.runtime is available, page globals are not.

function injectedRun(config) {
  const send = (msg) => {
    const p = chrome.runtime.sendMessage({ source: "confluence-link-updater", ...msg });
    if (p?.catch) p.catch(() => {});
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (globalThis.__cluRunning) {
    send({ type: "summary", text: "A run is already in progress on this tab." });
    return;
  }
  globalThis.__cluRunning = true;
  globalThis.__cluStop = false;

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

  // Several rows can share an href; never hand the same node out twice.
  const claimed = new WeakSet();
  function findLink(href) {
    return Array.from(document.querySelectorAll("a[href]")).find(
      (a) => a.getAttribute("href") === href && !claimed.has(a)
    );
  }

  function typeInto(input, value) {
    input.focus();
    input.setSelectionRange(0, input.value.length);
    document.execCommand("insertText", false, value);
    if (input.value === value) return;
    // execCommand is on its way out; fall back to the native setter so the
    // editor's React state still sees a real input event.
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function processEntry({ index, oldUrl, newUrl }) {
    send({ type: "row", index, status: "pending", message: "working" });

    const link = findLink(oldUrl);
    if (!link) {
      send({ type: "row", index, status: "error", message: "link not on page — rescan" });
      return { ok: false };
    }
    claimed.add(link);

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
      send({ type: "row", index, status: "error", message: "edit-link button not found" });
      return { ok: false, fatal: true };
    }
    doClick(editBtn);

    const urlInput = await waitFor(() => document.querySelector(config.selectors.urlInput));
    if (!urlInput) {
      send({ type: "row", index, status: "error", message: "url input not found" });
      return { ok: false, fatal: true };
    }
    typeInto(urlInput, newUrl);
    await sleep(config.stepDelay);

    const saveBtn = await waitFor(() => document.querySelector(config.selectors.saveBtn));
    if (!saveBtn) {
      send({ type: "row", index, status: "error", message: "save button not found" });
      return { ok: false, fatal: true };
    }
    doClick(saveBtn);

    // The editor may replace the anchor node rather than mutate it, so accept
    // either the same node updated or a fresh one carrying the new href.
    const escaped = newUrl.replace(/["\\]/g, "\\$&");
    const confirmed = await waitFor(
      () =>
        (link.isConnected && link.getAttribute("href") === newUrl) ||
        document.querySelector(`a[href="${escaped}"]`),
      2000
    );
    await sleep(config.stepDelay);

    if (!confirmed) {
      send({ type: "row", index, status: "warn", message: "saved, href unverified" });
      return { ok: true };
    }
    send({ type: "row", index, status: "success", message: "updated" });
    return { ok: true };
  }

  return (async () => {
    send({ type: "run-state", running: true });
    const total = config.plan.length;
    let done = 0;
    let failed = 0;
    let note = "";

    try {
      for (const entry of config.plan) {
        if (globalThis.__cluStop) {
          note = "Stopped. ";
          break;
        }
        const result = await processEntry(entry);
        result.ok ? done++ : failed++;
        if (result.fatal) {
          // A missing toolbar means the selectors are wrong or the page isn't in
          // edit mode — every remaining row would fail the same way.
          note = "Aborted — check the selectors under Advanced, and that the page is in edit mode. ";
          break;
        }
        send({ type: "summary", text: `Updating… ${done}/${total}` });
      }
      const failures = failed ? `, ${failed} failed` : "";
      send({
        type: "summary",
        text: `${note}${done}/${total} updated${failures}. Now click Confluence's own Update to publish.`,
      });
    } finally {
      globalThis.__cluRunning = false;
      send({ type: "run-state", running: false });
    }
  })();
}

// --- wiring ------------------------------------------------------------

els.scanBtn.addEventListener("click", async () => {
  const config = readConfig();
  await chrome.storage.sync.set(config);
  clearTable();
  send({ type: "reset" });
  setStatus("Scanning…");
  await inject(injectedScan, [toInjectable(config)]);
});

els.runBtn.addEventListener("click", async () => {
  const plan = Array.from(els.logBody.querySelectorAll("tr"))
    .map((row) => ({
      index: parseInt(row.id.replace("log-row-", ""), 10),
      oldUrl: row.dataset.oldUrl,
      newUrl: row.querySelector(".updated-url-input").value.trim(),
    }))
    .filter((e) => e.oldUrl && e.newUrl && e.oldUrl !== e.newUrl);

  if (!plan.length) {
    setStatus("Nothing to update. Scan first, then check the new URLs.");
    return;
  }

  const config = readConfig();
  await chrome.storage.sync.set(config);
  setRunning(true);
  setStatus(`Updating… 0/${plan.length}`);
  await inject(injectedRun, [{ ...toInjectable(config), plan }]);
});

els.stopBtn.addEventListener("click", async () => {
  await inject(() => {
    globalThis.__cluStop = true;
  }, []);
});

els.clearBtn.addEventListener("click", () => {
  clearTable();
  send({ type: "reset" });
});

els.resetDefaultsBtn.addEventListener("click", () => {
  writeConfig(DEFAULTS);
  chrome.storage.sync.set(DEFAULTS);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.source !== SRC || msg.from === "popup") return;
  if (msg.type === "summary") setStatus(msg.text);
  else if (msg.type === "row") upsertRow(msg);
  else if (msg.type === "run-state") setRunning(msg.running);
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  writeConfig(await chrome.storage.sync.get(DEFAULTS));
  const stored = await chrome.storage.session.get(`state:${tabId}`);
  if (stored[`state:${tabId}`]) render(stored[`state:${tabId}`]);
})();
