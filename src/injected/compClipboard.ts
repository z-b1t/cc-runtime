import {
  type ComponentClipboardPayload,
  type NodeClipboardPayload,
  Rpc,
} from "../shared/protocol";
import { cleanFloat } from "../shared/number";
import { parseAttrs, serializeValue } from "./attrs";
import { registerHandler } from "./message";
import { getMutatorById, Mutator, symbolMutate } from "./mutator";

declare const cc: any;

const SKIP_DUMP_KEYS = new Set([
  "uuid",
  "__prefab",
  "__scriptAsset",
  "node",
  "_id",
  "__classname__",
  "__cid__",
]);

function classNameOf(sample: any): string | undefined {
  return sample?.__classname__ || sample?.constructor?.__classname__;
}

function isValueType(sample: any): boolean {
  try {
    return !!(cc?.ValueType && sample instanceof cc.ValueType);
  } catch {
    return false;
  }
}

function isAsset(obj: any): boolean {
  try {
    return !!(
      obj &&
      typeof cc.Asset === "function" &&
      obj instanceof cc.Asset
    );
  } catch {
    return false;
  }
}

function isNodeOrComp(obj: any): boolean {
  try {
    if (obj instanceof cc.Node) return true;
    if (typeof cc.Component === "function" && obj instanceof cc.Component) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function objectUuid(obj: any): string {
  if (!obj) return "";
  return String(obj._uuid || obj.uuid || obj._id || "");
}

function editorTypeName(attrType: string, typeName?: string): string {
  switch (attrType) {
    case "boolean":
      return "Boolean";
    case "string":
      return "String";
    case "number":
      return "Float";
    case "enum":
    case "bitMask":
      return "Enum";
    case "color":
      return "cc.Color";
    case "valueMap":
      return typeName || "cc.ValueType";
    case "object":
      return typeName || "cc.Object";
    case "eventHandlerArray":
      return "cc.Component.EventHandler";
    default:
      return typeName || attrType || "Unknown";
  }
}

function dumpNode(
  value: any,
  type: string,
  extra: Record<string, unknown> = {},
) {
  return { value, type, ...extra };
}

function dumpLiveValue(val: any, attr: any): any {
  if (val == null) {
    if (attr.type === "object") return { uuid: "" };
    return val;
  }
  switch (attr.type) {
    case "object": {
      if (isAsset(val) || isNodeOrComp(val)) {
        return { uuid: objectUuid(val) };
      }
      const uuid = objectUuid(val);
      if (uuid) return { uuid };
      return null;
    }
    case "color":
      return {
        r: Number(val.r) || 0,
        g: Number(val.g) || 0,
        b: Number(val.b) || 0,
        a: val.a == null ? 255 : Number(val.a),
      };
    case "valueMap":
      return serializeValue(val, attr.typeName);
    case "sub": {
      const out: Record<string, any> = {};
      for (const s of attr.subAttrs || []) {
        out[s.name] = dumpNode(
          dumpLiveValue(val?.[s.name], s),
          editorTypeName(s.type, s.typeName),
        );
      }
      return out;
    }
    case "eventHandlerArray": {
      const list = Array.isArray(val) ? val : [];
      return list.map((eh: any) => ({
        target: { uuid: objectUuid(eh?.target) },
        component: eh?.component || eh?._componentName || "",
        handler: eh?.handler || "",
        customEventData: eh?.customEventData || "",
      }));
    }
    default:
      if (typeof val === "object") return serializeValue(val, attr.typeName);
      return val;
  }
}

/** Plain JSON snapshot used for reliable runtime paste (panel ↔ game). */
function snapshotRuntimeProp(val: any, attr?: any): any {
  if (val == null) return val;
  const type = attr?.type;
  const typeName = attr?.typeName || classNameOf(val);

  if (type === "object" || isAsset(val) || isNodeOrComp(val)) {
    if (typeof val !== "object") return val;
    return { __uuid: objectUuid(val), __type: classNameOf(val) || typeName };
  }
  if (type === "color" || typeName === "cc.Color" || (val && val._val != null && typeof val.r === "number")) {
    return {
      __vt: "cc.Color",
      r: Number(val.r) || 0,
      g: Number(val.g) || 0,
      b: Number(val.b) || 0,
      a: val.a == null ? 255 : Number(val.a),
    };
  }
  if (type === "valueMap" || isValueType(val)) {
    const plain = serializeValue(val, typeName);
    return { __vt: typeName || classNameOf(val) || "cc.ValueType", ...plain };
  }
  if (type === "sub" && val && typeof val === "object") {
    const out: Record<string, any> = { __sub: true };
    for (const s of attr?.subAttrs || []) {
      out[s.name] = snapshotRuntimeProp(val[s.name], s);
    }
    return out;
  }
  if (type === "eventHandlerArray" && Array.isArray(val)) {
    return val.map((eh: any) => ({
      __eh: true,
      target: objectUuid(eh?.target),
      component: eh?.component || eh?._componentName || "",
      handler: eh?.handler || "",
      customEventData: eh?.customEventData || "",
    }));
  }
  if (typeof val === "object") {
    if (isValueType(val)) {
      const plain = serializeValue(val, typeName);
      return { __vt: typeName || classNameOf(val), ...plain };
    }
    return serializeValue(val, typeName);
  }
  return val;
}

function captureRuntimeProps(comp: any): Record<string, any> {
  const props: Record<string, any> = {
    enabled: !!comp.enabled,
  };
  try {
    const { attrs } = parseAttrs(comp);
    for (const attr of attrs || []) {
      if (!attr?.name || SKIP_DUMP_KEYS.has(attr.name)) continue;
      if (attr.name === "enabled") continue;
      try {
        props[attr.name] = snapshotRuntimeProp(comp[attr.name], attr);
      } catch {
        /* skip one prop */
      }
    }
  } catch (err) {
    console.warn("[cc-runtime] captureRuntimeProps failed", err);
  }
  return props;
}

function resolveByUuid(uuid: string): any {
  if (!uuid) return null;
  try {
    const assets = cc.assetManager?.assets;
    if (assets?.get) {
      const a = assets.get(uuid);
      if (a) return a;
    }
    if (typeof cc.assetManager?.getAssetByUuid === "function") {
      return cc.assetManager.getAssetByUuid(uuid) || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function constructValueType(typeName: string, plain: any): any {
  if (!plain || typeof plain !== "object") return plain;
  const width = plain.width ?? plain.w;
  const height = plain.height ?? plain.h;
  try {
    if (typeName === "cc.Color" || ("r" in plain && "g" in plain && "b" in plain)) {
      return new cc.Color(
        Number(plain.r) || 0,
        Number(plain.g) || 0,
        Number(plain.b) || 0,
        plain.a == null || Number.isNaN(Number(plain.a)) ? 255 : Number(plain.a),
      );
    }
    if (typeName === "cc.Size" || (width != null && height != null && plain.x == null)) {
      return new cc.Size(Number(width) || 0, Number(height) || 0);
    }
    if (typeName === "cc.Rect") {
      return new cc.Rect(
        Number(plain.x) || 0,
        Number(plain.y) || 0,
        Number(width) || 0,
        Number(height) || 0,
      );
    }
    if (
      typeName === "cc.Vec3" ||
      (plain.z != null && plain.x != null && width == null)
    ) {
      return new cc.Vec3(
        Number(plain.x) || 0,
        Number(plain.y) || 0,
        Number(plain.z) || 0,
      );
    }
    if (
      typeName === "cc.Vec2" ||
      (plain.x != null && plain.y != null && plain.z == null && width == null)
    ) {
      return new cc.Vec2(Number(plain.x) || 0, Number(plain.y) || 0);
    }
    if (typeName === "cc.Vec4" || typeName === "cc.Quat") {
      const Cls = typeName === "cc.Quat" ? cc.Quat : cc.Vec4;
      return new Cls(
        Number(plain.x) || 0,
        Number(plain.y) || 0,
        Number(plain.z) || 0,
        Number(plain.w) || 0,
      );
    }
    const Cls = cc.js?.getClassByName?.(typeName);
    if (typeof Cls === "function") {
      const inst = new Cls();
      if (inst && typeof inst.set === "function") {
        // Prefer component-wise when plain is not a ValueType instance.
        if (isValueType(plain)) inst.set(plain);
        else if (plain.x != null) {
          try {
            inst.set(plain.x, plain.y, plain.z, plain.w);
          } catch {
            inst.set(plain);
          }
        } else {
          Object.assign(inst, plain);
        }
        return inst;
      }
      Object.assign(inst, plain);
      return inst;
    }
  } catch {
    /* ignore */
  }
  return plain;
}

/**
 * Assign a property so Cocos setters / render dirty run.
 * Never rely on in-place ValueType.set alone — many comps ignore it.
 */
function assignProp(comp: any, key: string, next: any) {
  const cur = comp[key];
  if (
    cur &&
    isValueType(cur) &&
    next &&
    typeof next === "object" &&
    isValueType(next) &&
    typeof cur.set === "function"
  ) {
    cur.set(next);
    // Re-assign to invoke property setter / mark render data dirty.
    comp[key] = cur;
    return;
  }
  comp[key] = next;
}

function materializeRuntimeProp(raw: any): any {
  if (raw == null || typeof raw !== "object") return raw;

  if (raw.__uuid !== undefined) {
    return resolveByUuid(String(raw.__uuid || ""));
  }
  if (raw.__vt) {
    const { __vt, ...plain } = raw;
    return constructValueType(String(__vt), plain);
  }
  if (raw.__sub) {
    const out: Record<string, any> = {};
    for (const k of Object.keys(raw)) {
      if (k === "__sub") continue;
      out[k] = materializeRuntimeProp(raw[k]);
    }
    return out;
  }
  if (Array.isArray(raw) && raw[0]?.__eh) {
    const EH = cc.Component?.EventHandler || cc.EventHandler;
    return raw.map((eh: any) => {
      const item = EH ? new EH() : {};
      item.target = resolveByUuid(String(eh.target || "")) || null;
      item.component = eh.component || "";
      item.handler = eh.handler || "";
      item.customEventData = eh.customEventData || "";
      return item;
    });
  }
  // Legacy plain color / vec without __vt tag
  if ("r" in raw && "g" in raw && "b" in raw && !("x" in raw)) {
    return constructValueType("cc.Color", raw);
  }
  if (("w" in raw || "width" in raw) && ("h" in raw || "height" in raw) && raw.x == null) {
    return constructValueType("cc.Size", raw);
  }
  if ("x" in raw && "y" in raw) {
    return constructValueType(raw.z != null ? "cc.Vec3" : "cc.Vec2", raw);
  }
  return raw;
}

function applyRuntimeProps(comp: any, props: Record<string, any>) {
  if (!comp || !props) return;
  for (const key of Object.keys(props)) {
    if (SKIP_DUMP_KEYS.has(key) || key === "name") continue;
    try {
      if (key === "enabled") {
        comp.enabled = !!props.enabled;
        continue;
      }
      const next = materializeRuntimeProp(props[key]);
      assignProp(comp, key, next);
    } catch (err) {
      console.warn("[cc-runtime] apply runtime prop failed", key, err);
    }
  }
}

function unwrapDumpValue(node: any): any {
  if (node == null || typeof node !== "object") return node;
  if (!("value" in node)) return node;
  return node.value;
}

function materializeDumpValue(raw: any, typeHint?: string): any {
  const v = unwrapDumpValue(raw);
  const type =
    (raw && typeof raw === "object" && raw.type) || typeHint || "";

  if (v == null) return null;

  if (typeof v === "object" && "uuid" in v && !("x" in v) && !("r" in v)) {
    return resolveByUuid(String(v.uuid || ""));
  }

  if (typeof v !== "object") return v;

  if (
    type === "sub" ||
    Object.values(v).some(
      (child) =>
        child &&
        typeof child === "object" &&
        "value" in child &&
        "type" in child,
    )
  ) {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) {
      out[k] = materializeDumpValue(v[k]);
    }
    return out;
  }

  if (type && String(type).startsWith("cc.")) {
    return constructValueType(String(type), v);
  }
  if ("r" in v && "g" in v && "b" in v) return constructValueType("cc.Color", v);
  if (("width" in v || "w" in v) && ("height" in v || "h" in v) && !("x" in v)) {
    return constructValueType("cc.Size", v);
  }
  if ("x" in v && "y" in v) {
    return constructValueType("z" in v ? "cc.Vec3" : "cc.Vec2", v);
  }
  return v;
}

function applyDumpToComponent(comp: any, payload: ComponentClipboardPayload) {
  // Prefer runtime snapshot for reliable in-panel paste.
  const runtime = (payload as any)?.runtime;
  if (runtime && typeof runtime === "object") {
    applyRuntimeProps(comp, runtime);
    return;
  }

  const dumpVal = payload?.dump?.value;
  if (!comp || !dumpVal || typeof dumpVal !== "object") {
    throw new Error("invalid component dump");
  }
  const cid = String(payload.cid || payload.dump?.cid || "");
  if (cid && comp.__cid__ && String(comp.__cid__) !== cid) {
    throw new Error(`cid mismatch: clipboard=${cid}, target=${comp.__cid__}`);
  }

  if (typeof dumpVal.enabled?.value === "boolean") {
    comp.enabled = dumpVal.enabled.value;
  } else if (typeof dumpVal.enabled === "boolean") {
    comp.enabled = dumpVal.enabled;
  }

  for (const key of Object.keys(dumpVal)) {
    if (SKIP_DUMP_KEYS.has(key) || key === "enabled" || key === "name") continue;
    const node = dumpVal[key];
    if (node && typeof node === "object" && node.readonly) continue;
    try {
      const next = materializeDumpValue(node);
      assignProp(comp, key, next);
    } catch (err) {
      console.warn("[cc-runtime] apply dump prop failed", key, err);
    }
  }
}

/** Build panel clipboard payload from a live component. */
export function dumpComponentForClipboard(
  comp: any,
): ComponentClipboardPayload | null {
  if (!comp) return null;
  const cid = String(comp.__cid__ || "");
  const type = String(comp.__classname__ || "");
  if (!cid && !type) return null;

  const value: Record<string, any> = {
    uuid: dumpNode(String(comp.uuid || comp._id || ""), "String", {
      visible: false,
    }),
    name: dumpNode(String(comp.name || type), "String"),
    enabled: dumpNode(!!comp.enabled, "Boolean"),
  };

  try {
    const { attrs } = parseAttrs(comp);
    for (const attr of attrs || []) {
      if (!attr?.name || SKIP_DUMP_KEYS.has(attr.name)) continue;
      if (attr.visible === false) continue;
      const live = comp[attr.name];
      value[attr.name] = dumpNode(
        dumpLiveValue(live, attr),
        editorTypeName(attr.type, attr.typeName),
        {
          readonly: !!attr.readonly,
          visible: attr.visible !== false,
          displayName: attr.displayName,
        },
      );
    }
  } catch (err) {
    console.warn("[cc-runtime] dumpComponentForClipboard attrs failed", err);
  }

  const dump = {
    type,
    cid,
    value,
  };
  delete (dump.value as any).__prefab;

  const runtime = captureRuntimeProps(comp);

  return { cid, dump, runtime } as ComponentClipboardPayload;
}

function resolveComponentClass(payload: ComponentClipboardPayload): any {
  const cid = String(payload.cid || payload.dump?.cid || "");
  const type = String(payload.dump?.type || "");
  let Cls =
    (cid && cc.js?.getClassById?.(cid)) ||
    (type && cc.js?.getClassByName?.(type)) ||
    null;
  if (!Cls && type && type.startsWith("cc.")) {
    const parts = type.split(".");
    let cur: any = cc;
    for (let i = 1; i < parts.length && cur; i++) cur = cur[parts[i]];
    if (typeof cur === "function") Cls = cur;
  }
  return Cls;
}

function vec3Plain(v: any) {
  return {
    x: cleanFloat(Number(v?.x) || 0),
    y: cleanFloat(Number(v?.y) || 0),
    z: cleanFloat(Number(v?.z) || 0),
  };
}

function dumpVec3Node(v: any) {
  const plain = vec3Plain(v);
  return dumpNode(
    {
      x: dumpNode(plain.x, "Float"),
      y: dumpNode(plain.y, "Float"),
      z: dumpNode(plain.z, "Float"),
    },
    "cc.Vec3",
  );
}

/** Panel node clipboard payload + runtime snapshot. */
export function dumpNodeForClipboard(node: any): NodeClipboardPayload | null {
  if (!node || !(node instanceof cc.Node)) return null;
  const position = vec3Plain(node.position);
  const eulerAngles = vec3Plain(node.eulerAngles);
  const scale = vec3Plain(node.scale);
  const layer = Number(node.layer) || 0;

  // Editor attrs use `rotation` for the euler rotation row.
  const dump: Record<string, any> = {
    position: dumpVec3Node(position),
    rotation: dumpVec3Node(eulerAngles),
    scale: dumpVec3Node(scale),
    layer: dumpNode(layer, "Enum"),
  };

  return {
    type: "cc.Node",
    attrs: ["position", "rotation", "scale", "layer"],
    dump,
    runtime: { position, eulerAngles, scale, layer },
  };
}

function applyNodeRuntime(node: any, runtime: NonNullable<NodeClipboardPayload["runtime"]>) {
  if (runtime.position) {
    assignProp(
      node,
      "position",
      new cc.Vec3(runtime.position.x, runtime.position.y, runtime.position.z),
    );
  }
  if (runtime.eulerAngles) {
    assignProp(
      node,
      "eulerAngles",
      new cc.Vec3(
        runtime.eulerAngles.x,
        runtime.eulerAngles.y,
        runtime.eulerAngles.z,
      ),
    );
  }
  if (runtime.scale) {
    assignProp(
      node,
      "scale",
      new cc.Vec3(runtime.scale.x, runtime.scale.y, runtime.scale.z),
    );
  }
  if (typeof runtime.layer === "number") {
    node.layer = runtime.layer;
  }
}

function applyNodeDump(node: any, payload: NodeClipboardPayload) {
  if (payload.runtime) {
    applyNodeRuntime(node, payload.runtime);
    return;
  }
  const attrs = payload.attrs || Object.keys(payload.dump || {});
  for (const attr of attrs) {
    const nodeDump = payload.dump?.[attr];
    if (!nodeDump) continue;
    try {
      if (attr === "layer") {
        const v = unwrapDumpValue(nodeDump);
        node.layer = typeof v === "number" ? v : Number(v) || 0;
        continue;
      }
      const plain = materializeDumpValue(nodeDump);
      // Nested editor dump: { value: { x:{value}, y:{}, z:{} }, type:'cc.Vec3' }
      const raw = unwrapDumpValue(nodeDump);
      const xyz =
        raw && typeof raw === "object" && raw.x != null && typeof raw.x === "object"
          ? {
              x: Number(unwrapDumpValue(raw.x)) || 0,
              y: Number(unwrapDumpValue(raw.y)) || 0,
              z: Number(unwrapDumpValue(raw.z)) || 0,
            }
          : plain && typeof plain === "object"
            ? {
                x: Number(plain.x) || 0,
                y: Number(plain.y) || 0,
                z: Number(plain.z) || 0,
              }
            : null;
      if (!xyz) continue;
      const vec = new cc.Vec3(xyz.x, xyz.y, xyz.z);
      if (attr === "rotation") assignProp(node, "eulerAngles", vec);
      else if (attr === "position") assignProp(node, "position", vec);
      else if (attr === "scale") assignProp(node, "scale", vec);
    } catch (err) {
      console.warn("[cc-runtime] apply node dump failed", attr, err);
    }
  }
}

export function hookCompClipboard(nodeMutators: Record<string, Mutator>) {
  registerHandler(Rpc.copyComponent, (compId: any) => {
    const comp = getMutatorById(String(compId || ""))?.target;
    if (!comp) return null;
    return dumpComponentForClipboard(comp);
  });

  registerHandler(Rpc.pasteComponentValues, (data: any) => {
    const compId = String(data?.id || "");
    const payload = data?.payload as ComponentClipboardPayload;
    const comp = getMutatorById(compId)?.target;
    if (!comp) throw new Error("component not found");
    if (!payload?.cid && !payload?.dump && !(payload as any)?.runtime) {
      throw new Error("empty clipboard");
    }
    const cid = String(payload.cid || payload.dump?.cid || "");
    if (cid && comp.__cid__ && String(comp.__cid__) !== cid) {
      throw new Error(`cid mismatch: clipboard=${cid}, target=${comp.__cid__}`);
    }
    applyDumpToComponent(comp, payload);
    return { ok: true };
  });

  registerHandler(Rpc.pasteComponentAsNew, (data: any) => {
    const nodeId = String(data?.nodeId || "");
    const payload = data?.payload as ComponentClipboardPayload;
    const node = nodeMutators[nodeId]?.target || getMutatorById(nodeId)?.target;
    if (!node || !(node instanceof cc.Node)) throw new Error("node not found");
    if (!payload?.cid && !payload?.dump && !(payload as any)?.runtime) {
      throw new Error("empty clipboard");
    }

    const Cls = resolveComponentClass(payload);
    if (!Cls) {
      throw new Error(
        `cannot resolve component class cid=${payload.cid} type=${payload.dump?.type}`,
      );
    }
    const created = node.addComponent(Cls);
    if (!created) throw new Error("addComponent failed");
    const m = (created[symbolMutate] = new Mutator(created));
    nodeMutators[m.id] = m;
    applyDumpToComponent(created, payload);
    return { ok: true, id: m.id };
  });

  registerHandler(Rpc.copyNode, (nodeId: any) => {
    const node = nodeMutators[String(nodeId || "")]?.target;
    if (!node) return null;
    return dumpNodeForClipboard(node);
  });

  registerHandler(Rpc.pasteNodeValues, (data: any) => {
    const nodeId = String(data?.id || "");
    const payload = data?.payload as NodeClipboardPayload;
    const node = nodeMutators[nodeId]?.target || getMutatorById(nodeId)?.target;
    if (!node || !(node instanceof cc.Node)) throw new Error("node not found");
    if (!payload?.dump && !payload?.runtime) throw new Error("empty clipboard");
    applyNodeDump(node, payload);
    return { ok: true };
  });
}
