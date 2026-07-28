import { throttle, type DebouncedFunc } from "lodash";
import {
  Event,
  Rpc,
  type InspectHover,
  type InspectStartResult,
} from "../shared/protocol";
import { getGameCanvas } from "./coords";
import { hideHighlight, highlightNode } from "./highlight";
import { registerHandler, sendEvent } from "./message";
import { setMovePaused, setMoveTarget } from "./move";
import { pickCandidatesAtClient } from "./pick";
import { ensureNodeMutator } from "./scene";
import { getMutatorById } from "./mutator";

declare const cc: any;

/**
 * Pick mode: hover outlines a node, a click commits it and leaves the mode.
 *
 * Every listener sits on `window` in the capture phase. Listening on the canvas
 * itself cannot work: once an event reaches its target element, capture and
 * bubble listeners run in registration order, so the engine's own canvas
 * handlers would still fire and the game would react to clicks meant for us.
 * From `window` we are genuinely upstream and `stopImmediatePropagation()`
 * ends the event there.
 */

const MOVE_INTERVAL = 16;
const HOVER_REPORT_INTERVAL = 120;
/**
 * Committing on `pointerdown` leaves the browser to still deliver `pointerup`
 * and `click` afterwards. Keep eating canvas events for a moment so the tail of
 * the click the user aimed at us never lands in the game.
 */
const COMMIT_GRACE = 400;

const POINTER_EVENTS = ["pointermove", "pointerdown", "pointerup", "pointercancel"];
const MOUSE_EVENTS = ["mousemove", "mousedown", "mouseup"];
const TOUCH_EVENTS = ["touchstart", "touchmove", "touchend", "touchcancel"];
const SWALLOW_EVENTS = ["click", "dblclick", "auxclick", "contextmenu"];

const MOVE_TYPES = new Set(["pointermove", "mousemove", "touchmove"]);
const COMMIT_TYPES = new Set(["pointerdown", "mousedown", "touchstart"]);

interface Session {
  canvas: HTMLCanvasElement;
  /** Nodes under the pointer, front-most first. */
  candidates: any[];
  /** Which candidate is outlined; Alt+wheel walks this. */
  index: number;
  restoreCursor: string;
  onMove: DebouncedFunc<(clientX: number, clientY: number, relaxed: boolean) => void>;
  reportHover: DebouncedFunc<(payload: InspectHover | null) => void>;
  /** Last payload sent, so sliding within one node stays silent. */
  lastHoverKey: string;
  detach: () => void;
}

let session: Session | null = null;
/** Deadline for the post-commit mop-up described on COMMIT_GRACE. */
let swallowUntil = 0;

function swallow(e: globalThis.Event) {
  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

function clientCoordsOf(e: globalThis.Event): { x: number; y: number } | null {
  const touches = (e as TouchEvent).changedTouches || (e as TouchEvent).touches;
  if (touches) {
    const touch = touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  const mouse = e as MouseEvent;
  if (typeof mouse.clientX === "number") {
    return { x: mouse.clientX, y: mouse.clientY };
  }
  return null;
}

function isInsideCanvas(canvas: HTMLCanvasElement, x: number, y: number): boolean {
  const rect = canvas.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * True while a detached session should still eat canvas events. A restarted
 * session takes over instead, so its listeners are never shadowed by ours.
 */
function isMoppingUp(insideCanvas: boolean): boolean {
  return insideCanvas && session === null && Date.now() < swallowUntil;
}

function reportHover(s: Session, payload: InspectHover | null) {
  const key = payload
    ? `${payload.id}:${payload.index}:${payload.candidates}`
    : "";
  if (key === s.lastHoverKey) return;
  s.lastHoverKey = key;
  s.reportHover(payload);
}

function applyHighlight(s: Session) {
  const node = s.candidates[s.index];
  if (node) highlightNode(node);
  else hideHighlight();
  reportHover(s, hoverPayload(s));
}

function hoverPayload(s: Session): InspectHover | null {
  const node = s.candidates[s.index];
  if (!node) return null;
  const mutator = ensureNodeMutator(node);
  if (!mutator) return null;
  return {
    id: mutator.id,
    name: node.name,
    candidates: s.candidates.length,
    index: s.index,
  };
}

function commit(s: Session) {
  const node = s.candidates[s.index];
  // Clicking empty space has nothing to select, so stay in pick mode.
  if (!node) return;
  const mutator = ensureNodeMutator(node);
  if (mutator) void sendEvent(Event.inspectPick, { id: mutator.id });
  stopInspect({ grace: true });
}

function cycleCandidate(s: Session, delta: number) {
  const count = s.candidates.length;
  if (count < 2) return;
  s.index = (s.index + delta + count) % count;
  applyHighlight(s);
}

function startInspect(): InspectStartResult {
  // Restarting must not tell the panel the mode just ended.
  stopInspect({ silent: true });
  // Pick mode owns canvas capture; keep drag off for the whole session.
  setMovePaused(true);

  const canvas = getGameCanvas();
  if (!canvas) {
    setMovePaused(false);
    return { ok: false, reason: "找不到游戏 canvas，请确认页面已启动 Cocos" };
  }
  if (!cc.director?.getScene()) {
    setMovePaused(false);
    return { ok: false, reason: "当前没有运行中的场景" };
  }

  const onMove = throttle((clientX: number, clientY: number, relaxed: boolean) => {
    if (!session) return;
    session.candidates = pickCandidatesAtClient(clientX, clientY, {
      renderableOnly: !relaxed,
    });
    session.index = 0;
    applyHighlight(session);
  }, MOVE_INTERVAL);

  const reportHoverThrottled = throttle((payload: InspectHover | null) => {
    void sendEvent(Event.inspectHover, payload);
  }, HOVER_REPORT_INTERVAL);

  const s: Session = {
    canvas,
    candidates: [],
    index: 0,
    restoreCursor: canvas.style.cursor,
    onMove,
    reportHover: reportHoverThrottled,
    lastHoverKey: "",
    detach: () => {},
  };

  const onPointerEvent = (e: globalThis.Event) => {
    const at = clientCoordsOf(e);
    if (!at) return;
    const inside = isInsideCanvas(s.canvas, at.x, at.y);
    if (session !== s) {
      if (isMoppingUp(inside)) swallow(e);
      return;
    }
    // Outside the canvas the page keeps working normally.
    if (!inside) {
      if (MOVE_TYPES.has(e.type)) {
        s.onMove.cancel();
        s.candidates = [];
        hideHighlight();
        reportHover(s, null);
      }
      return;
    }
    swallow(e);
    if (MOVE_TYPES.has(e.type)) {
      const relaxed = !!(e as MouseEvent).ctrlKey || !!(e as MouseEvent).metaKey;
      s.onMove(at.x, at.y, relaxed);
    } else if (COMMIT_TYPES.has(e.type)) {
      // A tap has no preceding move to pick from.
      s.onMove.cancel();
      const relaxed = !!(e as MouseEvent).ctrlKey || !!(e as MouseEvent).metaKey;
      s.candidates = pickCandidatesAtClient(at.x, at.y, { renderableOnly: !relaxed });
      s.index = 0;
      commit(s);
    }
  };

  const onWheel = (e: WheelEvent) => {
    const inside = isInsideCanvas(s.canvas, e.clientX, e.clientY);
    if (session !== s) {
      if (isMoppingUp(inside)) swallow(e);
      return;
    }
    if (!inside) return;
    swallow(e);
    if (e.altKey) cycleCandidate(s, e.deltaY > 0 ? 1 : -1);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (session !== s || e.key !== "Escape") return;
    swallow(e);
    stopInspect();
  };

  const opts: AddEventListenerOptions = { capture: true, passive: false };
  const pointerTypes =
    typeof PointerEvent !== "undefined"
      ? POINTER_EVENTS
      : [...MOUSE_EVENTS, ...TOUCH_EVENTS];
  const swallowTypes = [...pointerTypes, ...SWALLOW_EVENTS];
  for (const type of swallowTypes) {
    window.addEventListener(type, onPointerEvent, opts);
  }
  window.addEventListener("wheel", onWheel as EventListener, opts);
  window.addEventListener("keydown", onKeyDown as EventListener, opts);

  s.detach = () => {
    for (const type of swallowTypes) {
      window.removeEventListener(type, onPointerEvent, true);
    }
    window.removeEventListener("wheel", onWheel as EventListener, true);
    window.removeEventListener("keydown", onKeyDown as EventListener, true);
  };

  canvas.style.cursor = "crosshair";
  session = s;
  return { ok: true };
}

export function stopInspect(opts?: { grace?: boolean; silent?: boolean }) {
  const s = session;
  if (!s) {
    // Still allow unpausing if startInspect failed after pausing.
    if (!opts?.silent) setMovePaused(false);
    return;
  }
  session = null;
  s.onMove.cancel();
  s.reportHover.cancel();
  hideHighlight();
  s.canvas.style.cursor = s.restoreCursor;
  if (opts?.grace) {
    swallowUntil = Date.now() + COMMIT_GRACE;
    setTimeout(s.detach, COMMIT_GRACE);
  } else {
    swallowUntil = 0;
    s.detach();
  }
  setMovePaused(false);
  if (!opts?.silent) void sendEvent(Event.inspectEnd, null);
}

export function hookInspect() {
  registerHandler(Rpc.inspectStart, () => startInspect());
  registerHandler(Rpc.inspectStop, () => {
    stopInspect();
  });
  registerHandler(Rpc.highlightNode, (payload: any) => {
    const id = payload?.id ? String(payload.id) : "";
    const node = id ? getMutatorById(id)?.target : null;
    const valid =
      node && node instanceof cc.Node && node.isValid !== false ? node : null;
    // Keep drag target in sync even while pick mode owns the outline.
    setMoveTarget(valid);
    if (session) return;
    if (valid) highlightNode(valid);
    else hideHighlight();
  });
}
