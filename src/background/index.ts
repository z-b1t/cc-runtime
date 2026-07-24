import { Msg } from "../shared/protocol";

const NATIVE_HOST = "com.cocos.cc_runtime.clipboard";

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

/** Optional Win32 Creator clipboard write via Native Messaging host. */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  // Backward-compatible alias
  const isWrite =
    msg.type === "cc-runtime::writeCreatorClipboard" ||
    msg.type === "cc-runtime::writeComponentClipboard";
  if (!isWrite) return;

  const payload = msg.payload;
  const format = msg.format || "_dump_component_";
  if (!payload) {
    sendResponse({ ok: false, error: "missing payload" });
    return true;
  }
  try {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST,
      { type: "writeClipboard", format, payload },
      (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          sendResponse({ ok: false, error: err.message, native: false });
          return;
        }
        sendResponse(response || { ok: false, error: "empty host response" });
      },
    );
  } catch (e: any) {
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
  return true;
});
