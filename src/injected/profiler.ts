import { Event, Rpc, type ProfilerSample } from "../shared/protocol";
import {
  startDrawCallHooks,
  stopDrawCallHooks,
  takeNodeDrawCalls,
} from "./drawCall";
import { registerHandler, sendEvent } from "./message";

declare const cc: any;

/** Aggregation window, matches the engine profiler's own 500ms cadence. */
const WINDOW_MS = 500;

/** Closing DevTools cannot notify the page, so stop after this many
 * unanswered windows instead of hooking the game forever. */
const MAX_UNACKED_WINDOWS = 10;

const round2 = (v: number) => Math.round(v * 100) / 100;
const toMB = (bytes: unknown) =>
  typeof bytes === "number" ? round2(bytes / (1024 * 1024)) : 0;

/** Accumulates a timed section and reports its average over one window. */
class Counter {
  private startedAt = 0;
  private sum = 0;
  private count = 0;

  start(now: number) {
    this.startedAt = now;
  }

  end(now: number) {
    // Hooking mid-frame leaves the section without a start; skip it.
    if (!this.startedAt) return;
    this.sum += now - this.startedAt;
    this.startedAt = 0;
    this.count++;
  }

  flush(): number {
    const avg = this.count ? this.sum / this.count : 0;
    this.sum = 0;
    this.count = 0;
    return round2(avg);
  }

  reset() {
    this.startedAt = 0;
    this.sum = 0;
    this.count = 0;
  }
}

const counters = {
  frame: new Counter(),
  logic: new Counter(),
  physics: new Counter(),
  render: new Counter(),
  present: new Counter(),
};

let running = false;
let frames = 0;
let windowStart = 0;
let unackedWindows = 0;

const now = () => performance.now();

function onBeforeUpdate() {
  const t = now();
  counters.frame.start(t);
  counters.logic.start(t);
}

function onAfterUpdate() {
  const t = now();
  // While paused no logic runs, so restart the frame timer instead of
  // recording a bogus multi-second logic duration.
  if (cc.director.isPaused?.()) counters.frame.start(t);
  else counters.logic.end(t);
}

function onBeforePhysics() {
  counters.physics.start(now());
}

function onAfterPhysics() {
  counters.physics.end(now());
}

function onBeforeDraw() {
  counters.render.start(now());
}

function onAfterRender() {
  const t = now();
  counters.render.end(t);
  counters.present.start(t);
}

function onAfterDraw() {
  const t = now();
  counters.frame.end(t);
  counters.present.end(t);
  frames++;
  if (t - windowStart >= WINDOW_MS) flushWindow(t);
}

function flushWindow(t: number) {
  const elapsed = t - windowStart;
  const device = cc.director.root?.device;
  const memory = (performance as any).memory;

  const sample: ProfilerSample = {
    t: Math.round(t),
    fps: elapsed > 0 ? round2((frames * 1000) / elapsed) : 0,
    frame: counters.frame.flush(),
    logic: counters.logic.flush(),
    physics: counters.physics.flush(),
    render: counters.render.flush(),
    present: counters.present.flush(),
    draws: device?.numDrawCalls || 0,
    instances: device?.numInstances || 0,
    tricount: device?.numTris || 0,
    textureMemory: toMB(device?.memoryStatus?.textureSize),
    bufferMemory: toMB(device?.memoryStatus?.bufferSize),
  };
  if (memory) {
    sample.jsHeap = toMB(memory.usedJSHeapSize);
    sample.jsHeapLimit = toMB(memory.jsHeapSizeLimit);
  }

  frames = 0;
  windowStart = t;

  if (unackedWindows >= MAX_UNACKED_WINDOWS) {
    stop();
    return;
  }
  unackedWindows++;
  sendEvent(Event.profilerSample, sample).then(() => {
    unackedWindows = 0;
  });
  sendEvent(Event.nodeDrawCalls, takeNodeDrawCalls());
}

type FrameHook = [event: string | undefined, callback: () => void];

/** Physics events only exist when the physics module is bundled. */
function frameHooks(): FrameHook[] {
  const Director = cc.Director || {};
  return [
    [Director.EVENT_BEFORE_UPDATE, onBeforeUpdate],
    [Director.EVENT_AFTER_UPDATE, onAfterUpdate],
    [Director.EVENT_BEFORE_PHYSICS, onBeforePhysics],
    [Director.EVENT_AFTER_PHYSICS, onAfterPhysics],
    [Director.EVENT_BEFORE_DRAW, onBeforeDraw],
    [Director.EVENT_AFTER_RENDER, onAfterRender],
    [Director.EVENT_AFTER_DRAW, onAfterDraw],
  ];
}

function resetCounters() {
  Object.values(counters).forEach((c) => c.reset());
  frames = 0;
  unackedWindows = 0;
}

function start() {
  if (running) return;
  running = true;
  resetCounters();
  windowStart = now();
  for (const [event, callback] of frameHooks()) {
    if (event) cc.director.on(event, callback);
  }
  startDrawCallHooks();
}

function stop() {
  if (!running) return;
  running = false;
  for (const [event, callback] of frameHooks()) {
    if (event) cc.director.off(event, callback);
  }
  stopDrawCallHooks();
  resetCounters();
}

export function hookProfiler() {
  registerHandler(Rpc.profilerStart, () => {
    start();
    return true;
  });
  registerHandler(Rpc.profilerStop, () => {
    stop();
    return true;
  });
}
