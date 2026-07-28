declare const cc: any;

/**
 * DOM client coords <-> Cocos screen space (physical pixels, origin bottom-left).
 *
 * The engine's own input path is the reference: anything that disagrees with
 * `mouse-input._getLocation()` picks the wrong node. That means honouring both
 * `screenAdapter.devicePixelRatio` and `isFrameRotated`, which the browser's
 * bounding rect knows nothing about.
 */

export interface Vec2Like {
  x: number;
  y: number;
}

/** The canvas the game renders into, or null before the engine boots one. */
export function getGameCanvas(): HTMLCanvasElement | null {
  const fromEngine = cc.game?.canvas as HTMLCanvasElement | undefined;
  if (fromEngine) return fromEngine;
  return (
    (document.querySelector("#GameCanvas") as HTMLCanvasElement | null) ||
    (document.querySelector("canvas") as HTMLCanvasElement | null)
  );
}

function getScreenAdapter(): any {
  return cc.screen?._screenAdapter || cc.screenAdapter || null;
}

function getDpr(): number {
  const sa = getScreenAdapter();
  const dpr = sa?.devicePixelRatio;
  if (typeof dpr === "number" && dpr > 0) return dpr;
  return cc.view?.getDevicePixelRatio?.() || window.devicePixelRatio || 1;
}

export function clientToScreen(clientX: number, clientY: number): Vec2Like {
  const canvas = getGameCanvas();
  if (!canvas) return { x: clientX, y: clientY };
  const rect = canvas.getBoundingClientRect();
  let x = clientX - rect.x;
  let y = rect.y + rect.height - clientY;
  if (getScreenAdapter()?.isFrameRotated) {
    const tmp = x;
    x = rect.height - y;
    y = tmp;
  }
  const dpr = getDpr();
  return { x: x * dpr, y: y * dpr };
}

/** Inverse of `clientToScreen`, for placing the highlight overlay. */
export function screenToClient(screenX: number, screenY: number): Vec2Like {
  const canvas = getGameCanvas();
  if (!canvas) return { x: screenX, y: screenY };
  const rect = canvas.getBoundingClientRect();
  const dpr = getDpr();
  let x = screenX / dpr;
  let y = screenY / dpr;
  if (getScreenAdapter()?.isFrameRotated) {
    const tmp = x;
    x = y;
    y = rect.height - tmp;
  }
  return { x: rect.x + x, y: rect.y + rect.height - y };
}

/** Node-local rect from contentSize + anchorPoint, null when it has no area. */
export interface LocalRect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export function getLocalRect(node: any): LocalRect | null {
  const ut =
    node?._uiProps?.uiTransformComp ||
    (cc.UITransform ? node?.getComponent?.(cc.UITransform) : null);
  if (!ut) return null;
  const size = ut.contentSize;
  const width = size?.width || 0;
  const height = size?.height || 0;
  if (width <= 0 || height <= 0) return null;
  const anchor = ut.anchorPoint;
  const ax = anchor?.x ?? 0.5;
  const ay = anchor?.y ?? 0.5;
  return {
    left: -ax * width,
    right: (1 - ax) * width,
    bottom: -ay * height,
    top: (1 - ay) * height,
  };
}

/** World-space axis-aligned box, matching the engine's AABB layout. */
export interface WorldBounds {
  center: Vec3Like3;
  halfExtents: Vec3Like3;
}

export interface Vec3Like3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Render models of a 3D node.
 *
 * Deliberately looked up by component class rather than by duck-typing `.model`:
 * 2D `Graphics` also owns a Model, and treating it as 3D geometry would take it
 * out of the UI draw-order path it actually belongs to.
 */
function modelsOf(node: any): any[] {
  const keys = ["ModelRenderer", "MeshRenderer", "SkinnedMeshRenderer"];
  for (const key of keys) {
    const Cls = cc[key];
    if (typeof Cls !== "function") continue;
    const comp = node.getComponent?.(Cls);
    if (!comp || comp.enabledInHierarchy === false) continue;
    if (comp.model) return [comp.model];
    const models = comp.models || comp._models;
    if (Array.isArray(models) && models.length) return models;
  }
  return [];
}

/** Union of the node's model bounds, or null when it draws no 3D geometry. */
export function getWorldBounds(node: any): WorldBounds | null {
  const models = modelsOf(node);
  if (!models.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const model of models) {
    const bounds = model?.worldBounds;
    const c = bounds?.center;
    const h = bounds?.halfExtents;
    if (!c || !h) continue;
    minX = Math.min(minX, c.x - h.x);
    minY = Math.min(minY, c.y - h.y);
    minZ = Math.min(minZ, c.z - h.z);
    maxX = Math.max(maxX, c.x + h.x);
    maxY = Math.max(maxY, c.y + h.y);
    maxZ = Math.max(maxZ, c.z + h.z);
  }
  if (minX > maxX) return null;
  return {
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    halfExtents: {
      x: (maxX - minX) / 2,
      y: (maxY - minY) / 2,
      z: (maxZ - minZ) / 2,
    },
  };
}

/**
 * The camera that draws `node`, i.e. the first one in priority order whose
 * visibility mask covers the node's layer — same rule the batcher uses.
 */
export function getRenderCamera(node: any): any {
  const batcher = cc.director?.root?.batcher2D;
  if (typeof batcher?.getFirstRenderCamera === "function") {
    try {
      const camera = batcher.getFirstRenderCamera(node);
      if (camera) return camera;
    } catch {
      /* fall through to the manual scan */
    }
  }
  const cameras = (node?.scene || cc.director?.getScene())?.renderScene?.cameras;
  if (!cameras) return null;
  for (const camera of cameras) {
    if (camera?.visibility & node.layer) return camera;
  }
  return null;
}
