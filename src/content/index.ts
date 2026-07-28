import { v4 as uuidv4 } from "uuid";
import { Msg } from "../shared/protocol";

const pending = new Map<string, (data: unknown) => void>();
const LAUNCHER_HOST_ID = "cc-runtime-launcher-host";
const LAUNCHER_POS_KEY = "cc-runtime-launcher-pos";
const BTN_SIZE = 32;
const MARGIN = 12;
const DRAG_THRESHOLD = 4;
const CC_POLL_MS = 1000;

type LauncherPos = { left: number; top: number };
type Edge = "left" | "right" | "top" | "bottom";
/** Persist edge + offset so side-panel resize does not corrupt the saved spot. */
type SavedEdgePos = { edge: Edge; offset: number };

function maxLeft() {
  return Math.max(MARGIN, window.innerWidth - BTN_SIZE - MARGIN);
}

function maxTop() {
  return Math.max(MARGIN, window.innerHeight - BTN_SIZE - MARGIN);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(lo, n), hi);
}

/** Keep the button on the nearest viewport edge (corners stay on an edge). */
function snapToEdge(left: number, top: number): LauncherPos {
  left = clamp(left, MARGIN, maxLeft());
  top = clamp(top, MARGIN, maxTop());

  const dLeft = left - MARGIN;
  const dRight = maxLeft() - left;
  const dTop = top - MARGIN;
  const dBottom = maxTop() - top;
  const min = Math.min(dLeft, dRight, dTop, dBottom);

  if (min === dLeft) return { left: MARGIN, top };
  if (min === dRight) return { left: maxLeft(), top };
  if (min === dTop) return { left, top: MARGIN };
  return { left, top: maxTop() };
}

function toSaved(pos: LauncherPos): SavedEdgePos {
  const snapped = snapToEdge(pos.left, pos.top);
  const dLeft = snapped.left - MARGIN;
  const dRight = maxLeft() - snapped.left;
  const dTop = snapped.top - MARGIN;
  const dBottom = maxTop() - snapped.top;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return { edge: "left", offset: snapped.top };
  if (min === dRight) return { edge: "right", offset: snapped.top };
  if (min === dTop) return { edge: "top", offset: snapped.left };
  return { edge: "bottom", offset: snapped.left };
}

function fromSaved(saved: SavedEdgePos): LauncherPos {
  switch (saved.edge) {
    case "left":
      return { left: MARGIN, top: clamp(saved.offset, MARGIN, maxTop()) };
    case "right":
      return { left: maxLeft(), top: clamp(saved.offset, MARGIN, maxTop()) };
    case "top":
      return { left: clamp(saved.offset, MARGIN, maxLeft()), top: MARGIN };
    case "bottom":
      return { left: clamp(saved.offset, MARGIN, maxLeft()), top: maxTop() };
    default: {
      const _exhaustive: never = saved.edge;
      return _exhaustive;
    }
  }
}

function defaultSaved(): SavedEdgePos {
  return { edge: "right", offset: MARGIN };
}

function loadSaved(): SavedEdgePos {
  try {
    const raw = localStorage.getItem(LAUNCHER_POS_KEY);
    if (!raw) return defaultSaved();
    const parsed = JSON.parse(raw) as Partial<SavedEdgePos & LauncherPos>;
    if (
      parsed.edge === "left" ||
      parsed.edge === "right" ||
      parsed.edge === "top" ||
      parsed.edge === "bottom"
    ) {
      if (typeof parsed.offset === "number") {
        return { edge: parsed.edge, offset: parsed.offset };
      }
    }
    // Migrate legacy { left, top } pixels.
    if (typeof parsed.left === "number" && typeof parsed.top === "number") {
      return toSaved({ left: parsed.left, top: parsed.top });
    }
    return defaultSaved();
  } catch {
    return defaultSaved();
  }
}

function savePos(pos: LauncherPos) {
  try {
    localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(toSaved(pos)));
  } catch {
    // ignore quota / private-mode failures
  }
}

function loadPos(): LauncherPos {
  return fromSaved(loadSaved());
}

function applyPos(host: HTMLElement, pos: LauncherPos) {
  host.style.left = `${pos.left}px`;
  host.style.top = `${pos.top}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
}

function relayoutLauncher() {
  const host = document.getElementById(LAUNCHER_HOST_ID);
  if (!host) return;
  applyPos(host, loadPos());
}

let launcherSuppressed = false;

function unmountLauncher() {
  document.getElementById(LAUNCHER_HOST_ID)?.remove();
}

function probeCc(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: Msg.probeCc }, (hasCc) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(!!hasCc);
    });
  });
}

async function syncLauncherForCc() {
  if (launcherSuppressed) {
    unmountLauncher();
    return;
  }
  const hasCc = await probeCc();
  if (hasCc) mountLauncher();
  else unmountLauncher();
}

function startCcWatcher() {
  void syncLauncherForCc();
  window.setInterval(() => {
    void syncLauncherForCc();
  }, CC_POLL_MS);
}

startCcWatcher();

function mountLauncher() {
  if (document.getElementById(LAUNCHER_HOST_ID)) return;
  const root = document.documentElement || document.body;
  if (!root) return;

  const host = document.createElement("div");
  host.id = LAUNCHER_HOST_ID;
  host.style.cssText =
    "all:initial;position:fixed;z-index:2147483646;pointer-events:none;";
  applyPos(host, loadPos());

  const shadow = host.attachShadow({ mode: "closed" });
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "CC";
  btn.title = "打开 cc-runtime（可贴边拖动）";
  btn.style.cssText = [
    "pointer-events:auto",
    `width:${BTN_SIZE}px`,
    `height:${BTN_SIZE}px`,
    "border:none",
    "border-radius:8px",
    "cursor:grab",
    "font:700 11px/1 Segoe UI,Arial,sans-serif",
    "color:#fff",
    "background:#0d7377",
    "box-shadow:0 2px 8px rgba(0,0,0,.35)",
    "touch-action:none",
    "user-select:none",
  ].join(";");

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = host.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    btn.style.cursor = "grabbing";
    btn.setPointerCapture(e.pointerId);
  });

  btn.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
      moved = true;
    }
    if (!moved) return;
    applyPos(host, snapToEdge(originLeft + dx, originTop + dy));
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    btn.style.cursor = "grab";
    try {
      btn.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (moved) {
      const rect = host.getBoundingClientRect();
      const pos = snapToEdge(rect.left, rect.top);
      applyPos(host, pos);
      savePos(pos);
      return;
    }
    // Keep this synchronous so the service worker still has a user gesture.
    chrome.runtime.sendMessage({ type: Msg.openSidePanel });
  };

  btn.addEventListener("pointerup", endDrag);
  btn.addEventListener("pointercancel", endDrag);
  btn.addEventListener("click", (e) => {
    // Click is handled on pointerup to distinguish drag vs tap.
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("resize", () => {
    // Re-apply the user-saved edge; never overwrite it on viewport changes
    // (side panel open/close shrinks/grows the page).
    relayoutLauncher();
  });

  shadow.appendChild(btn);
  root.appendChild(host);
}

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

  if (type === Msg.launcherHide) {
    launcherSuppressed = true;
    unmountLauncher();
    return;
  }

  if (type === Msg.launcherShow) {
    launcherSuppressed = false;
    void syncLauncherForCc().then(() => relayoutLauncher());
    return;
  }

  if (type === Msg.launcherRelayout) {
    relayoutLauncher();
    return;
  }

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
