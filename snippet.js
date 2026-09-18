// Confluence Link Domain Updater — in-page version (no extension required)
//
// Use this when browser extensions are blocked by org policy. Same
// functionality as the extension, running entirely inside the page.
//
// How to run it:
//   1. Open the Confluence page in EDIT mode.
//   2. Open DevTools (F12 / Cmd+Opt+I) → Console tab.
//   3. Paste this whole file and press Enter.
//   A floating panel appears in the top-right corner.
//
// To avoid re-pasting every time:
//   DevTools → Sources tab → Snippets → New snippet → paste this in →
//   run with Cmd+Enter (Mac) / Ctrl+Enter (Windows) whenever you need it.
//
// Re-running this script removes and re-creates the panel, so it's safe
// to run more than once on the same page.

(function () {
  const SELECTORS = {
    editBtn: 'button[datalink-id="edit-link"]',
    urlInput: 'input[datatest-id="link-url"]',
    saveBtn: 'button[datalink-id="save-link"]',
  };
  const STEP_DELAY = 800; // ms between UI steps
  const SETTINGS_KEY = "cluSettings";

  document.getElementById("clu-panel")?.remove();
  document.getElementById("clu-style")?.remove();

  const style = document.createElement("style");
  style.id = "clu-style";
  style.textContent = `
    #clu-panel * { box-sizing: border-box; }
    #clu-panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 560px;
      max-height: 90vh;
      overflow-y: auto;
      z-index: 2147483647;
      padding: 14px;
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
      color: #172b4d;
      background: #f7f8fa;
      border: 1px solid #dcdfe4;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(9, 30, 66, 0.25);
    }
    #clu-panel header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    #clu-panel .clu-logo {
      width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px;
      background: #1868db; display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    #clu-panel h1 { font-size: 14.5px; margin: 0; font-weight: 600; }
    #clu-panel .clu-subtitle { margin: 1px 0 0; font-size: 11px; color: #6b778c; }
    #clu-panel .clu-close {
      margin-left: auto; border: none; background: none; font-size: 18px; line-height: 1;
      color: #6b778c; cursor: pointer; padding: 4px;
    }
    #clu-panel .settings-panel { background: #fff; border: 1px solid #e4e7eb; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
    #clu-panel .match-replace { display: flex; align-items: flex-end; gap: 10px; }
    #clu-panel .input-group { flex: 1; min-width: 0; }
    #clu-panel .input-group label { display: block; font-size: 12px; color: #44546f; margin-bottom: 4px; }
    #clu-panel .separator { padding-bottom: 9px; font-size: 15px; color: #97a0af; }
    #clu-panel input[type="text"] {
      width: 100%; padding: 8px 10px; border: 1px solid #dcdfe4; border-radius: 7px;
      font: 13px "SFMono-Regular", Consolas, monospace; background: #fafbfc;
    }
    #clu-panel input[type="text"]:focus { outline: none; border-color: #1868db; background: #fff; }
    #clu-panel .button-row { display: flex; gap: 6px; margin-bottom: 10px; }
    #clu-panel .button-row button { padding: 9px 0; border: none; border-radius: 7px; font-size: 12.5px; font-weight: 500; cursor: pointer; }
    #clu-panel .secondary-button { flex: 1; background: #ebedf0; color: #172b4d; }
    #clu-panel .primary-button { flex: 1.6; background: #1868db; color: #fff; }
    #clu-panel .danger-button { flex: 0 0 40px; background: #fff; color: #ae2e24; border: 1px solid #ffd5d2; }
    #clu-panel .button-row button:hover { filter: brightness(0.96); }
    #clu-panel .status-message { font-size: 11.5px; color: #44546f; min-height: 14px; margin-bottom: 6px; }
    #clu-panel .results-box { background: #fff; border: 1px solid #e4e7eb; border-radius: 8px; max-height: 240px; overflow-y: auto; }
    #clu-panel .results-table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
    #clu-panel .results-table th {
      position: sticky; top: 0; background: #f4f5f7; color: #6b778c; text-align: left;
      font-size: 10.5px; text-transform: uppercase; padding: 7px 8px; border-bottom: 1px solid #e4e7eb;
    }
    #clu-panel .number-column { width: 24px; }
    #clu-panel .text-column { width: 110px; }
    #clu-panel .status-column { width: 78px; }
    #clu-panel .results-table td { padding: 6px 8px; border-bottom: 1px solid #f1f2f4; vertical-align: top; }
    #clu-panel .results-table tr:last-child td { border-bottom: none; }
    #clu-panel .results-table tr:hover { background: #f7f8fa; }
    #clu-panel .text-cell { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #clu-panel .url-cell { font-family: "SFMono-Regular", Consolas, monospace; font-size: 10.8px; line-height: 1.5; word-break: break-all; }
    #clu-panel .original-url { color: #97a0af; text-decoration: line-through; }
    #clu-panel .updated-url-row { display: flex; align-items: flex-start; gap: 5px; margin-top: 3px; }
    #clu-panel .bullet { color: #97a0af; }
    #clu-panel .updated-url-input {
      flex: 1; min-width: 0; border: none; border-bottom: 1px dashed #c1c7d0; background: transparent;
      font: inherit; font-weight: 600; color: #172b4d; padding: 1px 0 2px; word-break: break-all;
      resize: none; overflow: hidden; line-height: 1.5;
    }
    #clu-panel .updated-url-input:focus { outline: none; border-bottom: 1px solid #1868db; }
    #clu-panel .updated-url-input:disabled { color: #6b778c; border-bottom-color: transparent; }
    #clu-panel .status-cell { font-weight: 600; font-size: 10.5px; white-space: nowrap; }
    #clu-panel .status-pending { color: #974f0c; }
    #clu-panel .status-success { color: #1f845c; }
    #clu-panel .status-error { color: #ae2e24; }
    #clu-panel .status-match { color: #1868db; }
    #clu-panel .no-results { padding: 18px 10px; text-align: center; font-size: 11.5px; color: #97a0af; }
    #clu-panel .results-box:has(#clu-logBody:empty) .no-results { display: block; }
    #clu-panel .results-box:not(:has(#clu-logBody:empty)) .no-results { display: none; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "clu-panel";
  panel.innerHTML = `
    <header>
      <div class="clu-logo">🔗</div>
      <div>
        <h1>Link Updater</h1>
        <p class="clu-subtitle">for Confluence editor links</p>
      </div>
      <button class="clu-close" title="Close">✕</button>
    </header>

    <div class="settings-panel">
      <div class="match-replace">
        <div class="input-group">
          <label>Matched text</label>
          <input type="text" id="clu-matchValue" placeholder="gitlab.com" />
        </div>
        <div class="separator">→</div>
        <div class="input-group">
          <label>Replace with</label>
          <input type="text" id="clu-replaceValue" placeholder="gitlab-dedicated.com" />
        </div>
      </div>
    </div>

    <div class="button-row">
      <button id="clu-scanBtn" class="secondary-button">🔍 Scan</button>
      <button id="clu-runBtn" class="primary-button">▶ Run</button>
      <button id="clu-stopBtn" class="danger-button">⏹</button>
      <button id="clu-clearBtn" class="secondary-button">🧹 Clear</button>
    </div>

    <div id="clu-statusLine" class="status-message"></div>

    <div class="results-box">
      <table class="results-table">
        <thead>
          <tr>
            <th class="number-column">#</th>
            <th class="text-column">Link text</th>
            <th>URL change</th>
            <th class="status-column">Status</th>
          </tr>
        </thead>
        <tbody id="clu-logBody"></tbody>
      </table>
      <div id="clu-logEmpty" class="no-results">Ready. Fill in the fields above and hit Scan or Run.</div>
    </div>
  `;
  document.body.appendChild(panel);

  const els = {
    matchValue: panel.querySelector("#clu-matchValue"),
    replaceValue: panel.querySelector("#clu-replaceValue"),
    scanBtn: panel.querySelector("#clu-scanBtn"),
    runBtn: panel.querySelector("#clu-runBtn"),
    stopBtn: panel.querySelector("#clu-stopBtn"),
    clearBtn: panel.querySelector("#clu-clearBtn"),
    closeBtn: panel.querySelector(".clu-close"),
    statusLine: panel.querySelector("#clu-statusLine"),
    logBody: panel.querySelector("#clu-logBody"),
  };

  // Single source of truth. Every row carries a direct reference to the
  // anchor element it came from (`link`), so Run operates on that exact
  // node instead of re-searching the page by href — safe even when
  // several links on the page share the same href.
  const state = {
    matchValue: "",
    replaceValue: "",
    rows: [],
    stopRequested: false,
  };

  function setStatus(text) {
    els.statusLine.textContent = text || "";
  }

  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  function renderRow(entry) {
    let row = panel.querySelector(`#clu-row-${entry.index}`);
    if (!row) {
      row = document.createElement("tr");
      row.id = `clu-row-${entry.index}`;
      row.innerHTML = `
        <td>${entry.index + 1}</td>
        <td class="text-cell"></td>
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
        entry.touched = true;
        entry.newUrl = e.target.value;
        autoGrow(e.target);
      });
    }

    const [, textCell, urlCell, statusCell] = row.children;
    const oldDiv = urlCell.querySelector(".original-url");
    const newInput = urlCell.querySelector(".updated-url-input");

    textCell.textContent = entry.linkText;
    textCell.title = entry.linkText;

    oldDiv.textContent = entry.oldUrl;
    row.dataset.oldUrl = entry.oldUrl;

    // Don't clobber a value the user already tweaked by hand
    if (!entry.touched && newInput.value !== entry.newUrl) {
      newInput.value = entry.newUrl;
      autoGrow(newInput);
    }

    statusCell.textContent = entry.message || entry.status || "";
    statusCell.title = entry.message || "";
    statusCell.className = "status-cell" + (entry.status ? " status-" + entry.status : "");

    row.scrollIntoView({ block: "nearest" });
  }

  function setRowStatus(entry, status, message) {
    entry.status = status;
    entry.message = message;
    renderRow(entry);
  }

  function setRowsEditable(editable) {
    els.logBody.querySelectorAll(".updated-url-input").forEach((input) => {
      input.disabled = !editable;
    });
  }

  function syncConfigFromInputs() {
    state.matchValue = els.matchValue.value.trim();
    state.replaceValue = els.replaceValue.value.trim();
  }

  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {}
    state.matchValue = saved.matchValue ?? "gitlab.com";
    state.replaceValue = saved.replaceValue ?? "gitlab-dedicated.com";
    els.matchValue.value = state.matchValue;
    els.replaceValue.value = state.replaceValue;
  }

  function saveSettings() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ matchValue: state.matchValue, replaceValue: state.replaceValue })
    );
  }

  function clearLog() {
    state.rows = [];
    els.logBody.innerHTML = "";
    setStatus("");
  }

  function scan() {
    syncConfigFromInputs();
    saveSettings();
    clearLog();
    setStatus("Scanning page...");

    const links = Array.from(document.querySelectorAll("a[href]")).filter((a) =>
      a.getAttribute("href").includes(state.matchValue)
    );

    state.rows = links.map((link, index) => {
      const oldUrl = link.getAttribute("href");
      return {
        index,
        link, // the actual anchor element — Run acts on this, not on a re-lookup by href
        oldUrl,
        newUrl: oldUrl.split(state.matchValue).join(state.replaceValue),
        linkText: link.textContent.trim(),
        touched: false,
        status: "match",
        message: "match found",
      };
    });

    state.rows.forEach(renderRow);
    setStatus(`Scan complete: ${state.rows.length} matching link(s) found.`);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

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

  async function processEntry(entry) {
    setRowStatus(entry, "pending", undefined);

    // Operate on the element captured at scan time — not a fresh href
    // lookup — so this is unambiguous even when several links share a href.
    const link = entry.link;
    if (!link.isConnected) {
      setRowStatus(entry, "error", "link not found on page (did the page change since scan?)");
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

    const editBtn = await waitFor(() => document.querySelector(SELECTORS.editBtn));
    if (!editBtn) {
      setRowStatus(entry, "error", "edit-link button not found");
      return false;
    }
    doClick(editBtn);

    const urlInput = await waitFor(() => document.querySelector(SELECTORS.urlInput));
    if (!urlInput) {
      setRowStatus(entry, "error", "url input not found");
      return false;
    }

    urlInput.focus();
    urlInput.setSelectionRange(0, urlInput.value.length);
    document.execCommand("insertText", false, entry.newUrl);
    await sleep(STEP_DELAY);

    const saveBtn = await waitFor(() => document.querySelector(SELECTORS.saveBtn));
    if (!saveBtn) {
      setRowStatus(entry, "error", "save button not found");
      return false;
    }
    doClick(saveBtn);
    await sleep(STEP_DELAY);

    setRowStatus(entry, "success", "updated");
    return true;
  }

  async function run() {
    const plan = state.rows.filter((entry) => entry.oldUrl && entry.newUrl);
    if (plan.length === 0) {
      setStatus("Run a scan first, review/tweak the New URL values, then Run.");
      return;
    }

    saveSettings();
    state.stopRequested = false;
    setRowsEditable(false);

    const total = plan.length;
    setStatus(`Starting run. ${total} link(s) to update.`);
    let done = 0;

    for (const entry of plan) {
      if (state.stopRequested) {
        setStatus("Stopped by user.");
        break;
      }
      const ok = await processEntry(entry);
      if (!ok) break;
      done++;
    }

    setStatus(`Finished. ${done}/${total} updated. Click Confluence's page Save/Update to publish.`);
    setRowsEditable(true);
  }

  els.scanBtn.addEventListener("click", scan);
  els.runBtn.addEventListener("click", run);
  els.stopBtn.addEventListener("click", () => {
    state.stopRequested = true;
    setStatus("Stop signal sent.");
  });
  els.clearBtn.addEventListener("click", clearLog);
  els.closeBtn.addEventListener("click", () => {
    panel.remove();
    style.remove();
  });

  loadSettings();
})();
