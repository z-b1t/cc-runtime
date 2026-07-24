import { throttle } from "lodash";
import { v4 as uuidv4 } from "uuid";
import { Event, Msg, Rpc, type BatchItem, type Envelope } from "@shared/protocol";

type Handler = (data: unknown) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {};
const waiters = new Map<string, (data: unknown) => void>();
const queue: BatchItem[] = [];
let tabId: number | undefined;

export function setInspectedTabId(id: number) {
  tabId = id;
}

export function getInspectedTabId() {
  return tabId;
}

export function onEvent(type: string, handler: Handler): () => void {
  handlers[type] = handler;
  return () => {
    delete handlers[type];
  };
}

/** One-shot waiter used by bootstrap for loadingComplete. */
export function waitForEvent<T = unknown>(type: string, timeoutMs = 60000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);
    const off = onEvent(type, (data) => {
      clearTimeout(timer);
      off();
      resolve(data as T);
    });
  });
}

const flush = throttle(() => {
  if (tabId == null) {
    console.warn("[cc-runtime] tabId not set, drop batch", queue.length);
    return;
  }
  if (!queue.length) return;
  const id = uuidv4();
  const batch = queue.splice(0, queue.length);
  waiters.set(id, (results: unknown) => {
    const arr = (results as unknown[]) || [];
    batch.forEach((item, i) => {
      const w = waiters.get(item.id);
      if (w) {
        waiters.delete(item.id);
        w(arr[i]);
      }
    });
  });
  chrome.tabs.sendMessage(
    tabId,
    {
      type: Msg.devtool2content_request,
      id,
      data: batch,
    } as Envelope,
    () => {
      // Content replies via a separate runtime message, not sendResponse.
      // Only treat "no receiving end" as fatal.
      const err = chrome.runtime.lastError;
      if (err && /Receiving end does not exist|Could not establish connection/i.test(err.message)) {
        console.warn("[cc-runtime] tabs.sendMessage failed:", err.message);
        const batchWaiter = waiters.get(id);
        if (batchWaiter) {
          waiters.delete(id);
          batchWaiter(batch.map(() => undefined));
        }
        batch.forEach((item) => {
          const w = waiters.get(item.id);
          if (w) {
            waiters.delete(item.id);
            w(undefined);
          }
        });
      }
    },
  );
}, 100);

export function callRpc<T = unknown>(type: string, data?: unknown): Promise<T> {
  return new Promise((resolve) => {
    const id = uuidv4();
    waiters.set(id, resolve as (d: unknown) => void);
    queue.push({ id, type, data });
    flush();
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { type, id, data } = msg as Envelope;

  // Page/content messages must come from the inspected tab (same as original).
  if (sender.tab?.id != null && tabId != null && sender.tab.id === tabId) {
    if (type === Msg.content2devtool_response && id) {
      const w = waiters.get(id);
      if (w) {
        w(data);
        waiters.delete(id);
      }
      return;
    }

    if (type === Msg.content2devtool_request) {
      const items = (data as BatchItem[]) || [];
      Promise.all(
        items.map(async (item) => {
          const h = handlers[item.type];
          return h ? h(item.data) : undefined;
        }),
      ).then((results) => {
        sendResponse({ type: Msg.devtool2content_response, data: results });
      });
      return true;
    }
  }

  if (typeof type === "string" && type.startsWith("cc-runtime::background2devtool_request")) {
    const name = type.split("|")[1] || "__tabReloaded__";
    const h = handlers[name] || handlers["__tabReloaded__"];
    Promise.resolve(h?.(data)).then((result) => {
      sendResponse({ type: Msg.devtool2background_response, data: result ?? null });
    });
    return true;
  }
});

export { Rpc, Event };
