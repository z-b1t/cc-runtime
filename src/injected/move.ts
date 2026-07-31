import { throttle, type DebouncedFunc } from "lodash";
import { Event, Rpc } from "../shared/protocol";
import { cleanFloat } from "../shared/number";
import {
  clientToScreen,
  getGameCanvas,
  getRenderCamera,
} from "./coords";
import { highlightNode } from "./highlight";
import { registerHandler, sendEvent } from "./message";
import { getMutator } from "./mutator";
import { pickCandidatesAtClient } from "./pick";

declare const cc: any;

/**
 * Select-and-drag: once the panel highlights a node AND drag is enabled,
 * pointerdown over that node (or a descendant) moves it in local XY only.
 * Occluders in front are ignored — any hit under the selected target counts.
 * Events are swallowed only while a drag is active or on the hit that starts
 * one — otherwise the game keeps input.
 */

const POINTER_EVENTS = ["pointermove", "pointerdown", "pointerup", "pointercancel"];
const MOUSE_EVENTS = ["mousemove", "mousedown", "mouseup"];
const TOUCH_EVENTS = ["touchstart", "touchmove", "touchend", "touchcancel"];
const SWALLOW_EVENTS = ["click", "dblclick", "auxclick", "contextmenu"];

const DOWN_TYPES = new Set(["pointerdown", "mousedown", "touchstart"]);
const MOVE_TYPES = new Set(["pointermove", "mousemove", "touchmove"]);
const UP_TYPES = new Set(["pointerup", "mouseup", "touchend", "pointercancel", "touchcancel"]);

const TRANSFORM_INTERVAL = 50;
/** After pointerup, eat the trailing click so UI Buttons do not fire. */
const DRAG_CLICK_GRACE = 320;
/** Local-space nudge per arrow key press. */
const NUDGE_STEP = 1;
/** Client-pixel delta before Shift-drag picks / switches axis. */
const AXIS_SWITCH_PX = 3;

interface DragState {
  node: any;
  /** Local-space offset from pointer hit to node.position (xy). */
  grabX: number;
  grabY: number;
  z: number;
  lastClientX: number;
  lastClientY: number;
  /** Active Shift axis; secondary coordinate stays at freeze*. */
  axisLock: "x" | "y" | null;
  freezeX: number;
  freezeY: number;
}

let moveTarget: any = null;
let paused = false;
/** Panel toggle: drag only when the user has enabled it. */
let enabled = false;
let dragging: DragState | null = null;
let attached = false;
let restoreCursor = "";
let reportTransform: DebouncedFunc<() => void> | null = null;
/** Swallow canvas click/dblclick until this time after a drag. */
let clickGraceUntil = 0;

let scratch: {
  screen: any;
  world: any;
  local: any;
  ray: any;
  mat: any;
  plane: any;
  normal: any;
} | null = null;

function getScratch() {
  if (!scratch) {
    const Ray = cc.geometry?.Ray;
    const Plane = cc.geometry?.Plane;
    scratch = {
      screen: new cc.Vec3(),
      world: new cc.Vec3(),
      local: new cc.Vec3(),
      ray: Ray ? new Ray() : null,
      mat: new cc.Mat4(),
      plane: Plane ? new Plane() : null,
      normal: new cc.Vec3(),
    };
  }
  return scratch;
}

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

function vec3Plain(v: any) {
  return {
    x: cleanFloat(Number(v?.x) || 0),
    y: cleanFloat(Number(v?.y) || 0),
    z: cleanFloat(Number(v?.z) || 0),
  };
}

function pushTransform(node: any) {
  const mutator = getMutator(node);
  if (!mutator) return;
  void sendEvent(Event.updateTransform, {
    id: mutator.id,
    position: vec3Plain(node.position),
    eulerAngles: vec3Plain(node.eulerAngles),
    scale: vec3Plain(node.scale),
  });
}

/** True when `node` is `target` or a descendant of it. */
function isUnderTarget(node: any, target: any): boolean {
  let cur = node;
  while (cur) {
    if (cur === target) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * World-space point under the pointer on the plane through `node.worldPosition`.
 * Plane normal prefers the node's forward (UI/local Z), else camera forward.
 */
function worldHitAtClient(node: any, clientX: number, clientY: number): any | null {
  const camera = getRenderCamera(node);
  if (!camera) return null;
  const screen = clientToScreen(clientX, clientY);
  const s = getScratch();
  const wp = node.worldPosition;

  let ray = s.ray;
  if (ray && typeof camera.screenPointToRay === "function") {
    camera.screenPointToRay(ray, screen.x, screen.y);
  } else if (ray && typeof camera.screenToWorld === "function") {
    const Ray = cc.geometry.Ray;
    const near = new cc.Vec3();
    const far = new cc.Vec3();
    camera.screenToWorld(near, new cc.Vec3(screen.x, screen.y, 0));
    camera.screenToWorld(far, new cc.Vec3(screen.x, screen.y, 1));
    Ray.fromPoints(ray, near, far);
  } else {
    ray = null;
  }

  // Node local +Z in world (UI plane); fall back to camera look direction.
  const wm = node.worldMatrix;
  if (wm) {
    s.normal.set(wm.m08, wm.m09, wm.m10);
  } else {
    s.normal.set(0, 0, 1);
  }
  const nLen =
    typeof s.normal.lengthSqr === "function"
      ? s.normal.lengthSqr()
      : s.normal.x * s.normal.x + s.normal.y * s.normal.y + s.normal.z * s.normal.z;
  if (nLen < 1e-10) {
    const forward = camera.node?.forward || camera.forward;
    if (forward) s.normal.set(forward.x, forward.y, forward.z);
    else s.normal.set(0, 0, 1);
  }
  if (typeof s.normal.normalize === "function") s.normal.normalize();

  if (ray && s.plane && typeof cc.geometry?.intersect?.rayPlane === "function") {
    const Plane = cc.geometry.Plane;
    Plane.fromNormalAndPoint(s.plane, s.normal, wp);
    const t = cc.geometry.intersect.rayPlane(ray, s.plane);
    if (typeof t === "number" && t >= 0) {
      return s.world.set(
        ray.o.x + ray.d.x * t,
        ray.o.y + ray.d.y * t,
        ray.o.z + ray.d.z * t,
      );
    }
  }

  // Orthographic / no-ray fallback: unproject at the node's screen depth.
  if (typeof camera.worldToScreen === "function" && typeof camera.screenToWorld === "function") {
    camera.worldToScreen(s.screen, wp);
    camera.screenToWorld(s.world, s.screen.set(screen.x, screen.y, s.screen.z));
    return s.world;
  }
  return null;
}

/** Parent-local (or world if root) xy of the pointer hit on the node's plane. */
function localHitXy(node: any, clientX: number, clientY: number): { x: number; y: number } | null {
  const world = worldHitAtClient(node, clientX, clientY);
  if (!world) return null;
  const parent = node.parent;
  const s = getScratch();
  if (parent?.worldMatrix) {
    cc.Mat4.invert(s.mat, parent.worldMatrix);
    cc.Vec3.transformMat4(s.local, world, s.mat);
  } else {
    s.local.set(world.x, world.y, world.z);
  }
  return { x: s.local.x, y: s.local.y };
}

function endDrag() {
  if (!dragging) return;
  const node = dragging.node;
  dragging = null;
  clickGraceUntil = Date.now() + DRAG_CLICK_GRACE;
  reportTransform?.flush();
  reportTransform?.cancel();
  if (node && node.isValid !== false) pushTransform(node);
  const canvas = getGameCanvas();
  if (canvas) canvas.style.cursor = restoreCursor || "";
}

function startDrag(node: any, clientX: number, clientY: number): boolean {
  const hit = localHitXy(node, clientX, clientY);
  if (!hit) return false;
  const pos = node.position;
  const ox = pos?.x || 0;
  const oy = pos?.y || 0;
  dragging = {
    node,
    grabX: hit.x - ox,
    grabY: hit.y - oy,
    z: pos?.z || 0,
    lastClientX: clientX,
    lastClientY: clientY,
    axisLock: null,
    freezeX: ox,
    freezeY: oy,
  };
  if (!reportTransform) {
    reportTransform = throttle(() => {
      if (dragging?.node && dragging.node.isValid !== false) {
        pushTransform(dragging.node);
      }
    }, TRANSFORM_INTERVAL);
  }
  const canvas = getGameCanvas();
  if (canvas) {
    restoreCursor = canvas.style.cursor;
    canvas.style.cursor = "move";
  }
  highlightNode(node);
  return true;
}

function eventShiftKey(e: globalThis.Event): boolean {
  const me = e as MouseEvent;
  if (typeof me.shiftKey === "boolean" && me.shiftKey) return true;
  if (typeof me.getModifierState === "function" && me.getModifierState("Shift")) {
    return true;
  }
  return false;
}

function applyDrag(clientX: number, clientY: number, shiftKey: boolean) {
  const d = dragging;
  if (!d || !d.node || d.node.isValid === false) {
    endDrag();
    return;
  }
  const hit = localHitXy(d.node, clientX, clientY);
  if (!hit) return;
  const rawX = hit.x - d.grabX;
  const rawY = hit.y - d.grabY;
  const cdx = clientX - d.lastClientX;
  const cdy = clientY - d.lastClientY;
  d.lastClientX = clientX;
  d.lastClientY = clientY;

  let x = rawX;
  let y = rawY;
  if (shiftKey) {
    // Pick / switch axis from pointer delta (not press origin). Freeze the
    // other axis so diagonal motion cannot staircase into free movement.
    if (Math.abs(cdx) >= AXIS_SWITCH_PX || Math.abs(cdy) >= AXIS_SWITCH_PX) {
      const prefer: "x" | "y" = Math.abs(cdx) >= Math.abs(cdy) ? "x" : "y";
      if (d.axisLock !== prefer) {
        const cur = d.node.position;
        d.freezeX = cur?.x || 0;
        d.freezeY = cur?.y || 0;
        d.axisLock = prefer;
      }
    }
    if (d.axisLock === "x") {
      y = d.freezeY;
    } else if (d.axisLock === "y") {
      x = d.freezeX;
    }
  } else {
    d.axisLock = null;
  }

  d.node.setPosition(x, y, d.z);
  reportTransform?.();
}

/** Nudge the selected node in local XY (Cocos Y-up). */
function nudgeByArrow(key: string): boolean {
  if (paused || dragging) return false;
  const node = moveTarget;
  if (!node || node.isValid === false) return false;
  let dx = 0;
  let dy = 0;
  switch (key) {
    case "ArrowLeft":
      dx = -NUDGE_STEP;
      break;
    case "ArrowRight":
      dx = NUDGE_STEP;
      break;
    case "ArrowUp":
      dy = NUDGE_STEP;
      break;
    case "ArrowDown":
      dy = -NUDGE_STEP;
      break;
    default:
      return false;
  }
  const pos = node.position;
  node.setPosition(
    (pos?.x || 0) + dx,
    (pos?.y || 0) + dy,
    pos?.z || 0,
  );
  pushTransform(node);
  return true;
}

function onKeyDown(e: KeyboardEvent) {
  if (paused || !moveTarget || moveTarget.isValid === false) return;
  // Ignore when the page focuses a text field.
  const t = e.target as HTMLElement | null;
  if (
    t &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  ) {
    return;
  }
  if (!nudgeByArrow(e.key)) return;
  swallow(e);
}

function onPointerEvent(e: globalThis.Event) {
  if (paused || !moveTarget || moveTarget.isValid === false) {
    if (dragging) endDrag();
    return;
  }
  const canvas = getGameCanvas();
  if (!canvas) return;
  const at = clientCoordsOf(e);
  if (!at) return;
  const inside = isInsideCanvas(canvas, at.x, at.y);

  if (dragging) {
    swallow(e);
    if (UP_TYPES.has(e.type)) {
      endDrag();
    } else if (MOVE_TYPES.has(e.type) && inside) {
      applyDrag(at.x, at.y, eventShiftKey(e));
    } else if (MOVE_TYPES.has(e.type) && !inside) {
      // Keep last position; still swallow so the game does not steal the gesture.
    }
    return;
  }

  if (!inside) return;

  if (
    Date.now() < clickGraceUntil &&
    SWALLOW_EVENTS.includes(e.type)
  ) {
    swallow(e);
    return;
  }

  if (DOWN_TYPES.has(e.type)) {
    // Use any hit under the selected target, not only the front-most, so a
    // covered/selected node can still be dragged once outlined.
    const hits = pickCandidatesAtClient(at.x, at.y, { renderableOnly: true });
    if (hits.some((n) => isUnderTarget(n, moveTarget))) {
      if (startDrag(moveTarget, at.x, at.y)) swallow(e);
    }
  }
}

function attachListeners() {
  if (attached) return;
  attached = true;
  const opts: AddEventListenerOptions = { capture: true, passive: false };
  const pointerTypes =
    typeof PointerEvent !== "undefined"
      ? POINTER_EVENTS
      : [...MOUSE_EVENTS, ...TOUCH_EVENTS];
  for (const type of [...pointerTypes, ...SWALLOW_EVENTS]) {
    window.addEventListener(type, onPointerEvent, opts);
  }
  window.addEventListener("keydown", onKeyDown, opts);
}

function detachListeners() {
  if (!attached) return;
  attached = false;
  const pointerTypes =
    typeof PointerEvent !== "undefined"
      ? POINTER_EVENTS
      : [...MOUSE_EVENTS, ...TOUCH_EVENTS];
  for (const type of [...pointerTypes, ...SWALLOW_EVENTS]) {
    window.removeEventListener(type, onPointerEvent, true);
  }
  window.removeEventListener("keydown", onKeyDown, true);
}

function syncAttachment() {
  if (enabled && moveTarget && moveTarget.isValid !== false && !paused) {
    attachListeners();
  } else {
    endDrag();
    detachListeners();
  }
}

/** Node the panel has selected for outline + XY drag. */
export function setMoveTarget(node: any | null) {
  if (node && node.isValid === false) node = null;
  moveTarget = node;
  if (!node) endDrag();
  syncAttachment();
}

/** Panel toggle: when false, selection still outlines but cannot drag. */
export function setMoveEnabled(value: boolean) {
  enabled = !!value;
  if (!enabled) endDrag();
  syncAttachment();
}

/** Pick mode owns canvas capture; pause drag while it runs. */
export function setMovePaused(value: boolean) {
  paused = !!value;
  if (paused) {
    endDrag();
  } else if (moveTarget && moveTarget.isValid !== false) {
    // Pick mode hid the outline on exit — restore the selected node.
    highlightNode(moveTarget);
  }
  syncAttachment();
}

export function hookMove() {
  // Listeners attach lazily via setMoveTarget / setMovePaused / setMoveEnabled.
  registerHandler(Rpc.setMoveEnabled, (value: any) => {
    setMoveEnabled(!!value);
  });
}
