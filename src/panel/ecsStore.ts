import type { EcsEntityDump, EcsSystemSample, EcsTreeNode } from "@shared/protocol";

export const MAX_ECS_SAMPLES = 120;
export const ECS_POLL_STORAGE_KEY = "cc-runtime::ecsPollMs";
export const ECS_POLL_OPTIONS = [
  { value: 100, label: "100 ms" },
  { value: 200, label: "200 ms" },
  { value: 500, label: "500 ms" },
  { value: 1000, label: "1 s" },
  { value: 0, label: "暂停" },
] as const;

export type EcsState = {
  available: boolean;
  tree: EcsTreeNode | null;
  selectedEntityId: number | null;
  entityDump: EcsEntityDump | null;
  pollMs: number;
  systemsRunning: boolean;
  systemSamples: EcsSystemSample[];
  search: string;
  expandedKeys: string[];
};

type Listener = () => void;

function loadPollMs(): number {
  try {
    const n = Number(localStorage.getItem(ECS_POLL_STORAGE_KEY));
    if (ECS_POLL_OPTIONS.some((o) => o.value === n)) return n;
  } catch {
    /* ignore */
  }
  return 500;
}

let state: EcsState = {
  available: false,
  tree: null,
  selectedEntityId: null,
  entityDump: null,
  pollMs: loadPollMs(),
  systemsRunning: false,
  systemSamples: [],
  search: "",
  expandedKeys: [],
};

const listeners = new Set<Listener>();

export function getEcsState() {
  return state;
}

export function setEcsState(partial: Partial<EcsState>) {
  if (partial.pollMs !== undefined && partial.pollMs !== state.pollMs) {
    try {
      localStorage.setItem(ECS_POLL_STORAGE_KEY, String(partial.pollMs));
    } catch {
      /* ignore */
    }
  }
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function subscribeEcs(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function defaultExpanded(tree: EcsTreeNode | null): string[] {
  if (!tree) return [];
  const keys = [tree.id];
  for (const child of tree.children || []) keys.push(child.id);
  return keys;
}

export function pushEcsSystemSample(sample: EcsSystemSample) {
  const samples = [...state.systemSamples, sample];
  if (samples.length > MAX_ECS_SAMPLES) {
    samples.splice(0, samples.length - MAX_ECS_SAMPLES);
  }
  setEcsState({ systemSamples: samples });
}

export function resetEcs() {
  setEcsState({
    available: false,
    tree: null,
    selectedEntityId: null,
    entityDump: null,
    systemsRunning: false,
    systemSamples: [],
    search: "",
    expandedKeys: [],
  });
}
