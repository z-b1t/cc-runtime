import { Msg } from "../shared/protocol";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Global path only — do not enable for every tab (that keeps the panel open
// when switching tabs). Each open enables the panel for that tab alone.
void chrome.sidePanel.setOptions({
  path: "devtool/index.html",
  enabled: false,
});

/** tabId → live side-panel port (disconnect = panel closed). */
const panelPorts = new Map<number, chrome.runtime.Port>();
/** tabId → DevTools bridge port (disconnect = DevTools closed). */
const devtoolsPorts = new Map<number, chrome.runtime.Port>();
/** tabId → safety timer if panel never binds after open. */
const pendingOpenTimers = new Map<number, ReturnType<typeof setTimeout>>();

function openFallbackWindow() {
  void chrome.windows.create({
    url: chrome.runtime.getURL("devtool/index.html"),
    type: "popup",
    width: 960,
    height: 720,
  });
}

function enablePanelForTab(tabId: number) {
  void chrome.sidePanel.setOptions({
    tabId,
    path: "devtool/index.html",
    enabled: true,
  });
}

function disablePanelForTab(tabId: number) {
  void chrome.sidePanel.setOptions({
    tabId,
    enabled: false,
  });
}

function notifyTab(tabId: number, type: string) {
  chrome.tabs.sendMessage(tabId, { type }, () => {
    void chrome.runtime.lastError;
  });
}

function clearPendingOpen(tabId: number) {
  const timer = pendingOpenTimers.get(tabId);
  if (timer != null) {
    clearTimeout(timer);
    pendingOpenTimers.delete(tabId);
  }
}

function onPanelClosed(tabId: number) {
  clearPendingOpen(tabId);
  disablePanelForTab(tabId);
  notifyTab(tabId, Msg.launcherShow);
  notifyTab(tabId, Msg.launcherRelayout);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "cc-runtime-devtools") {
    let boundTabId: number | undefined;
    port.onMessage.addListener((msg) => {
      if ((msg as { type?: string })?.type !== "bind") return;
      const id = (msg as { tabId?: number }).tabId;
      if (typeof id !== "number") return;
      boundTabId = id;
      devtoolsPorts.set(id, port);
    });
    port.onDisconnect.addListener(() => {
      if (boundTabId == null) return;
      if (devtoolsPorts.get(boundTabId) === port) {
        devtoolsPorts.delete(boundTabId);
      }
    });
    return;
  }

  if (port.name !== "cc-runtime-side-panel") return;

  let boundTabId: number | undefined;

  port.onMessage.addListener((msg) => {
    if ((msg as { type?: string })?.type !== "bind") return;
    const tabId = (msg as { tabId?: number }).tabId;
    if (typeof tabId !== "number") return;

    boundTabId = tabId;
    clearPendingOpen(tabId);
    panelPorts.set(tabId, port);
    enablePanelForTab(tabId);
    notifyTab(tabId, Msg.launcherHide);
  });

  port.onDisconnect.addListener(() => {
    if (boundTabId == null) return;
    if (panelPorts.get(boundTabId) === port) {
      panelPorts.delete(boundTabId);
    }
    // Port drop is the reliable signal that the side panel was closed.
    onPanelClosed(boundTabId);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = (msg as { type?: string })?.type;

  if (type === Msg.openInSources) {
    const tabId = (msg as { tabId?: number }).tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, reason: "missing tabId" });
      return;
    }
    const dt = devtoolsPorts.get(tabId);
    if (!dt) {
      sendResponse({ ok: false, reason: "devtools-closed" });
      return;
    }
    try {
      dt.postMessage(msg);
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({
        ok: false,
        reason: err instanceof Error ? err.message : "forward-failed",
      });
    }
    return;
  }

  if (type === Msg.probeCc) {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse(false);
      return;
    }
    chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => !!(globalThis as any).cc,
      })
      .then((results) => sendResponse(!!results[0]?.result))
      .catch(() => sendResponse(false));
    return true;
  }

  // Kept for compatibility; port bind/disconnect is the source of truth.
  if (type === Msg.sidePanelOpened) {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    if (tabId == null) return;
    enablePanelForTab(tabId);
    notifyTab(tabId, Msg.launcherHide);
    return;
  }

  if (type === Msg.sidePanelClosed) {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    if (tabId == null) return;
    onPanelClosed(tabId);
    return;
  }

  if (type !== Msg.openSidePanel) return;
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (tabId == null) return;

  notifyTab(tabId, Msg.launcherHide);
  enablePanelForTab(tabId);
  clearPendingOpen(tabId);
  // If the panel page never connects, restore the launcher.
  pendingOpenTimers.set(
    tabId,
    setTimeout(() => {
      pendingOpenTimers.delete(tabId);
      if (!panelPorts.has(tabId)) {
        notifyTab(tabId, Msg.launcherShow);
      }
    }, 8000),
  );

  try {
    const opened = chrome.sidePanel.open(
      windowId != null ? { tabId, windowId } : { tabId },
    );
    void Promise.resolve(opened).catch((err) => {
      console.warn("[cc-runtime] sidePanel.open failed, fallback window:", err);
      clearPendingOpen(tabId);
      notifyTab(tabId, Msg.launcherShow);
      openFallbackWindow();
    });
  } catch (err) {
    console.warn("[cc-runtime] sidePanel.open threw, fallback window:", err);
    clearPendingOpen(tabId);
    notifyTab(tabId, Msg.launcherShow);
    openFallbackWindow();
  }
});

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  // Only main-frame navigations; ignore iframes / other tabs' noise.
  if (frameId !== 0) return;
  chrome.runtime.sendMessage(
    {
      type: Msg.background2devtool_tabReloaded,
      data: { tabId },
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
});
