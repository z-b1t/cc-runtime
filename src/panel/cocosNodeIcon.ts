import type { SceneNodeData } from "@shared/protocol";

import componentIconMap from "../assets/cocos-icons/component-icon-map.json";
import uiIconColors from "../assets/cocos-icons/ui-icon-colors.json";
import ccComponentsOrder from "../assets/cocos-icons/cc-components-order.json";

const svgRaw = import.meta.glob("../assets/cocos-icons/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const rawByName = new Map<string, string>();
for (const [path, raw] of Object.entries(svgRaw)) {
  const name = path.replace(/^.*\//, "").replace(/\.svg$/i, "");
  rawByName.set(name, raw);
}

const FALLBACK_COMPONENT = "component";
const FALLBACK_NODE = "node";

/** Creator hierarchy: lower index = higher priority for node icon. */
const ORDER = ccComponentsOrder as string[];
const orderIndex = new Map(ORDER.map((t, i) => [t, i]));

export type CocosIconInfo = {
  /** SVG icon basename (e.g. `sprite`, `button-block`). */
  name: string;
  /** Inline SVG markup. */
  svg: string;
  /** Creator UiIcon `[color]` palette hex, if any. */
  color?: string;
};

function iconInfo(name: string): CocosIconInfo {
  const svg =
    rawByName.get(name) ||
    rawByName.get(FALLBACK_COMPONENT) ||
    "";
  const resolvedName = rawByName.has(name) ? name : FALLBACK_COMPONENT;
  const colors = uiIconColors as Record<string, string>;
  const color = colors[resolvedName];
  return color ? { name: resolvedName, svg, color } : { name: resolvedName, svg };
}

function resolveIconName(type: string): string {
  const map = componentIconMap as Record<string, string>;
  if (map[type]) return map[type];

  const bare = type.replace(/^cc\./i, "");
  const bareKey = bare.toLowerCase();
  if (map[bare]) return map[bare];
  if (map[bareKey]) return map[bareKey];

  const ccKey = `cc.${bare}`;
  if (map[ccKey]) return map[ccKey];

  return FALLBACK_COMPONENT;
}

/** Resolve icon for a Cocos component classname (e.g. `cc.Sprite`). */
export function resolveCompIcon(type: unknown): CocosIconInfo {
  if (typeof type !== "string" || !type) return iconInfo(FALLBACK_COMPONENT);
  if (type === "node") return iconInfo(FALLBACK_NODE);
  return iconInfo(resolveIconName(type));
}

/**
 * Creator hierarchy `showCustomComponent`:
 * component type is custom and absent from UiIcon.Map.component.
 * Runtime approx: classname not listed in component-icon-map.
 */
export function hasCustomScript(node: SceneNodeData): boolean {
  const map = componentIconMap as Record<string, string>;
  return (node.components || []).some((c) => {
    const t = c?.type;
    if (typeof t !== "string" || !t) return false;
    return map[t] === undefined;
  });
}

/** Blue TS badge icon (Creator `ui-icon value="typescript" color`). */
export function typescriptBadgeIcon(): CocosIconInfo {
  return iconInfo("typescript");
}

function componentPriority(type: string): number {
  const idx = orderIndex.get(type);
  if (idx !== undefined) return idx;
  // Unknown / custom scripts: after listed components, before implicit node.
  return ORDER.length;
}

/**
 * Node tree icon — Creator hierarchy `sortComponents` + first winner.
 * UITransform is last in the order list; bare node (no comps) uses `node`.
 */
export function resolveNodeIcon(node: SceneNodeData): CocosIconInfo {
  const comps = node.components || [];
  if (!comps.length) return iconInfo(FALLBACK_NODE);

  let bestType: string | null = null;
  let bestPri = Infinity;
  for (const c of comps) {
    if (typeof c?.type !== "string" || !c.type) continue;
    const pri = componentPriority(c.type);
    if (pri < bestPri) {
      bestPri = pri;
      bestType = c.type;
    }
  }
  if (!bestType) return iconInfo(FALLBACK_NODE);
  return resolveCompIcon(bestType);
}
