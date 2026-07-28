import {
  clientToScreen,
  getLocalRect,
  getRenderCamera,
  getWorldBounds,
  type Vec2Like,
} from "./coords";

declare const cc: any;

/**
 * Screen-space node picking for both UI and 3D content.
 *
 * A ray is cast through the pointer for each camera involved, then:
 *
 * - 3D nodes are tested against the world bounds of their models and ordered by
 *   distance along the ray.
 * - UI nodes are tested by intersecting that ray with the node's own plane and
 *   comparing the hit against its rect, which stays correct under a perspective
 *   camera where unprojecting a single screen point cannot.
 * - Only nodes that draw something are candidates, and the front-most UI hit is
 *   the one drawn *last*, not the deepest in the tree. The 2D batcher walks
 *   depth-first in child order, so a later sibling covers an earlier one no
 *   matter how deep either subtree goes.
 */

/** Components whose presence means the node rasterizes something in the UI. */
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

let scratch: {
  world: any;
  local: any;
  dir: any;
  screen: any;
  mat: any;
  aabb: any;
} | null = null;

/** Engine types are only safe to touch after cc exists, so allocate on demand. */
function getScratch() {
  if (!scratch) {
    const AABB = cc.geometry?.AABB || cc.geometry?.aabb;
    scratch = {
      world: new cc.Vec3(),
      local: new cc.Vec3(),
      dir: new cc.Vec3(),
      screen: new cc.Vec3(),
      mat: new cc.Mat4(),
      aabb: AABB ? new AABB() : null,
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

/** Pointer ray in world space, cached per camera for one pick. */
function getRay(cache: Map<any, any>, camera: any, screen: Vec2Like): any {
  if (cache.has(camera)) return cache.get(camera);
  let ray: any = null;
  const Ray = cc.geometry?.Ray;
  if (Ray) {
    ray = new Ray();
    if (typeof camera.screenPointToRay === "function") {
      camera.screenPointToRay(ray, screen.x, screen.y);
    } else if (typeof camera.screenToWorld === "function") {
      // Unproject both clip planes and join them.
      const near = new cc.Vec3();
      const far = new cc.Vec3();
      camera.screenToWorld(near, new cc.Vec3(screen.x, screen.y, 0));
      camera.screenToWorld(far, new cc.Vec3(screen.x, screen.y, 1));
      Ray.fromPoints(ray, near, far);
    } else {
      ray = null;
    }
  }
  cache.set(camera, ray);
  return ray;
}

/** Distance along `ray` to the node's model bounds, or null when it misses. */
function hitsModel(node: any, ray: any): number | null {
  if (!ray) return null;
  const rayAABB = cc.geometry?.intersect?.rayAABB;
  if (typeof rayAABB !== "function") return null;
  const bounds = getWorldBounds(node);
  if (!bounds) return null;

  // Bounds rather than triangles: predictable, allocation-free, and it matches
  // the box the outline draws.
  const box = getScratch().aabb;
  if (!box) return null;
  box.center.set(bounds.center.x, bounds.center.y, bounds.center.z);
  box.halfExtents.set(
    bounds.halfExtents.x,
    bounds.halfExtents.y,
    bounds.halfExtents.z,
  );
  const distance = rayAABB(ray, box);
  return distance > 0 ? distance : null;
}

function transformNormal(out: any, v: any, mat: any) {
  if (typeof cc.Vec3.transformMat4Normal === "function") {
    return cc.Vec3.transformMat4Normal(out, v, mat);
  }
  // Same thing by hand: drop the translation column.
  return out.set(
    v.x * mat.m00 + v.y * mat.m04 + v.z * mat.m08,
    v.x * mat.m01 + v.y * mat.m05 + v.z * mat.m09,
    v.x * mat.m02 + v.y * mat.m06 + v.z * mat.m10,
  );
}

/** Rect test in node space, hitting the node's own plane with the pointer ray. */
function hitsRect(node: any, camera: any, ray: any, screen: Vec2Like): boolean {
  const rect = getLocalRect(node);
  if (!rect) return false;

  const worldMatrix = node.worldMatrix;
  if (!worldMatrix) {
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
  cc.Mat4.invert(s.mat, worldMatrix);

  let x: number;
  let y: number;
  if (ray) {
    // Ray in node space, then walk it to the z = 0 plane the rect lives on.
    cc.Vec3.transformMat4(s.local, ray.o, s.mat);
    transformNormal(s.dir, ray.d, s.mat);
    if (Math.abs(s.dir.z) < 1e-8) return false;
    const t = -s.local.z / s.dir.z;
    if (t < 0) return false;
    x = s.local.x + s.dir.x * t;
    y = s.local.y + s.dir.y * t;
  } else if (typeof camera?.screenToWorld === "function") {
    // No ray support: orthographic-only approximation.
    camera.screenToWorld(s.world, s.screen.set(screen.x, screen.y, 0));
    cc.Vec3.transformMat4(s.local, s.world, s.mat);
    x = s.local.x;
    y = s.local.y;
  } else {
    return false;
  }

  return x >= rect.left && x <= rect.right && y >= rect.bottom && y <= rect.top;
}

interface Hit {
  node: any;
  /** Higher priority draws later, so it sits in front. */
  priority: number;
  kind: "2d" | "3d";
  /** Along the pointer ray; only meaningful for 3D hits. */
  distance: number;
  /** Traversal index, i.e. UI draw order. */
  order: number;
}

/** Back-to-front, so the caller can reverse into "front-most first". */
function compareBackToFront(a: Hit, b: Hit): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  // Within one camera, UI is composited over 3D geometry.
  if (a.kind !== b.kind) return a.kind === "3d" ? -1 : 1;
  if (a.kind === "3d") return b.distance - a.distance;
  return a.order - b.order;
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
  const rays = new Map<any, any>();

  const hits: Hit[] = [];
  let order = 0;
  const walk = (node: any) => {
    if (!node || node.activeInHierarchy === false) return;
    const index = order++;
    // No camera can see this layer, so nothing here is on screen.
    const camera = getRenderCamera(node);
    if (camera) {
      const ray = getRay(rays, camera, screen);
      const priority = camera.priority || 0;
      const distance = hitsModel(node, ray);
      if (distance !== null) {
        hits.push({ node, priority, kind: "3d", distance, order: index });
      } else if (
        isUiCandidate(node, renderableOnly) &&
        hitsRect(node, camera, ray, screen)
      ) {
        hits.push({ node, priority, kind: "2d", distance: 0, order: index });
      }
    }
    for (const child of node.children || []) walk(child);
  };
  walk(scene);

  hits.sort(compareBackToFront);
  return hits.map((hit) => hit.node).reverse();
}

function isUiCandidate(node: any, renderableOnly: boolean): boolean {
  if (!renderableOnly) return true;
  const renderComp = getRenderComp(node);
  return (
    !!renderComp &&
    renderComp.enabledInHierarchy !== false &&
    effectiveAlpha(node, renderComp) > ALPHA_EPSILON
  );
}
