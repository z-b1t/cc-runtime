import {
  Event,
  Rpc,
  type EcsEntityDump,
  type EcsSystemSample,
  type EcsSystemStat,
  type EcsTreeNode,
} from "../shared/protocol";
import { registerHandler, sendEvent } from "./message";

declare const cc: any;

/** Closing the panel cannot notify the page; stop wrapping after this many
 * unanswered sample windows instead of hooking systems forever. */
const MAX_UNACKED_WINDOWS = 10;

const ORIG_FLAG = "__ccEcsOrigOnUpdate";

const ENTITY_TYPE_NAMES: Record<number, string> = {
  0: "UNKNOWN",
  1: "HERO",
  2: "PET",
  3: "MONSTER",
  4: "MAGIC_UNIT",
  5: "TRAP",
  6: "BARRIER",
  7: "ITEM",
  8: "TRIGGER",
};

const CAMP_NAMES: Record<number, string> = {
  0: "NEUTRAL",
  1: "PLAYER",
  2: "ENEMY",
};

const SKIP_KEYS = new Set([
  "owner",
  "world",
  "events",
  "constructor",
]);

const round2 = (v: number) => Math.round(v * 100) / 100;

type TimingAcc = { sum: number; peak: number; calls: number };

let pollMs = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let timing = false;
let unackedWindows = 0;
let wrappedWorld: any = null;
const timingAcc = new Map<string, TimingAcc>();

function isBattle(obj: any): boolean {
  return !!(
    obj &&
    obj.world &&
    typeof obj.world.getAllEntities === "function" &&
    obj.clock
  );
}

function battleFromComp(comp: any): any {
  if (!comp) return null;
  if (isBattle(comp._battle)) return comp._battle;
  if (isBattle(comp.battle)) return comp.battle;
  const view = comp.battleView;
  if (view && isBattle(view._battle)) return view._battle;
  return null;
}

function classNameOf(comp: any): string {
  return String(comp?.__classname__ || comp?.constructor?.name || "");
}

function walkNode(node: any, preferred: any[], rest: any[]): void {
  if (!node) return;
  const comps = node.components || [];
  for (let i = 0; i < comps.length; i++) {
    const comp = comps[i];
    const battle = battleFromComp(comp);
    if (!battle) continue;
    if (classNameOf(comp) === "BattleView") preferred.push(battle);
    else rest.push(battle);
  }
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    walkNode(children[i], preferred, rest);
  }
}

function findBattle(): any {
  const scene = cc.director?.getScene?.();
  if (!scene) return null;
  const preferred: any[] = [];
  const rest: any[] = [];
  walkNode(scene, preferred, rest);
  return preferred[0] || rest[0] || null;
}

function typeNameOf(type: unknown): string {
  if (typeof type === "number" && ENTITY_TYPE_NAMES[type]) return ENTITY_TYPE_NAMES[type];
  if (typeof type === "string" && type) return type;
  return String(type ?? "UNKNOWN");
}

function campNameOf(camp: unknown): string {
  if (typeof camp === "number" && CAMP_NAMES[camp]) return CAMP_NAMES[camp];
  if (typeof camp === "string" && camp) return camp;
  return String(camp ?? "NEUTRAL");
}

function isFixedNumber(v: any): boolean {
  return !!(
    v &&
    typeof v === "object" &&
    typeof v.toNumber === "function" &&
    "rawValue" in v
  );
}

function dumpValue(v: any, seen: WeakSet<object>, depth: number): unknown {
  if (v == null) return v;
  if (depth > 6) return undefined;
  const t = typeof v;
  if (t === "string" || t === "boolean") return v;
  if (t === "number") return Number.isFinite(v) ? v : undefined;
  if (t !== "object") return undefined;
  if (seen.has(v)) return undefined;
  seen.add(v);
  if (isFixedNumber(v)) {
    try {
      return v.toNumber();
    } catch {
      return undefined;
    }
  }
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    v.forEach((val, key) => {
      const d = dumpValue(val, seen, depth + 1);
      if (d !== undefined) out[String(key)] = d;
    });
    return out;
  }
  if (v instanceof Set) {
    return Array.from(v)
      .map((item) => dumpValue(item, seen, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (Array.isArray(v)) {
    return v.map((item) => dumpValue(item, seen, depth + 1));
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (SKIP_KEYS.has(key) || key.charAt(0) === "_") continue;
    let val: unknown;
    try {
      val = v[key];
    } catch {
      continue;
    }
    if (typeof val === "function") continue;
    const d = dumpValue(val, seen, depth + 1);
    if (d !== undefined) out[key] = d;
  }
  return out;
}

function buildTree(battle: any): EcsTreeNode {
  const entities =
    typeof battle.world.getAllEntities === "function"
      ? battle.world.getAllEntities()
      : [];
  const frame = battle.clock?.frameCount ?? 0;
  const groups = new Map<string, EcsTreeNode>();
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent || ent.isDestroyed) continue;
    const typeName = typeNameOf(ent.entityType);
    let group = groups.get(typeName);
    if (!group) {
      group = {
        id: `type-${typeName}`,
        name: typeName,
        kind: "group",
        children: [],
      };
      groups.set(typeName, group);
    }
    const id = ent.id;
    group.children!.push({
      id: `ent-${id}`,
      name: String(id),
      kind: "entity",
      entityId: id,
    });
  }
  const children: EcsTreeNode[] = [];
  groups.forEach((group) => {
    group.name = `${group.name} (${group.children!.length})`;
    children.push(group);
  });
  children.sort((a, b) => a.id.localeCompare(b.id));
  return {
    id: "ecs-root",
    name: `Battle frame=${frame} count=${entities.length}`,
    kind: "world",
    children,
  };
}

function dumpEntity(battle: any, entityId: number): EcsEntityDump | null {
  const entity =
    typeof battle.world.getEntity === "function"
      ? battle.world.getEntity(entityId)
      : null;
  if (!entity || entity.isDestroyed) return null;
  const comps = entity._components || {};
  const components: Record<string, unknown> = {};
  const names = Object.keys(comps);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    components[name] = dumpValue(comps[name], new WeakSet(), 0);
  }
  return {
    id: entity.id,
    type: entity.entityType,
    typeName: typeNameOf(entity.entityType),
    camp: entity.camp,
    campName: campNameOf(entity.camp),
    templateId: entity.templateId ? String(entity.templateId) : "",
    components,
  };
}

function record(name: string, ms: number): void {
  let acc = timingAcc.get(name);
  if (!acc) {
    acc = { sum: 0, peak: 0, calls: 0 };
    timingAcc.set(name, acc);
  }
  acc.sum += ms;
  acc.calls += 1;
  if (ms > acc.peak) acc.peak = ms;
}

function wrapSystems(world: any): void {
  if (!world) return;
  if (wrappedWorld && wrappedWorld !== world) unwrapSystems(wrappedWorld);
  wrappedWorld = world;
  const systems = world._systemsOrdered || [];
  for (let i = 0; i < systems.length; i++) {
    const sys = systems[i];
    if (!sys || sys[ORIG_FLAG]) continue;
    const orig = sys.onUpdate.bind(sys);
    sys[ORIG_FLAG] = orig;
    sys.onUpdate = function onUpdateTimed(dt: unknown) {
      const t0 = performance.now();
      orig(dt);
      record(String(sys.name || "System"), performance.now() - t0);
    };
  }
}

function unwrapSystems(world: any): void {
  const systems = world?._systemsOrdered || [];
  for (let i = 0; i < systems.length; i++) {
    const sys = systems[i];
    if (!sys || !sys[ORIG_FLAG]) continue;
    delete sys.onUpdate;
    delete sys[ORIG_FLAG];
  }
  if (wrappedWorld === world) wrappedWorld = null;
}

function entityCountOf(sys: any): number | undefined {
  if (typeof sys.getEntities !== "function") return undefined;
  try {
    const list = sys.getEntities();
    return Array.isArray(list) ? list.length : undefined;
  } catch {
    return undefined;
  }
}

function flushSample(world: any): EcsSystemSample {
  const byName = new Map<string, EcsSystemStat>();
  timingAcc.forEach((acc, name) => {
    byName.set(name, {
      name,
      avgMs: acc.calls ? round2(acc.sum / acc.calls) : 0,
      peakMs: round2(acc.peak),
      calls: acc.calls,
    });
  });
  timingAcc.clear();

  const systems: EcsSystemStat[] = [];
  const ordered = world?._systemsOrdered || [];
  for (let i = 0; i < ordered.length; i++) {
    const sys = ordered[i];
    const name = String(sys?.name || `System${i}`);
    const stat = byName.get(name) || {
      name,
      avgMs: 0,
      peakMs: 0,
      calls: 0,
    };
    byName.delete(name);
    const count = entityCountOf(sys);
    if (count !== undefined) stat.entityCount = count;
    systems.push(stat);
  }
  byName.forEach((stat) => systems.push(stat));

  let frameMs = 0;
  for (let i = 0; i < systems.length; i++) frameMs += systems[i].avgMs;
  return {
    t: Math.round(performance.now()),
    frameMs: round2(frameMs),
    systems,
  };
}

function stopTiming(): void {
  timing = false;
  unackedWindows = 0;
  timingAcc.clear();
  if (wrappedWorld) unwrapSystems(wrappedWorld);
}

function pushUnavailable(): void {
  sendEvent(Event.ecsUnavailable, null);
}

function tick(): void {
  const battle = findBattle();
  if (!battle) {
    if (timing) stopTiming();
    pushUnavailable();
    return;
  }
  sendEvent(Event.ecsTree, buildTree(battle));
  if (!timing) return;
  wrapSystems(battle.world);
  if (unackedWindows >= MAX_UNACKED_WINDOWS) {
    stopTiming();
    return;
  }
  unackedWindows += 1;
  const sample = flushSample(battle.world);
  sendEvent(Event.ecsSystemSample, sample).then(() => {
    unackedWindows = 0;
  });
}

function restartTimer(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (pollMs > 0) {
    pollTimer = setInterval(tick, pollMs);
    tick();
  }
}

function refresh(): boolean {
  const battle = findBattle();
  if (!battle) {
    pushUnavailable();
    return false;
  }
  sendEvent(Event.ecsTree, buildTree(battle));
  return true;
}

export function hookEcs() {
  registerHandler(Rpc.ecsRefresh, () => refresh());
  registerHandler(Rpc.ecsGetEntity, (id) => {
    const entityId = Number(id);
    if (!Number.isFinite(entityId)) return null;
    const battle = findBattle();
    if (!battle) return null;
    return dumpEntity(battle, entityId);
  });
  registerHandler(Rpc.ecsProfilerStart, () => {
    const battle = findBattle();
    if (!battle) return false;
    timing = true;
    unackedWindows = 0;
    timingAcc.clear();
    wrapSystems(battle.world);
    tick();
    return true;
  });
  registerHandler(Rpc.ecsProfilerStop, () => {
    stopTiming();
    return true;
  });
  registerHandler(Rpc.ecsSetInterval, (ms) => {
    const next = Number(ms);
    pollMs = Number.isFinite(next) && next > 0 ? next : 0;
    restartTimer();
    return true;
  });
}
