import {
  getLocalRect,
  getRenderCamera,
  getWorldBounds,
  screenToClient,
} from "./coords";

declare const cc: any;

/**
 * Node outline drawn as a DOM overlay above the canvas.
 *
 * Deliberately not drawn inside the scene: no extra node in the hierarchy, no
 * draw call, no Mask clipping the outline away, and nothing to clean up if the
 * page goes away mid-inspect. UI nodes get their rect as a filled quad, 3D nodes
 * get the wireframe of the same world bounds the hit test used. Every corner is
 * projected on its own, so rotation, scale and perspective all come out right.
 */

const OUTLINE = "#4aa3ff";

let host: HTMLDivElement | null = null;
let outline: SVGPathElement | null = null;
let tracked: any = null;
let rafId = 0;

let scratch: { local: any; world: any; proj: any; screen: any } | null = null;

function getScratch() {
  if (!scratch) {
    scratch = {
      local: new cc.Vec3(),
      world: new cc.Vec3(),
      proj: new cc.Vec3(),
      screen: new cc.Vec3(),
    };
  }
  return scratch;
}

function ensureOverlay(): SVGPathElement {
  if (outline) return outline;

  host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;";

  outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.setAttribute("stroke", OUTLINE);
  outline.setAttribute("stroke-width", "1");
  outline.setAttribute("fill", "none");
  outline.setAttribute("d", "");

  svg.appendChild(outline);
  root.appendChild(svg);
  (document.body || document.documentElement).appendChild(host);
  return outline;
}

/** Project a world point to client space. */
function project(camera: any, x: number, y: number, z: number): string {
  const s = getScratch();
  camera.worldToScreen(s.screen, s.proj.set(x, y, z));
  const client = screenToClient(s.screen.x, s.screen.y);
  return `${client.x.toFixed(1)},${client.y.toFixed(1)}`;
}

interface Outline {
  d: string;
  filled: boolean;
}

/** The node's rect as a quad in client space. */
function rectOutline(node: any, camera: any): Outline | null {
  const rect = getLocalRect(node);
  const worldMatrix = node.worldMatrix;
  if (!rect || !worldMatrix) return null;

  const s = getScratch();
  const corners: [number, number][] = [
    [rect.left, rect.bottom],
    [rect.right, rect.bottom],
    [rect.right, rect.top],
    [rect.left, rect.top],
  ];
  const points = corners.map(([x, y]) => {
    cc.Vec3.transformMat4(s.world, s.local.set(x, y, 0), worldMatrix);
    return project(camera, s.world.x, s.world.y, s.world.z);
  });
  return { d: `M${points.join("L")}Z`, filled: true };
}

/** The node's model bounds as a wireframe box in client space. */
function boxOutline(node: any, camera: any): Outline | null {
  const bounds = getWorldBounds(node);
  if (!bounds) return null;
  const { center: c, halfExtents: h } = bounds;

  // 0-3 bottom face, 4-7 top face, matching x/z per index.
  const signs: [number, number, number][] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, -1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, -1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const p = signs.map(([sx, sy, sz]) =>
    project(camera, c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z),
  );
  const faces = `M${p[0]}L${p[1]}L${p[2]}L${p[3]}Z M${p[4]}L${p[5]}L${p[6]}L${p[7]}Z`;
  const pillars = [0, 1, 2, 3].map((i) => `M${p[i]}L${p[i + 4]}`).join(" ");
  return { d: `${faces} ${pillars}`, filled: false };
}

function buildOutline(node: any): Outline | null {
  const camera = getRenderCamera(node);
  if (typeof camera?.worldToScreen !== "function") return null;
  // 3D geometry first, mirroring what the hit test picked the node for.
  return boxOutline(node, camera) || rectOutline(node, camera);
}

function draw() {
  rafId = 0;
  if (!tracked) return;
  if (tracked.isValid === false) {
    hideHighlight();
    return;
  }
  const shape = ensureOverlay();
  const next = buildOutline(tracked);
  shape.setAttribute("d", next?.d || "");
  shape.setAttribute("fill", next?.filled ? OUTLINE : "none");
  shape.setAttribute("fill-opacity", next?.filled ? "0.12" : "0");
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
  outline?.setAttribute("d", "");
}

/** Drop the overlay element entirely. */
export function disposeHighlight() {
  hideHighlight();
  host?.remove();
  host = null;
  outline = null;
}
