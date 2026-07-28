import { clientToScreen, getLocalRect, getRenderCamera, type Vec2Like } from "./coords";

declare const cc: any;

/**
 * Screen-space node picking.
 *
 * Two rules make the result match what the user actually sees:
 *
 * - Only nodes that draw something are candidates. Full-screen Widget wrappers
 *   and empty layout containers own a UITransform rect but no pixels, so hit
 *   testing every UITransform buries the sprite the user is pointing at.
 * - The front-most hit is the one drawn *last*, not the deepest in the tree.
 *   The 2D batcher walks depth-first in child order, so that is simply the last
 *   hit collected — a later sibling covers an earlier one no matter how deep
 *   either subtree goes.
 */

/** Components whose presence means the node rasterizes something. */
const RENDERER_KEYS = [
  // 3.4+
  "UIRenderer",
  // 3.0 - 3.3
  "Renderable2D",
  "RenderComponent",
  // 3D content composited into the UI
  "UIMeshRenderer",
];

const ALPHA_EPSILON = 0.01;

let scratch: { world: any; local: any; screen: any; mat: any } | null = null;

/** Engine types are only safe to touch after cc exists, so allocate on demand. */
function getScratch() {
  if (!scratch) {
    scratch = {
      world: new cc.Vec3(),
      local: new cc.Vec3(),
      screen: new cc.Vec3(),
      mat: new cc.Mat4(),
    };
  }
  return scratch;
}

function getRenderComp(node: any): any {
  const fromProps = node._uiProps?.uiComp;
  if (fromProps) return fromProps;
  for (const key of RENDERER_KEYS) {
    const Cls = cc[key];
    if (typeof Cls === "function") {
      const comp = node.getComponent(Cls);
      if (comp) return comp;
    }
  }
  return null;
}

/** Accumulated UIOpacity down the branch, used when the engine's cache is cold. */
function opacityFromAncestors(node: any): number {
  const UIOpacity = cc.UIOpacity;
  if (!UIOpacity) return 1;
  let alpha = 1;
  let cur = node;
  while (cur) {
    const op = cur.getComponent?.(UIOpacity);
    if (op && op.enabledInHierarchy !== false) {
      alpha *= (op.opacity ?? 255) / 255;
    }
    cur = cur.parent;
  }
  return alpha;
}

function effectiveAlpha(node: any, renderComp: any): number {
  const cached = node._uiProps?.opacity;
  let alpha =
    typeof cached === "number"
      ? // Normalised 0..1 in current engines, but tolerate a 0..255 build.
        cached > 1
        ? cached / 255
        : cached
      : opacityFromAncestors(node);
  const colorAlpha = renderComp?.color?.a;
  if (typeof colorAlpha === "number") alpha *= colorAlpha / 255;
  return alpha;
}

function hitsRect(node: any, screen: Vec2Like): boolean {
  const rect = getLocalRect(node);
  if (!rect) return false;

  const camera = getRenderCamera(node);
  const worldMatrix = node.worldMatrix;
  if (!camera?.screenToWorld || !worldMatrix) {
    // Engine build we do not recognise: let it do the test itself.
    const ut = node._uiProps?.uiTransformComp;
    if (typeof ut?.hitTest !== "function") return false;
    try {
      return !!ut.hitTest(new cc.Vec2(screen.x, screen.y));
    } catch {
      return false;
    }
  }

  const s = getScratch();
  camera.screenToWorld(s.world, s.screen.set(screen.x, screen.y, 0));
  cc.Mat4.invert(s.mat, worldMatrix);
  cc.Vec3.transformMat4(s.local, s.world, s.mat);
  return (
    s.local.x >= rect.left &&
    s.local.x <= rect.right &&
    s.local.y >= rect.bottom &&
    s.local.y <= rect.top
  );
}

export interface PickOptions {
  /** false also picks containers and invisible nodes (Ctrl/Cmd held). */
  renderableOnly?: boolean;
}

/**
 * Every node under the pointer, front-most first.
 *
 * Empty when nothing is hit; index 0 is what a plain click should select, and
 * later entries are what Alt+wheel cycles through.
 */
export function pickCandidatesAtClient(
  clientX: number,
  clientY: number,
  opts: PickOptions = {},
): any[] {
  const scene = cc.director?.getScene();
  if (!scene) return [];
  const renderableOnly = opts.renderableOnly !== false;
  const screen = clientToScreen(clientX, clientY);

  // Back-to-front, because that is the order the batcher submits in.
  const hits: any[] = [];
  const walk = (node: any) => {
    if (!node || node.activeInHierarchy === false) return;
    let eligible = true;
    if (renderableOnly) {
      const renderComp = getRenderComp(node);
      eligible =
        !!renderComp &&
        renderComp.enabledInHierarchy !== false &&
        effectiveAlpha(node, renderComp) > ALPHA_EPSILON;
    }
    if (eligible && hitsRect(node, screen)) hits.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(scene);

  // A higher-priority camera draws later, so its nodes sit in front.
  hits.sort((a, b) => cameraPriority(a) - cameraPriority(b));
  return hits.reverse();
}

function cameraPriority(node: any): number {
  return getRenderCamera(node)?.priority || 0;
}
