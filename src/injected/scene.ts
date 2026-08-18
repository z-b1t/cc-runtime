import { throttle } from "lodash";
import { cleanFloat } from "../shared/number";
import { Event, Rpc } from "../shared/protocol";
import { serializeComponent } from "./attrs";
import { hookCompClipboard } from "./compClipboard";
import { registerHandler, sendEvent } from "./message";
import { getMutatorById, Mutator, symbolMutate } from "./mutator";

declare const cc: any;

const nodeMutators: Record<string, Mutator> = {};

/**
 * Panel id for a node the scene walk has not reached yet (freshly created, or
 * picked before the throttled scene push caught up).
 */
export function ensureNodeMutator(node: any): Mutator | null {
  if (!node || node.isValid === false) return null;
  let m = node[symbolMutate] as Mutator | undefined;
  if (!m) {
    m = new Mutator(node);
    node[symbolMutate] = m;
  }
  if (!nodeMutators[m.id]) nodeMutators[m.id] = m;
  return m;
}

const pushScene = throttle(() => {
  const scene = cc.director.getScene();
  if (!scene) return;
  const root = walkNode(scene);
  if (root) {
    root.components =
      Object.values(scene.globals || {}).map((g: any) =>
        wrapComp(g, root.id),
      ) || [];
    sendEvent(Event.sceneData, root);
  }
}, 100);

const syncNodeProp = throttle((id: string, key: string, value: unknown) => {
  sendEvent(Event.syncNodeProp, { id, key, value });
}, 100);

const syncCompProp = throttle((id: string, key: string, value: unknown) => {
  sendEvent(Event.syncCompProp, { id, key, value });
}, 100);

function isScene(node: any): boolean {
  return typeof cc.Scene === "function" && node instanceof cc.Scene;
}

/** Scene has no `active`; reading it warns in Cocos 3.x. */
function readActive(node: any): boolean {
  if (isScene(node)) return true;
  return !!node.active;
}

function wrapComp(comp: any, nodeId: string) {
  if (!comp) return undefined;
  if (!comp[symbolMutate]) {
    const m = (comp[symbolMutate] = new Mutator(comp));
    nodeMutators[m.id] = m;
    const desc = Object.getOwnPropertyDescriptor(comp, "_enabled");
    if (desc) {
      Object.defineProperty(comp, "_enabled", {
        configurable: desc.configurable,
        enumerable: desc.enumerable,
        get: () => desc.value,
        set: (v) => {
          if (v !== desc.value) {
            desc.value = v;
            syncCompProp(m.id, "enabled", v);
          }
        },
      });
    }
  }
  return {
    id: comp[symbolMutate].id,
    _id: comp._id,
    type: comp.__classname__,
    typeId: comp.__cid__,
    enabled: comp.enabled,
    nodeId,
  };
}

function walkNode(node: any, parentId: string | null = null): any {
  if (!node) return undefined;
  if (!node[symbolMutate]) {
    const m = (node[symbolMutate] = new Mutator(node));
    nodeMutators[m.id] = m;
    // Scene has no `_active` / `active` — hooking or reading warns in Cocos 3.x.
    const activeDesc = isScene(node)
      ? null
      : Object.getOwnPropertyDescriptor(node, "_active");
    if (activeDesc) {
      Object.defineProperty(node, "_active", {
        configurable: activeDesc.configurable,
        enumerable: activeDesc.enumerable,
        get: () =>
          "value" in activeDesc
            ? activeDesc.value
            : activeDesc.get?.call(node),
        set: (v) => {
          if ("value" in activeDesc) {
            if (v !== activeDesc.value) {
              activeDesc.value = v;
              syncNodeProp(m.id, "active", v);
            }
          } else if (!(activeDesc.get && v === activeDesc.get.call(node))) {
            activeDesc.set?.call(node, v);
            syncNodeProp(m.id, "active", v);
          }
        },
      });
    }
    node.on(cc.Node.EventType.CHILD_ADDED, pushScene);
    node.on(cc.Node.EventType.CHILD_REMOVED, pushScene);
    node.on(cc.Node.EventType.SIBLING_ORDER_CHANGED, pushScene);
    node.once(cc.Node.EventType.NODE_DESTROYED, () => {
      if (activeDesc) Object.defineProperty(node, "_active", activeDesc);
      delete node[symbolMutate];
      delete nodeMutators[m.id];
      m.destroy();
    });
  }
  const m = node[symbolMutate];
  return {
    id: m.id,
    _id: node._id,
    name: node.name,
    active: readActive(node),
    parentId,
    children: (node.children || []).map((c: any) => walkNode(c, m.id)),
    components: node.components?.map((c: any) => wrapComp(c, m.id)) || [],
  };
}

let stopDetails: (() => void) | null = null;
let detailsWatchId: string | null = null;

function clearDetailsWatch() {
  stopDetails?.();
  stopDetails = null;
  detailsWatchId = null;
}

export function hookScene() {
  hookCompClipboard(nodeMutators);

  cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, pushScene);
  registerHandler(Rpc.refreshSceneData, () => {
    pushScene();
  });
  pushScene();

  registerHandler(Rpc.log, ({ datas, level = "log" }: any) => {
    (console as any)[level].apply(console, datas);
  });

  registerHandler(Rpc.logNode, (id: any) => {
    const m = nodeMutators[id];
    if (m) console.log(m.target);
    else console.warn("Can't find active Node which id is " + id);
  });

  registerHandler(Rpc.dragDrop, ({ dragId, containerId, index }: any) => {
    const drag = nodeMutators[dragId]?.target;
    const dropTarget = nodeMutators[containerId]?.target;
    if (!drag || !dropTarget) return;

    // index < 0: drop onto node content.
    // rc-tree remaps "gap above first child of an expanded parent" to this case,
    // so insert at 0 (antd demo uses unshift). Append via gap below the last sibling.
    if (!(index >= 0)) {
      dropTarget.insertChild(drag, 0);
      return;
    }

    // Gap drop: insert among dropTarget's siblings.
    const parent = dropTarget.parent;
    if (!parent) return;

    let insertAt = Number(index);
    if (!Number.isFinite(insertAt) || insertAt < 0) insertAt = 0;
    // After removal, later indices shift left when reordering within same parent.
    if (drag.parent === parent) {
      const oldIndex =
        typeof drag.getSiblingIndex === "function"
          ? drag.getSiblingIndex()
          : parent.children.indexOf(drag);
      if (oldIndex >= 0 && oldIndex < insertAt) insertAt -= 1;
    }
    parent.insertChild(drag, insertAt);
  });

  registerHandler(Rpc.resolveVisitor, (visitorId: any) => {
    const id = String(visitorId || "");
    if (!id) return null;
    const target = getMutatorById(id)?.target;
    if (!target) return null;

    let node: any = null;
    if (isScene(target)) {
      node = target;
    } else if (target instanceof cc.Node) {
      node = target;
    } else if (
      typeof cc.Component === "function" &&
      target instanceof cc.Component &&
      target.node
    ) {
      node = target.node;
    } else if (target.node && target.node instanceof cc.Node) {
      // Fallback for Component-like objects without instanceof match.
      node = target.node;
    }
    const m = ensureNodeMutator(node);
    return m ? { nodeId: m.id } : null;
  });

  registerHandler(Rpc.flashNode, async (nodeId: any) => {
    const node = nodeMutators[String(nodeId || "")]?.target;
    if (!node || !(node instanceof cc.Node) || node.isValid === false) return;

    let uiOp = cc.UIOpacity ? node.getComponent(cc.UIOpacity) : null;
    let added = false;
    if (!uiOp && cc.UIOpacity) {
      uiOp = node.addComponent(cc.UIOpacity);
      added = true;
    }
    // Legacy / non-UI fallback.
    const useNodeOpacity = !uiOp && typeof node.opacity === "number";
    if (!uiOp && !useNodeOpacity) return;

    const getOp = () => (uiOp ? uiOp.opacity : node.opacity);
    const setOp = (v: number) => {
      if (uiOp) uiOp.opacity = v;
      else node.opacity = v;
    };
    const original = getOp();
    const pulses = [80, original, 80, original, 80, original];
    for (const next of pulses) {
      if (!node.isValid) return;
      setOp(next);
      await new Promise((r) => setTimeout(r, 80));
    }
    if (!node.isValid) return;
    setOp(original);
    if (added && uiOp) {
      try {
        node.removeComponent(uiOp);
      } catch {
        /* ignore */
      }
    }
  });

  registerHandler(Rpc.getNodeDetails, (id: any) => {
    const target = nodeMutators[id]?.target;
    if (!target) {
      clearDetailsWatch();
      return null;
    }

    const vec3 = (v: any) =>
      v && typeof v === "object"
        ? {
            x: cleanFloat(Number(v.x)),
            y: cleanFloat(Number(v.y)),
            z: cleanFloat(Number(v.z)),
          }
        : { x: 0, y: 0, z: 0 };

    // Scene extends Node in Cocos 3 — handle scene globals first.
    if (isScene(target)) {
      clearDetailsWatch();
      return {
        id,
        name: target.name,
        active: true,
        components:
          Object.values(target.globals || {})
            .map((g: any) => {
              const ref = wrapComp(g, id);
              const data = serializeComponent(g);
              if (!data) return undefined;
              data.id = ref?.id || id;
              delete data.enabled;
              return data;
            })
            .filter(Boolean) || [],
        rootAttrs: [
          {
            name: "autoReleaseAssets",
            type: "boolean",
            typeName: "boolean",
            default: !!target.autoReleaseAssets,
          },
        ],
      };
    }

    if (target instanceof cc.Node) {
      const details = {
        id,
        name: target.name,
        active: readActive(target),
        nodeAttrs: {
          position: vec3(target.position),
          eulerAngles: vec3(target.eulerAngles),
          scale: vec3(target.scale),
          layer: target.layer,
          layerNameMap: { ...(cc.Layers?.Enum || {}) },
        },
        components: (target.components || [])
          .map((c: any) => {
            wrapComp(c, id);
            return serializeComponent(c);
          })
          .filter(Boolean),
      };
      if (detailsWatchId !== id) {
        stopDetails?.();
        const onTransform = throttle(() => {
          sendEvent(Event.updateTransform, {
            id,
            position: vec3(target.position),
            eulerAngles: vec3(target.eulerAngles),
            scale: vec3(target.scale),
          });
        }, 1000);
        const onLayer = throttle(() => {
          sendEvent(Event.updateLayer, { id, layer: target.layer });
        }, 1000);
        const onSize = throttle(() => {
          const ui = target._uiProps?.uiTransformComp;
          if (ui) {
            const cs = ui.contentSize;
            sendEvent(Event.updateContentSize, {
              id,
              contentSize: cs
                ? { width: cs.width, height: cs.height }
                : undefined,
            });
          }
        }, 1000);
        const onAnchor = throttle(() => {
          const ui = target._uiProps?.uiTransformComp;
          if (ui) {
            const ap = ui.anchorPoint;
            sendEvent(Event.updateAnchorPoint, {
              id,
              anchorPoint: ap ? { x: ap.x, y: ap.y } : undefined,
            });
          }
        }, 1000);
        target.on(cc.Node.EventType.TRANSFORM_CHANGED, onTransform);
        target.on(cc.Node.EventType.LAYER_CHANGED, onLayer);
        target.on(cc.Node.EventType.SIZE_CHANGED, onSize);
        target.on(cc.Node.EventType.ANCHOR_CHANGED, onAnchor);
        detailsWatchId = id;
        stopDetails = () => {
          if (!target.isValid) return;
          target.off(cc.Node.EventType.TRANSFORM_CHANGED, onTransform);
          target.off(cc.Node.EventType.LAYER_CHANGED, onLayer);
          target.off(cc.Node.EventType.SIZE_CHANGED, onSize);
          target.off(cc.Node.EventType.ANCHOR_CHANGED, onAnchor);
        };
      }
      return details;
    }
    clearDetailsWatch();
    return null;
  });
}
