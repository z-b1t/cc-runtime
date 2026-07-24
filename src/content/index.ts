import { v4 as uuidv4 } from "uuid";
import { Msg } from "../shared/protocol";

const pending = new Map<string, (data: unknown) => void>();

window.addEventListener("message", (ev) => {
  // Only accept same-window messages (page world ↔ content script).
  if (ev.source !== window) return;
  if (typeof ev.data !== "object" || !ev.data) return;
  const { type, id, data } = ev.data as { type?: string; id?: string; data?: unknown };
  if (typeof type !== "string") return;

  if (type === Msg.page2content_response && id) {
    const resolve = pending.get(id);
    if (resolve) {
      resolve(data);
      pending.delete(id);
    }
    return;
  }

  if (type === Msg.page2content_request) {
    chrome.runtime.sendMessage(
      { type: Msg.content2devtool_request, data },
      (resp) => {
        if (chrome.runtime.lastError) {
          // Panel may not be open yet.
          return;
        }
        if (!resp) return;
        const { type: rt, data: rd } = resp as { type: string; data: unknown };
        if (rt === Msg.devtool2content_response) {
          window.postMessage(
            { type: Msg.content2page_response, id, data: rd },
            "*",
          );
        }
      },
    );
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  const { type, id, data } = msg as { type: string; id?: string; data?: unknown };
  if (type !== Msg.devtool2content_request) return;

  const reqId = uuidv4();
  const resultPromise = new Promise<unknown>((resolve) => {
    pending.set(reqId, resolve);
    window.postMessage(
      { type: Msg.content2page_request, id: reqId, data },
      "*",
    );
  });

  resultPromise.then((result) => {
    chrome.runtime.sendMessage({
      type: Msg.content2devtool_response,
      id,
      data: result,
    }, () => {
      void chrome.runtime.lastError;
    });
  });

  // Response is delivered via a separate runtime message (matches original).
  return false;
});
