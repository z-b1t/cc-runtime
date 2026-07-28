/** Inject injected.js into the inspected page once window.cc is ready. */

import { Msg } from "@shared/protocol";
import { getInspectedTabId } from "./rpc";

const INJECT_FLAG = "__cc_runtime_script_injected__";

function requireTabId(): number {
  const tabId = getInspectedTabId();
  if (tabId == null) throw new Error("tabId not set");
  return tabId;
}

export async function isInjected(): Promise<boolean> {
  try {
    const tabId = requireTabId();
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (flag: string) => !!(window as any)[flag],
      args: [INJECT_FLAG],
    });
    return !!results[0]?.result;
  } catch {
    return false;
  }
}

/**
 * Ensure page-world script is injected.
 * @returns true if script was already present
 */
export async function injectIntoPage(): Promise<boolean> {
  if (await isInjected()) return true;

  const tabId = requireTabId();
  const url = chrome.runtime.getURL("injected.js");
  const loadingType = Msg.page2content_request;

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (scriptUrl: string, flag: string, msgType: string) => {
      void (async () => {
        if ((window as any)[flag]) return;
        (window as any)[flag] = true;
        while (!(window as any).cc) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const temp = document.createElement("script");
        temp.setAttribute("type", "text/javascript");
        temp.src = scriptUrl;
        temp.onload = () => {
          window.postMessage(
            {
              type: msgType,
              id: Date.now() + "-" + Math.random(),
              data: [{ id: "lc", type: "loadingComplete", data: null }],
            },
            "*",
          );
        };
        temp.onerror = () => {
          (window as any)[flag] = false;
          console.error("[cc-runtime] failed to load injected.js");
        };
        (document.head || document.documentElement).appendChild(temp);
      })();
    },
    args: [url, INJECT_FLAG, loadingType],
  });
  return false;
}
