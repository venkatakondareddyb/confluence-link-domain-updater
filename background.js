// Owns the per-tab run state. The popup is a view onto this, not the source of
// truth — if it closes mid-run (any click on the page closes it), messages from
// the injected script still land here and the popup re-renders on reopen.

const SRC = "confluence-link-updater";
const key = (tabId) => `state:${tabId}`;
const blank = () => ({ status: "", running: false, rows: {} });

// Messages can arrive faster than a read-modify-write round trip, so serialise.
let chain = Promise.resolve();

function queue(fn) {
  chain = chain.then(fn).catch((err) => console.error("[link-updater]", err));
  return chain;
}

async function update(tabId, mutate) {
  const k = key(tabId);
  const stored = await chrome.storage.session.get(k);
  const state = stored[k] ?? blank();
  mutate(state);
  await chrome.storage.session.set({ [k]: state });
}

function applyRow(state, msg) {
  const row = state.rows[msg.index] ?? { index: msg.index };
  if (msg.oldUrl !== undefined) row.oldUrl = msg.oldUrl;
  // A value the user typed wins over anything the scan derives.
  if (msg.newUrl !== undefined && (msg.from === "popup" || !row.touched)) row.newUrl = msg.newUrl;
  if (msg.touched) row.touched = true;
  if (msg.status !== undefined) {
    row.status = msg.status;
    row.message = msg.message;
  }
  state.rows[msg.index] = row;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.source !== SRC) return;
  const tabId = msg.tabId ?? sender.tab?.id;
  if (tabId == null) return;

  queue(() =>
    update(tabId, (state) => {
      switch (msg.type) {
        case "summary":
          state.status = msg.text;
          break;
        case "run-state":
          state.running = msg.running;
          break;
        case "reset":
          state.status = "";
          state.running = false;
          state.rows = {};
          break;
        case "row":
        case "patch":
          applyRow(state, msg);
          break;
      }
    })
  );
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(key(tabId)));
