import {
  EMPTY_NODE_DRAW_CALLS,
  type NodeDetails,
  type NodeDrawCalls,
  type SceneNodeData,
} from "@shared/protocol";

export type AppState = {
  injecting: boolean;
  inspecting: boolean;
  scene: SceneNodeData | null;
  selectedId: string | null;
  details: NodeDetails | null;
  search: string;
  compTypeFilter: string[];
  expandedKeys: string[];
  flashNodeId: string | null;
  assets: Record<string, any>;
  /** Only populated while the profiler is capturing. */
  nodeDc: NodeDrawCalls;
};

type Listener = () => void;

let state: AppState = {
  injecting: true,
  inspecting: false,
  scene: null,
  selectedId: null,
  details: null,
  search: "",
  compTypeFilter: [],
  expandedKeys: [],
  flashNodeId: null,
  assets: {},
  nodeDc: EMPTY_NODE_DRAW_CALLS,
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
  return () => {
    listeners.delete(listener);
  };
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

export function normalizeCompType(type: unknown): string {
  if (typeof type !== "string") return "";
  return type.replace(/^cc\./i, "").toLowerCase();
}

/** Collect unique component type display names from the scene (sorted). */
export function collectCompTypes(
  node: SceneNodeData | null | undefined,
  out: Set<string> = new Set(),
): string[] {
  if (!node) return [...out].sort((a, b) => a.localeCompare(b));
  for (const c of node.components || []) {
    const t = typeof c?.type === "string" ? c.type : "";
    if (t) out.add(t);
  }
  node.children?.forEach((c) => collectCompTypes(c, out));
  return [...out].sort((a, b) => a.localeCompare(b));
}

export type MatchFilter = {
  keyword?: string;
  compTypes?: string[];
};

function nodeMatches(node: SceneNodeData, filter: MatchFilter): boolean {
  const kw = filter.keyword?.trim().toLowerCase() || "";
  const types = filter.compTypes || [];
  if (kw && !node.name?.toLowerCase().includes(kw)) return false;
  if (types.length) {
    const wanted = new Set(types.map(normalizeCompType).filter(Boolean));
    const has = (node.components || []).some((c) =>
      wanted.has(normalizeCompType(c?.type)),
    );
    if (!has) return false;
  }
  return true;
}

/**
 * Flat list of matching nodes (no parents). Returns null when no filter is active.
 */
export function collectMatchingNodes(
  node: SceneNodeData | null,
  filter: MatchFilter,
): SceneNodeData[] | null {
  const kw = filter.keyword?.trim() || "";
  const types = filter.compTypes || [];
  if (!kw && !types.length) return null;
  if (!node) return [];

  const out: SceneNodeData[] = [];
  const walk = (n: SceneNodeData) => {
    if (nodeMatches(n, filter)) {
      out.push({ ...n, children: [] });
    }
    n.children?.forEach(walk);
  };
  walk(node);
  return out;
}
