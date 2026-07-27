import { Msg } from "../shared/protocol";

chrome.webNavigation.onCommitted.addListener(({ tabId }) => {
  console.log(tabId, "reloaded");
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
