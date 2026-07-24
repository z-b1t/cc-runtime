import { cleanFloat } from "../shared/number";
import { VISITOR_KEY } from "../shared/protocol";
import { assetName } from "./assets";
import { getMutator, Mutator, symbolMutate } from "./mutator";

declare const cc: any;

/** Display name for inspector object refs (node / component → node name, asset → file name). */
export function objectRefName(obj: any): string {
  if (!obj) return "";
  try {
    if (typeof cc.Scene === "function" && obj instanceof cc.Scene) {
      return String(obj.name || "Scene");
    }
    if (obj instanceof cc.Node) {
      return String(obj.name || "");
    }
    if (typeof cc.Component === "function" && obj instanceof cc.Component) {
      return String(obj.node?.name || obj.__classname__ || "");
    }
    if (obj.node && obj.node instanceof cc.Node) {
      return String(obj.node.name || obj.__classname__ || "");
    }
    if (typeof cc.Asset === "function" && obj instanceof cc.Asset) {
      return assetName(obj) || "";
    }
    if (typeof cc.SpriteFrame === "function" && obj instanceof cc.SpriteFrame) {
      return assetName(obj) || String(obj.name || "");
    }
  } catch {
    /* ignore */
  }
  if (typeof obj.name === "string" && obj.name) return obj.name;
  if (typeof obj.url === "string" && obj.url) {
    return obj.url.split("/").pop() || obj.url;
  }
  return String(obj.__classname__ || "");
}

/** Wire format for object references in the inspector. */
export function serializeVisitorRef(obj: any): {
  [VISITOR_KEY]: string | undefined;
  name?: string;
} {
  if (!obj) return { [VISITOR_KEY]: undefined };
  const m = getMutator(obj) || (obj[symbolMutate] = new Mutator(obj));
  return { [VISITOR_KEY]: m.id, name: objectRefName(obj) };
}

function isValueType(sample: any): boolean {
  try {
    return !!(cc?.ValueType && sample instanceof cc.ValueType);
  } catch {
    return false;
  }
}

function isCcObject(sample: any): boolean {
  try {
    return !!(window.cc?.Object && sample instanceof window.cc.Object);
  } catch {
    return false;
  }
}

function classNameOf(sample: any): string | undefined {
  return sample?.__classname__ || sample?.constructor?.__classname__;
}

/** Normalize Cocos Enum / BitMask list into {name,value}[]. */
export function normalizeNamedList(list: any): { name: string; value: any }[] {
  if (!list) return [];
  if (Array.isArray(list)) {
    return list
      .map((item) => {
        if (item == null) return null;
        if (typeof item === "object" && "name" in item) {
          return { name: String(item.name), value: item.value };
        }
        return null;
      })
      .filter(Boolean) as { name: string; value: any }[];
  }
  if (typeof list === "object") {
    const out: { name: string; value: any }[] = [];
    for (const k of Object.keys(list)) {
      // Skip reverse numeric keys on Enum objects ("0": "SOLID", ...)
      if (!Number.isNaN(Number(k))) continue;
      const v = list[k];
      if (typeof v === "number" || typeof v === "string") {
        out.push({ name: k, value: v });
      }
    }
    return out;
  }
  return [];
}

/**
 * ValueType / Color must not rely on Object.keys — w/h/_val are often accessors.
 */
export function serializeValue(val: any, typeHint?: string): any {
  if (val == null) return val;
  if (typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map((v) => serializeValue(v));

  const cls = typeHint || classNameOf(val);

  if (cls === "cc.Color" || val._val != null && typeof val.r === "number") {
    const r = Number(val.r);
    const g = Number(val.g);
    const b = Number(val.b);
    const a = Number(val.a);
    const packed =
      typeof val._val === "number"
        ? val._val >>> 0
        : ((a & 0xff) << 24) |
          ((b & 0xff) << 16) |
          ((g & 0xff) << 8) |
          (r & 0xff);
    return {
      _val: packed,
      r: r & 0xff,
      g: g & 0xff,
      b: b & 0xff,
      a: a & 0xff,
    };
  }

  if (cls === "cc.Size") {
    return { w: cleanFloat(Number(val.width)), h: cleanFloat(Number(val.height)) };
  }
  if (cls === "cc.Rect") {
    return {
      x: cleanFloat(Number(val.x)),
      y: cleanFloat(Number(val.y)),
      w: cleanFloat(Number(val.width)),
      h: cleanFloat(Number(val.height)),
    };
  }
  if (cls === "cc.Vec2") {
    return { x: cleanFloat(Number(val.x)), y: cleanFloat(Number(val.y)) };
  }
  if (cls === "cc.Vec3") {
    return {
      x: cleanFloat(Number(val.x)),
      y: cleanFloat(Number(val.y)),
      z: cleanFloat(Number(val.z)),
    };
  }
  if (cls === "cc.Vec4" || cls === "cc.Quat") {
    return {
      x: cleanFloat(Number(val.x)),
      y: cleanFloat(Number(val.y)),
      z: cleanFloat(Number(val.z)),
      w: cleanFloat(Number(val.w)),
    };
  }

  // Generic ValueType / plain: pick known numeric fields first
  const known = ["x", "y", "z", "w", "h", "width", "height", "r", "g", "b", "a"];
  const out: Record<string, number> = {};
  let hit = false;
  for (const k of known) {
    if (typeof val[k] === "number") {
      // Color channels stay raw ints; spatial fields get float cleanup.
      out[k] =
        k === "r" || k === "g" || k === "b" || k === "a"
          ? val[k]
          : cleanFloat(val[k]);
      hit = true;
    }
  }
  if (hit) return out;

  const plain: Record<string, unknown> = {};
  for (const key of Object.keys(val)) {
    const v = val[key];
    if (typeof v === "function" || typeof v === "symbol") continue;
    plain[key] = typeof v === "object" && v !== null ? serializeValue(v) : v;
  }
  return plain;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function eventHandlerClass(): any {
  return cc.Component?.EventHandler || cc.EventHandler || null;
}

function isEventHandlerClass(ctor: any): boolean {
  if (!ctor) return false;
  const EH = eventHandlerClass();
  try {
    if (EH && (ctor === EH || ctor.prototype instanceof EH)) return true;
  } catch {
    /* ignore */
  }
  return classNameOf(ctor.prototype) === "cc.ClickEvent";
}

function isEventHandler(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  try {
    const EH = eventHandlerClass();
    if (EH && obj instanceof EH) return true;
  } catch {
    /* ignore */
  }
  return obj.__classname__ === "cc.ClickEvent";
}

/** Method names on a component instance suitable for EventHandler.handler. */
function listHandlerMethods(comp: any): string[] {
  if (!comp) return [];
  const skip = new Set([
    "constructor",
    "onLoad",
    "onEnable",
    "start",
    "update",
    "lateUpdate",
    "onDisable",
    "onDestroy",
    "onFocusInEditor",
    "onLostFocusInEditor",
    "resetInEditor",
    "onRestore",
    "destroy",
    "schedule",
    "scheduleOnce",
    "unschedule",
    "unscheduleAllCallbacks",
  ]);
  const names: string[] = [];
  let proto = Object.getPrototypeOf(comp);
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (
        typeof (comp as any)[k] === "function" &&
        !k.startsWith("_") &&
        !skip.has(k)
      ) {
        names.push(k);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return Array.from(new Set(names));
}

function serializeEventHandler(eh: any): any {
  const m = getMutator(eh) || (eh[symbolMutate] = new Mutator(eh));
  let component = "";
  try {
    component = String(eh._componentName || eh.component || "");
  } catch {
    component = String(eh.component || "");
  }
  const target = eh.target;
  const comps = target?.components || target?._components || [];
  const componentOptions: string[] = [];
  const handlerOptions: string[] = [];
  for (const c of comps) {
    const name = c?.__classname__;
    if (name) componentOptions.push(String(name));
  }
  const matched = comps.find((c: any) => c?.__classname__ === component);
  if (matched) handlerOptions.push(...listHandlerMethods(matched));
  else if (eh.handler) handlerOptions.push(String(eh.handler));

  return {
    [VISITOR_KEY]: m.id,
    target: serializeVisitorRef(target),
    component,
    handler: String(eh.handler || ""),
    customEventData: String(eh.customEventData ?? ""),
    componentOptions,
    handlerOptions,
  };
}

function resolveEventHandlerItemCtor(a: any, typeField: any): any {
  if (Array.isArray(typeField) && typeField[0]) return typeField[0];
  if (Array.isArray(a.ctor) && a.ctor[0]) return a.ctor[0];
  if (a.ctor) return a.ctor;
  return null;
}

/** Parse Cocos __attrs__ into inspector-friendly attribute list. */
export function parseAttrs(target: any): { attrs: any[] } {
  const attrs: any[] = [];
  const byName: Record<string, any> = {};
  const raw = target?.constructor?.__attrs__;
  for (const key in raw) {
    let val = raw[key];
    const [name, field] = key.split("$_$");
    if (!field) continue;
    let entry = byName[name];
    if (!entry) {
      entry = { name };
      attrs.push(entry);
      byName[name] = entry;
    }
    if (field === "visible" && typeof val === "function") {
      try {
        val = val.call(target);
      } catch {
        continue;
      }
    }
    // Never keep live functions in attr metadata (postMessage cannot clone them).
    if (typeof val === "function") continue;
    entry[field] = val;
  }

  const moved = new Map();
  for (let i = attrs.length - 1; i >= 0; i--) {
    const a = attrs[i];
    // Keep visible:false attrs so editor rules / @visible can re-show after refresh.
    if (moved.has(a)) continue;

    let cur = target[a.name];
    let def = a.default;
    if (typeof def === "function") {
      try {
        def = def.call(target);
      } catch {
        def = undefined;
      }
    }
    const f = a.type;
    const arrVal = Array.isArray(cur)
      ? cur
      : Array.isArray(def)
        ? def
        : null;
    const itemCtor = resolveEventHandlerItemCtor(a, f);
    const isEhArray =
      !!arrVal &&
      (arrVal.some(isEventHandler) ||
        isEventHandlerClass(itemCtor) ||
        (Array.isArray(f) && isEventHandlerClass(f[0])) ||
        ((a.name === "clickEvents" || a.name === "checkEvents") &&
          arrVal.every((x: any) => x == null || isEventHandler(x))));

    if (isEhArray) {
      a.type = "eventHandlerArray";
      a.typeName = "cc.ClickEvent";
      if (!a.displayName || String(a.displayName).startsWith("i18n:")) {
        a.displayName = "Click Events";
      }
      delete a.ctor;
    } else if (f) {
      if (f === "Object") {
        const ctor = a.ctor;
        delete a.ctor;
        const sample = cur || def || ctor?.prototype;
        const sampleCls = classNameOf(sample) || ctor?.prototype?.__classname__;
        if (sampleCls === "cc.Color") {
          a.type = "color";
          a.typeName = "cc.Color";
        } else if (isValueType(sample) || ["cc.Size", "cc.Rect", "cc.Vec2", "cc.Vec3", "cc.Vec4", "cc.Quat"].includes(sampleCls || "")) {
          a.type = "valueMap";
          a.typeName = sampleCls || ctor?.prototype?.__classname__;
        } else if (isCcObject(sample)) {
          a.type = "object";
          a.typeName = sampleCls || ctor?.prototype?.__classname__;
        } else {
          try {
            const { attrs: sub } = parseAttrs(sample);
            if (sub.length > 0) {
              a.type = "sub";
              a.enable = sample?.enable;
              a.subAttrs = sub;
              cur = sub.reduce((o: any, s: any) => {
                o[s.name] = sample?.[s.name];
                return o;
              }, {});
            } else {
              a.type = "object";
              a.typeName = sampleCls;
            }
          } catch {
            a.type = "object";
            a.typeName = sampleCls;
          }
        }
        if (!a.typeName) a.typeName = ctor?.prototype?.__classname__;
      } else if (f === "Enum") {
        a.type = "enum";
        a.enumList = normalizeNamedList(a.enumList || a.enum);
        delete a.enum;
      } else if (f === "BitMask") {
        a.type = "bitMask";
        a.bitmaskList = normalizeNamedList(a.bitmaskList || a.enumList || a.enum);
        // Keep only single-bit flags for multi-select (same as original).
        a.bitmaskList = a.bitmaskList.filter(
          (item: { value: any }) =>
            typeof item.value === "number" && isPowerOfTwo(item.value),
        );
        delete a.enumList;
        delete a.enum;
      } else if (typeof f === "string") a.type = a.typeName = f.toLowerCase();
      else if (f && typeof f === "object") {
        const fname = typeof f.name === "string" ? f.name : "";
        if (fname === "Integer" || fname === "Float")
          a.type = a.typeName = "number";
        else a.type = a.typeName = (fname || "object").toLowerCase();
        if (def === undefined) def = f.default;
      } else {
        a.type = a.typeName = "object";
      }
    } else {
      const sampleVal = cur === undefined ? def : cur;
      a.type = a.typeName = typeof (Array.isArray(sampleVal)
        ? sampleVal[0]
        : sampleVal);
      if (a.type === "object") {
        const sample = cur || def || a.ctor?.prototype;
        const sampleCls = classNameOf(sample);
        if (sampleCls === "cc.Color") {
          a.type = "color";
          a.typeName = "cc.Color";
        } else if (isValueType(sample)) {
          a.type = "valueMap";
          a.typeName = sampleCls;
        } else if (!isCcObject(sample)) {
          try {
            const { attrs: sub } = parseAttrs(sample);
            if (sub.length > 0) {
              a.type = "sub";
              a.enable = sample?.enable;
              a.subAttrs = sub;
              cur = sub.reduce((o: any, s: any) => {
                o[s.name] = sample?.[s.name];
                return o;
              }, {});
            }
          } catch {
            /* keep as object */
          }
        }
      }
    }

    // Late normalize if type already set but lists still raw
    if (a.type === "enum") {
      a.enumList = normalizeNamedList(a.enumList || a.enum);
      delete a.enum;
    }
    if (a.type === "bitMask") {
      a.bitmaskList = normalizeNamedList(
        a.bitmaskList || a.enumList || a.enum,
      ).filter(
        (item) => typeof item.value === "number" && isPowerOfTwo(item.value),
      );
      delete a.enumList;
      delete a.enum;
    }

    const { hasGetter, hasSetter } = a;
    if (hasGetter && !hasSetter) a.readonly = true;
    else if (!hasGetter && hasSetter) a.visible = false;

    // Drop non-serializable leftovers from Cocos __attrs__
    delete a.ctor;
    delete a.hasGetter;
    delete a.hasSetter;
    for (const k of Object.keys(a)) {
      if (typeof a[k] === "function") delete a[k];
    }

    const serialize = (val: any, meta: any): any => {
      if (meta.type === "eventHandlerArray") {
        const list = Array.isArray(val) ? val : [];
        return list.filter(isEventHandler).map(serializeEventHandler);
      }
      if (Array.isArray(val)) {
        return val.map((item) => {
          if (item && typeof item === "object") {
            return serializeVisitorRef(item);
          }
          return item;
        });
      }
      if (val == null) return val;
      switch (meta.type) {
        case "object": {
          return serializeVisitorRef(val);
        }
        case "sub":
          return (meta.subAttrs || []).reduce((o: any, s: any) => {
            o[s.name] = serialize(val[s.name] ?? s.default, s);
            return o;
          }, {});
        case "color":
          return serializeValue(val, "cc.Color");
        case "valueMap":
          return serializeValue(val, meta.typeName);
        default:
          return typeof val === "object" ? serializeValue(val) : val;
      }
    };
    let serialized = serialize(cur === undefined ? def : cur, a);
    if (a.type === "number" && typeof serialized === "number") {
      serialized = cleanFloat(serialized);
    }
    a.default = serialized;

    const { displayOrder } = a;
    if (typeof displayOrder === "number" && displayOrder !== i) {
      attrs.splice(i, 1);
      attrs.splice(displayOrder, 0, a);
      moved.set(a, true);
      i++;
    }
  }

  const scriptAsset = byName.__scriptAsset;
  if (scriptAsset) {
    const idx = attrs.indexOf(scriptAsset);
    if (idx >= 0) attrs.splice(idx, 1);
  }

  applyEditorVisibility(target, attrs);
  return { attrs };
}

/** Creator editor-side visibility (beyond engine @visible). Extensible by classname. */
function applyEditorVisibility(target: any, attrs: any[]) {
  const type = target?.__classname__;
  if (type === "cc.Sprite") applySpriteVisibility(target, attrs);
  if (type === "cc.Button") applyButtonVisibility(target, attrs);
}

/**
 * Mirror editor/inspector/components/sprite.js (Cocos 3.8.8):
 * - hide fill* unless type === FILLED (3)
 * - fillCenter readonly unless fillType === RADIAL (2)
 */
function applySpriteVisibility(target: any, attrs: any[]) {
  const filled = target.type === (cc.Sprite?.Type?.FILLED ?? 3);
  const radial = target.fillType === (cc.Sprite?.FillType?.RADIAL ?? 2);
  for (const a of attrs) {
    if (
      a.name !== "fillType" &&
      a.name !== "fillStart" &&
      a.name !== "fillRange" &&
      a.name !== "fillCenter"
    ) {
      continue;
    }
    a.visible = filled;
    if (a.name === "fillCenter") a.readonly = !radial;
  }
}

/**
 * Mirror editor/inspector/components/button.js (Cocos 3.8):
 * Transition NONE=0 COLOR=1 SPRITE=2 SCALE=3 — show only matching groups.
 */
function applyButtonVisibility(target: any, attrs: any[]) {
  const t = target.transition;
  const color = t === (cc.Button?.Transition?.COLOR ?? 1);
  const sprite = t === (cc.Button?.Transition?.SPRITE ?? 2);
  const scale = t === (cc.Button?.Transition?.SCALE ?? 3);
  for (const a of attrs) {
    switch (a.name) {
      case "normalColor":
      case "pressedColor":
      case "hoverColor":
      case "disabledColor":
        a.visible = color;
        break;
      case "normalSprite":
      case "pressedSprite":
      case "hoverSprite":
      case "disabledSprite":
        a.visible = sprite;
        break;
      case "zoomScale":
      case "duration":
        a.visible = scale;
        break;
      default:
        break;
    }
  }
}

export const specialSerializers: Record<string, (comp: any) => any> = {
  "cc.Label": (n) => {
    const {
      customMaterial,
      color,
      string,
      horizontalAlign,
      verticalAlign,
      actualFontSize,
      fontSize,
      fontFamily,
      lineHeight,
      spacingX,
      overflow,
      enableWrapText,
      font,
      useSystemFont,
      cacheMode,
      isBold,
      isItalic,
      isUnderline,
      underlineHeight,
      enableOutline,
      outlineColor,
      outlineWidth,
      enableShadow,
      shadowColor,
      shadowOffset,
      shadowBlur,
    } = n;
    const ensure = (obj: any) => serializeVisitorRef(obj);
    const Label = cc.LabelComponent || cc.Label;
    const isBMFont = !!(
      font &&
      (cc.BitmapFont
        ? font instanceof cc.BitmapFont
        : classNameOf(font) === "cc.BitmapFont")
    );
    return {
      customMaterial: ensure(customMaterial),
      color: serializeValue(color, "cc.Color"),
      string,
      horizontalAlign,
      horizontalAlignMap: serializeValue(
        Label?.HorizontalAlign || cc.HorizontalTextAlignment,
      ),
      verticalAlign,
      verticalAlignMap: serializeValue(
        Label?.VerticalAlign || cc.VerticalTextAlignment,
      ),
      actualFontSize,
      fontSize,
      fontFamily,
      lineHeight,
      spacingX,
      overflow,
      overflowMap: serializeValue(Label?.Overflow),
      enableWrapText,
      font: ensure(font),
      useSystemFont,
      isBMFont,
      cacheMode,
      cacheModeMap: serializeValue(Label?.CacheMode),
      isBold,
      isItalic,
      isUnderline,
      underlineHeight,
      enableOutline,
      outlineColor: serializeValue(outlineColor, "cc.Color"),
      outlineWidth,
      enableShadow,
      shadowColor: serializeValue(shadowColor, "cc.Color"),
      shadowOffset: serializeValue(shadowOffset, "cc.Vec2"),
      shadowBlur,
    };
  },
  "cc.Widget": (n) => {
    const {
      isAlignTop,
      isAlignVerticalCenter,
      isAlignBottom,
      isAlignLeft,
      isAlignHorizontalCenter,
      isAlignRight,
      isAbsoluteTop,
      isAbsoluteVerticalCenter,
      isAbsoluteBottom,
      isAbsoluteLeft,
      isAbsoluteHorizontalCenter,
      isAbsoluteRight,
      top,
      verticalCenter,
      bottom,
      left,
      horizontalCenter,
      right,
      target,
      alignMode,
      _lockFlags,
    } = n;
    const ensure = (obj: any) => serializeVisitorRef(obj);
    return {
      isAlignTop,
      isAlignVerticalCenter,
      isAlignBottom,
      isAlignLeft,
      isAlignHorizontalCenter,
      isAlignRight,
      isAbsoluteTop,
      isAbsoluteVerticalCenter,
      isAbsoluteBottom,
      isAbsoluteLeft,
      isAbsoluteHorizontalCenter,
      isAbsoluteRight,
      top,
      verticalCenter,
      bottom,
      left,
      horizontalCenter,
      right,
      target: ensure(target),
      alignMode,
      alignModeMap: serializeValue(
        cc.WidgetComponent?.AlignMode || cc.Widget?.AlignMode,
      ),
      _lockFlags: _lockFlags ?? 0,
    };
  },
};

export function serializeComponent(comp: any) {
  if (!comp) return undefined;
  try {
    const type = comp.__classname__;
    const typeId = comp.__cid__;
    const serializer = specialSerializers[type] || parseAttrs;
    const data = serializer.call(null, comp) || {};
    const mutator =
      getMutator(comp) || (comp[symbolMutate] = new Mutator(comp));
    data.id = mutator.id;
    data.type = type;
    data.typeId = typeId;
    data.enabled = comp.enabled;
    return data;
  } catch (err) {
    console.warn(
      "[cc-runtime] serializeComponent failed",
      comp?.__classname__,
      err,
    );
    const mutator = getMutator(comp);
    return {
      id: mutator?.id || comp._id,
      type: comp.__classname__ || "Unknown",
      typeId: comp.__cid__,
      enabled: comp.enabled,
      attrs: [],
    };
  }
}
