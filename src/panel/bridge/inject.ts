/** Inject injected.js into the inspected page once window.cc is ready. */

import { Msg } from "@shared/protocol";

const INJECT_FLAG = "__cc_runtime_script_injected__";

function evalInPage(code: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(code, (result, exceptionInfo) => {
      if (
        exceptionInfo &&
        (exceptionInfo as chrome.devtools.inspectedWindow.EvaluationExceptionInfo)
          .isException
      ) {
        reject(new Error(String((exceptionInfo as any).value || "eval failed")));
        return;
      }
      resolve(result);
    });
  });
}

export async function isInjected(): Promise<boolean> {
  try {
    return !!(await evalInPage(`window.${INJECT_FLAG} === true`));
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

  const url = chrome.runtime.getURL("injected.js");
  const loadingType = Msg.page2content_request;
  const code = `
(async function () {
  if (window.${INJECT_FLAG}) return;
  window.${INJECT_FLAG} = true;
  while (!window.cc) {
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  var temp = document.createElement("script");
  temp.setAttribute("type", "text/javascript");
  temp.src = ${JSON.stringify(url)};
  temp.onload = function () {
    window.postMessage({
      type: ${JSON.stringify(loadingType)},
      id: Date.now() + "-" + Math.random(),
      data: [{ id: "lc", type: "loadingComplete", data: null }]
    }, "*");
  };
  temp.onerror = function () {
    window.${INJECT_FLAG} = false;
    console.error("[cc-runtime] failed to load injected.js");
  };
  (document.head || document.documentElement).appendChild(temp);
})();
true;
`;
  await evalInPage(code);
  return false;
}
