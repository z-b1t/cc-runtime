/** Keep a live port so background learns when the side panel is closed. */

let port: chrome.runtime.Port | null = null;
let boundTabId: number | undefined;

function ensurePort(): chrome.runtime.Port {
  if (port) return port;
  port = chrome.runtime.connect({ name: "cc-runtime-side-panel" });
  port.onDisconnect.addListener(() => {
    port = null;
  });
  return port;
}

/** Open the port as soon as the side panel page loads. */
export function connectSidePanelPort() {
  ensurePort();
}

/** Bind this side-panel instance to the inspected page tab. */
export function bindSidePanelPort(tabId: number) {
  boundTabId = tabId;
  const p = ensurePort();
  try {
    p.postMessage({ type: "bind", tabId });
  } catch {
    port = null;
    const retry = ensurePort();
    retry.postMessage({ type: "bind", tabId });
  }
}

export function getBoundSidePanelTabId() {
  return boundTabId;
}
