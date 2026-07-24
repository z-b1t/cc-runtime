import type { NodeDetails, SceneNodeData } from "@shared/protocol";

export type AppState = {
  injecting: boolean;
  inspecting: boolean;
  scene: SceneNodeData | null;
  selectedId: string | null;
  details: NodeDetails | null;
  search: string;
  expandedKeys: string[];
  flashNodeId: string | null;
  assets: Record<string, any>;
};

type Listener = () => void;

let state: AppState = {
  injecting: true,
  inspecting: false,
  scene: null,
  selectedId: null,
  details: null,
  search: "",
  expandedKeys: [],
  flashNodeId: null,
  assets: {},
};

const listeners = new Set<Listener>();

export function getState() {
  return state;
}

export function setState(partial: Partial<AppState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function collectIds(node: SceneNodeData | null | undefined, out: string[] = []) {
  if (!node) return out;
  out.push(node.id);
  node.children?.forEach((c) => collectIds(c, out));
  return out;
}

export function findNode(
  node: SceneNodeData | null | undefined,
  id: string,
): SceneNodeData | null {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

/** Ancestor ids from root to parent of `id` (not including `id`). */
export function findPathIds(
  node: SceneNodeData | null | undefined,
  id: string,
  path: string[] = [],
): string[] | null {
  if (!node) return null;
  if (node.id === id) return path;
  const next = [...path, node.id];
  for (const c of node.children || []) {
    const found = findPathIds(c, id, next);
    if (found) return found;
  }
  return null;
}

export function filterTree(
  node: SceneNodeData | null,
  keyword: string,
): SceneNodeData | null {
  if (!node) return null;
  if (!keyword) return node;
  const kw = keyword.toLowerCase();
  const children = (node.children || [])
    .map((c) => filterTree(c, keyword))
    .filter(Boolean) as SceneNodeData[];
  if (node.name?.toLowerCase().includes(kw) || children.length) {
    return { ...node, children };
  }
  return null;
}
