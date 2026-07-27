import { Msg } from "../shared/protocol";

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
