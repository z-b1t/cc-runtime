import { throttle } from "lodash";
import { Msg, type BatchItem } from "../shared/protocol";

type Handler = (data: unknown) => unknown | Promise<unknown>;

const responseWaiters = new Map<string, (data: unknown) => void>();
const handlers: Record<string, Handler> = {};
const outboundQueue: BatchItem[] = [];

export function registerHandler(type: string, handler: Handler): () => void {
  handlers[type] = handler;
  return () => {
    delete handlers[type];
  };
}

/**
 * Convert any value into structured-clone-safe plain JSON data.
 * Cocos __attrs__ / ValueType / class instances must not reach postMessage.
 */
export function cloneForPostMessage<T = unknown>(
  value: T,
  seen = new WeakSet<object>(),
): T {
  if (value == null) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "bigint") return Number(value) as T;
  if (t === "function" || t === "symbol" || t !== "object") return undefined as T;

  const obj = value as object;
  if (seen.has(obj)) return undefined as T;
  seen.add(obj);

  if (Array.isArray(value)) {
    return value.map((item) => cloneForPostMessage(item, seen)) as T;
  }

  // DOM nodes
  if (typeof (value as any).nodeType === "number") return undefined as T;

  const out: Record<string, unknown> = {};
  // Prefer own enumerable keys; fall back to JSON for exotic host objects.
  let keys: string[];
  try {
    keys = Object.keys(value as object);
  } catch {
    try {
      return JSON.parse(
        JSON.stringify(value, (_k, v) =>
          typeof v === "function" || typeof v === "symbol" ? undefined : v,
        ),
      ) as T;
    } catch {
      return undefined as T;
    }
  }

  for (const key of keys) {
    let v: unknown;
    try {
      v = (value as any)[key];
    } catch {
      continue;
    }
    if (typeof v === "function" || typeof v === "symbol") continue;
    // Skip live engine objects that still look like EventTargets / cc.Object
    // unless they are plain records / ValueType-like (own data keys only).
    if (v && typeof v === "object") {
      const plain = cloneForPostMessage(v, seen);
      if (plain !== undefined) out[key] = plain;
      continue;
    }
    out[key] = v;
  }
  return out as T;
}

const flushOutbound = throttle(() => {
  const batchId = `${Date.now()}-${Math.random()}`;
  const batch = outboundQueue.splice(0, outboundQueue.length).map((item) => ({
    ...item,
    data: cloneForPostMessage(item.data),
  }));
  responseWaiters.set(batchId, (results: unknown) => {
    const arr = results as unknown[];
    batch.forEach((item, i) => {
      const waiter = responseWaiters.get(item.id);
      if (waiter) {
        responseWaiters.delete(item.id);
        waiter(arr[i]);
      }
    });
  });
  try {
    window.postMessage(
      { type: Msg.page2content_request, id: batchId, data: batch },
      "*",
    );
  } catch (err) {
    console.error("[cc-runtime] postMessage outbound failed", batch, err);
  }
}, 100);

export function sendEvent(type: string, data?: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random()}`;
    responseWaiters.set(id, resolve);
    outboundQueue.push({ id, type, data });
    flushOutbound();
  });
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const { type, id, data } = (ev.data || {}) as {
    type?: string;
    id?: string;
    data?: unknown;
  };
  if (!type) return;

  if (type === Msg.content2page_response && id) {
    const waiter = responseWaiters.get(id);
    if (waiter) {
      waiter(data);
      responseWaiters.delete(id);
    }
    return;
  }

  if (type === Msg.content2page_request && id) {
    const items = (data as BatchItem[]) || [];
    // Isolate per-item failures so one bad RPC cannot wipe the whole batch.
    Promise.all(
      items.map(async (item) => {
        try {
          const h = handlers[item.type];
          return h ? await h(item.data) : undefined;
        } catch (err) {
          console.error("[cc-runtime] handler failed", item.type, err);
          return undefined;
        }
      }),
    ).then((results) => {
      let payload: unknown;
      try {
        payload = cloneForPostMessage(results);
      } catch (err) {
        console.error("[cc-runtime] cloneForPostMessage failed", err);
        payload = items.map(() => undefined);
      }
      try {
        window.postMessage(
          { type: Msg.page2content_response, id, data: payload },
          "*",
        );
      } catch (err) {
        console.error("[cc-runtime] postMessage response failed", err);
        window.postMessage(
          {
            type: Msg.page2content_response,
            id,
            data: items.map(() => undefined),
          },
          "*",
        );
      }
    });
  }
});
