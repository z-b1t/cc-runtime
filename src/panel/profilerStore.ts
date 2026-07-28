import type { ProfilerSample } from "@shared/protocol";

/** 120 samples at 500ms each = last 60 seconds. */
export const MAX_SAMPLES = 120;

export type ProfilerState = {
  running: boolean;
  samples: ProfilerSample[];
};

type Listener = () => void;

let state: ProfilerState = {
  running: false,
  samples: [],
};

const listeners = new Set<Listener>();

/**
 * Samples land here instead of the main store because NodeTree re-renders on
 * every main store change, and a 500ms sample cadence would drag the tree.
 */
export function getProfilerState() {
  return state;
}

export function setProfilerState(partial: Partial<ProfilerState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function subscribeProfiler(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pushSample(sample: ProfilerSample) {
  const samples = [...state.samples, sample];
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  setProfilerState({ samples });
}

export function resetProfiler() {
  setProfilerState({ running: false, samples: [] });
}
