import { message } from "antd";
import { Msg, type SourceLocation } from "@shared/protocol";
import { getInspectedTabId } from "./rpc";

function canLocate(loc: SourceLocation | null | undefined): boolean {
  return !!(loc && (loc.url || loc.searchText || loc.className || loc.hasFn));
}

/** Ask background to forward openInSources to the DevTools bridge for this tab. */
export function openInSources(loc: SourceLocation): Promise<boolean> {
  const tabId = getInspectedTabId();
  if (tabId == null) {
    message.warning("未绑定调试页面");
    return Promise.resolve(false);
  }
  if (!canLocate(loc)) {
    message.warning("无法解析脚本位置");
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: Msg.openInSources,
        tabId,
        url: loc.url,
        line: loc.line,
        column: loc.column,
        searchText: loc.searchText,
        className: loc.className,
        hasFn: loc.hasFn,
      },
      (res: { ok?: boolean; reason?: string } | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) {
          message.warning("打开 Sources 失败");
          resolve(false);
          return;
        }
        if (!res?.ok) {
          if (res?.reason === "devtools-closed") {
            message.warning("请先打开该页面的 Chrome DevTools");
          } else {
            message.warning("无法打开 Sources");
          }
          resolve(false);
          return;
        }
        resolve(true);
      },
    );
  });
}

export { canLocate };
