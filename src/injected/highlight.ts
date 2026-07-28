import { getLocalRect, getRenderCamera, screenToClient } from "./coords";

declare const cc: any;

/**
 * Node outline drawn as a DOM overlay above the canvas.
 *
 * Deliberately not drawn inside the scene: no extra node in the hierarchy, no
 * draw call, no Mask clipping the outline away, and nothing to clean up if the
 * page goes away mid-inspect. The four rect corners are projected individually,
 * so rotation, scale and perspective all come out right.
 */

const OUTLINE = "#4aa3ff";

let host: HTMLDivElement | null = null;
let polygon: SVGPolygonElement | null = null;
let tracked: any = null;
let rafId = 0;

let scratch: { local: any; world: any; screen: any } | null = null;

function getScratch() {
  if (!scratch) {
    scratch = { local: new cc.Vec3(), world: new cc.Vec3(), screen: new cc.Vec3() };
  }
  return scratch;
}

function ensureOverlay(): SVGPolygonElement {
  if (polygon) return polygon;

  host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;";

  polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("fill", OUTLINE);
  polygon.setAttribute("fill-opacity", "0.12");
  polygon.setAttribute("stroke", OUTLINE);
  polygon.setAttribute("stroke-width", "1");
  polygon.setAttribute("points", "");

  svg.appendChild(polygon);
  root.appendChild(svg);
  (document.body || document.documentElement).appendChild(host);
  return polygon;
}

/** Client-space corner list for the node's rect, or null when unprojectable. */
function cornerPoints(node: any): string | null {
  const rect = getLocalRect(node);
  const worldMatrix = node.worldMatrix;
  const camera = getRenderCamera(node);
  if (!rect || !worldMatrix || typeof camera?.worldToScreen !== "function") {
    return null;
  }

  const s = getScratch();
  const corners: [number, number][] = [
    [rect.left, rect.bottom],
    [rect.right, rect.bottom],
    [rect.right, rect.top],
    [rect.left, rect.top],
  ];
  const out: string[] = [];
  for (const [x, y] of corners) {
    cc.Vec3.transformMat4(s.world, s.local.set(x, y, 0), worldMatrix);
    camera.worldToScreen(s.screen, s.world);
    const client = screenToClient(s.screen.x, s.screen.y);
    out.push(`${client.x.toFixed(1)},${client.y.toFixed(1)}`);
  }
  return out.join(" ");
}

function draw() {
  rafId = 0;
  if (!tracked) return;
  if (tracked.isValid === false) {
    hideHighlight();
    return;
  }
  const shape = ensureOverlay();
  const points = cornerPoints(tracked);
  shape.setAttribute("points", points || "");
  rafId = requestAnimationFrame(draw);
}

/** Outline `node` and keep following it until hidden. */
export function highlightNode(node: any) {
  if (!node || node.isValid === false) {
    hideHighlight();
    return;
  }
  tracked = node;
  ensureOverlay();
  if (!rafId) rafId = requestAnimationFrame(draw);
}

export function hideHighlight() {
  tracked = null;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  polygon?.setAttribute("points", "");
}

/** Drop the overlay element entirely. */
export function disposeHighlight() {
  hideHighlight();
  host?.remove();
  host = null;
  polygon = null;
}
