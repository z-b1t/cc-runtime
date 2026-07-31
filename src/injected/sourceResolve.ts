import type { SourceLocation } from "../shared/protocol";
import { Rpc } from "../shared/protocol";
import { registerHandler } from "./message";
import { getMutatorById } from "./mutator";

declare const cc: any;

const INSPECT_KEY = "__ccRuntimeInspect";

function stashInspect(data: {
  fn?: (...args: any[]) => any;
  className?: string;
  handler?: string;
}) {
  try {
    (window as any)[INSPECT_KEY] = data;
  } catch {
    /* ignore */
  }
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-fA-F-]{8,}$/.test(s) && s.replace(/-/g, "").length >= 16;
}

/** Expand compressed Cocos uuid (22-char) when possible via engine helpers. */
function normalizeUuid(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;
  try {
    const decode = cc?.assetManager?.utils?.decodeUuid;
    if (typeof decode === "function" && !s.includes("-") && s.length <= 22) {
      const out = decode(s);
      if (typeof out === "string" && out) return out;
    }
  } catch {
    /* ignore */
  }
  return s;
}

function urlFromAsset(asset: any): string | null {
  if (!asset) return null;
  const u =
    asset.nativeUrl ||
    asset.url ||
    asset._nativeUrl ||
    (typeof asset._native === "string" ? asset._native : null);
  return typeof u === "string" && u ? u : null;
}

function urlFromUuid(uuid: string): string | null {
  const id = normalizeUuid(uuid);
  if (!id) return null;
  const am = cc?.assetManager;
  if (!am) return null;

  try {
    const asset =
      am.assets?.get?.(id) ||
      (typeof am.getAssetByUuid === "function"
        ? am.getAssetByUuid(id)
        : null);
    const fromAsset = urlFromAsset(asset);
    if (fromAsset) return fromAsset;
  } catch {
    /* ignore */
  }

  try {
    const getUrl = am.utils?.getUrlWithUuid;
    if (typeof getUrl === "function") {
      const u = getUrl(id);
      if (typeof u === "string" && u && !u.startsWith("db://")) return u;
    }
  } catch {
    /* ignore */
  }

  return null;
}

function readScriptUuidFromCtor(ctor: any): string | null {
  if (!ctor) return null;

  for (const key of ["_$uuid", "__uuid__", "uuid", "_uuid"]) {
    const v = ctor[key];
    if (typeof v === "string" && isUuidLike(v)) return v;
  }

  try {
    const getAttrs =
      cc?.Class?.Attr?.getClassAttrs || cc?.js?.getClassAttrs;
    if (typeof getAttrs === "function") {
      const attrs = getAttrs(ctor);
      if (attrs && typeof attrs === "object") {
        for (const key of Object.keys(attrs)) {
          if (!key.includes("scriptAsset") && !key.includes("ScriptAsset")) {
            continue;
          }
          const raw = attrs[key];
          if (typeof raw === "string" && isUuidLike(raw)) return raw;
          if (raw && typeof raw === "object") {
            const u = raw._uuid || raw.uuid;
            if (typeof u === "string" && isUuidLike(u)) return u;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  const cid = ctor.__cid__ || ctor.prototype?.__cid__;
  if (typeof cid === "string" && cid && !cid.startsWith("cc.")) {
    if (isUuidLike(cid) || (!cid.includes(".") && cid.length >= 16)) {
      return cid;
    }
  }

  return null;
}

function findLoadedScriptUrl(hints: string[]): string | null {
  const cleaned = hints.map((h) => String(h || "").trim()).filter(Boolean);
  if (!cleaned.length) return null;

  const candidates: string[] = [];
  try {
    const scripts = document.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src;
      if (src) candidates.push(src);
    }
  } catch {
    /* ignore */
  }
  try {
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    for (const e of entries) {
      if (e.name && /\.(m?js|ts)(\?|$)/i.test(e.name)) candidates.push(e.name);
    }
  } catch {
    /* ignore */
  }

  for (const hint of cleaned) {
    const lower = hint.toLowerCase();
    for (const url of candidates) {
      const u = url.toLowerCase();
      if (
        u.includes(`/${lower}.js`) ||
        u.includes(`/${lower}.ts`) ||
        u.includes(`/${lower}.mjs`) ||
        u.includes(lower)
      ) {
        return url;
      }
    }
  }
  return null;
}

function resolveComponentScriptUrl(comp: any): string | null {
  if (!comp) return null;
  const ctor = comp.constructor;
  const className = String(comp.__classname__ || ctor?.__classname__ || "");

  const sa = (comp as any).__scriptAsset ?? ctor?.__scriptAsset;
  if (typeof sa === "string" && isUuidLike(sa)) {
    const u = urlFromUuid(sa);
    if (u) return u;
  }
  if (sa && typeof sa === "object") {
    const fromSa = urlFromAsset(sa);
    if (fromSa) return fromSa;
    const u = sa._uuid || sa.uuid;
    if (typeof u === "string") {
      const resolved = urlFromUuid(u);
      if (resolved) return resolved;
    }
  }

  const uuid = readScriptUuidFromCtor(ctor);
  if (uuid) {
    const u = urlFromUuid(uuid);
    if (u) return u;
    const byUuid = findLoadedScriptUrl([normalizeUuid(uuid), uuid]);
    if (byUuid) return byUuid;
  }

  if (className && !className.startsWith("cc.")) {
    const short = className.includes(".")
      ? className.slice(className.lastIndexOf(".") + 1)
      : className;
    const byName = findLoadedScriptUrl([className, short]);
    if (byName) return byName;
  }

  return null;
}

function findComponentOnNode(node: any, componentName: string): any | null {
  if (!node || !componentName) return null;
  const list =
    (typeof node.getComponents === "function" &&
      node.getComponents(cc.Component)) ||
    node._components ||
    node.components ||
    [];
  for (const c of list) {
    if (!c) continue;
    if (String(c.__classname__ || "") === componentName) return c;
    if (c.constructor?.name === componentName) return c;
  }
  try {
    if (typeof node.getComponent === "function") {
      const c = node.getComponent(componentName);
      if (c) return c;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveNodeFromVisitor(visitorId: string): any | null {
  const target = getMutatorById(String(visitorId || ""))?.target;
  if (!target) return null;
  if (target instanceof cc.Node) return target;
  if (
    typeof cc.Component === "function" &&
    target instanceof cc.Component &&
    target.node
  ) {
    return target.node;
  }
  if (target.node && target.node instanceof cc.Node) return target.node;
  return null;
}

function getHandlerFn(comp: any, handler: string): ((...a: any[]) => any) | null {
  if (!comp || !handler) return null;
  const own = comp[handler];
  if (typeof own === "function") return own;
  const proto = comp.constructor?.prototype?.[handler];
  if (typeof proto === "function") return proto;
  return null;
}

export function resolveComponentSource(compId: unknown): SourceLocation | null {
  const comp = getMutatorById(String(compId || ""))?.target;
  if (!comp) return null;
  const className = String(comp.__classname__ || "");
  // Built-in engine components have no project script to open.
  if (!className || className.startsWith("cc.")) return null;

  const url = resolveComponentScriptUrl(comp) || undefined;
  const short = className.includes(".")
    ? className.slice(className.lastIndexOf(".") + 1)
    : className;
  stashInspect({ className, fn: comp.constructor });
  return {
    url,
    className,
    searchText: short,
    hasFn: typeof comp.constructor === "function",
  };
}

export function resolveHandlerSource(data: {
  targetVisitorId?: string;
  component?: string;
  handler?: string;
}): SourceLocation | null {
  const handler = String(data?.handler || "").trim();
  const component = String(data?.component || "").trim();
  const targetVisitorId = String(data?.targetVisitorId || "").trim();
  if (!handler || !component || !targetVisitorId) return null;

  const node = resolveNodeFromVisitor(targetVisitorId);
  if (!node) return null;
  const comp = findComponentOnNode(node, component);
  if (!comp) return null;

  const fn = getHandlerFn(comp, handler);
  if (!fn) return null;

  const className = String(comp.__classname__ || component);
  const url = resolveComponentScriptUrl(comp) || undefined;
  stashInspect({ fn, className, handler });
  return {
    url,
    className,
    searchText: handler,
    hasFn: true,
  };
}

export function hookSourceResolve() {
  registerHandler(Rpc.resolveComponentSource, (compId: any) =>
    resolveComponentSource(compId),
  );
  registerHandler(Rpc.resolveHandlerSource, (data: any) =>
    resolveHandlerSource(data || {}),
  );
}
