import { debounce, throttle } from "lodash";
import { cleanFloat } from "../shared/number";
import { Event, Rpc } from "../shared/protocol";
import { serializeComponent } from "./attrs";
import { registerHandler, sendEvent } from "./message";
import { Mutator, symbolMutate } from "./mutator";

declare const cc: any;

const nodeMutators: Record<string, Mutator> = {};

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
    const desc = Object.getOwnPropertyDescriptor(node, "_active");
    Object.defineProperty(node, "_active", {
      configurable: desc.configurable,
      enumerable: desc.enumerable,
      get: () => ("value" in desc ? desc.value : desc.get?.call(node)),
      set: (v) => {
        if ("value" in desc) {
          if (v !== desc.value) {
            desc.value = v;
            syncNodeProp(m.id, "active", v);
          }
        } else if (!(desc.get && v === desc.get.call(node))) {
          desc.set?.call(node, v);
          syncNodeProp(m.id, "active", v);
        }
      },
    });
    node.on(cc.Node.EventType.CHILD_ADDED, pushScene);
    node.on(cc.Node.EventType.CHILD_REMOVED, pushScene);
    node.on(cc.Node.EventType.SIBLING_ORDER_CHANGED, pushScene);
    node.once(cc.Node.EventType.NODE_DESTROYED, () => {
      Object.defineProperty(node, "_active", desc);
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
    active: node.active,
    parentId,
    children: (node.children || []).map((c: any) => walkNode(c, m.id)),
    components: node.components?.map((c: any) => wrapComp(c, m.id)) || [],
  };
}

let stopInspect: (() => void) | null = null;
let stopDetails: (() => void) | null = null;

export function hookScene() {
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

  registerHandler(Rpc.startInspectNode, () =>
    new Promise((resolve) => {
      stopInspect?.();
      stopInspect = null;
      const scene = cc.director.getScene();
      if (!scene) {
        resolve(null);
        return;
      }
      const select = throttle(async (uuid: string) => {
        await sendEvent(Event.selectNode, uuid);
      }, 100);
      const onEnter = debounce((ev: any) => {
        ev.propagationImmediateStopped = true;
        const t = ev.target;
        if (t instanceof cc.Node) select(t.uuid);
      }, 300);
      const onUp = async (ev: any) => {
        ev.propagationImmediateStopped = true;
        const t = ev.target;
        if (t instanceof cc.Node) {
          console.log(t);
          await select(t.uuid);
          resolve(t.uuid);
        } else resolve(null);
        stopInspect?.();
        stopInspect = null;
      };
      const block = (ev: any) => {
        ev.propagationImmediateStopped = true;
      };
      scene.on(cc.Node.EventType.MOUSE_ENTER, onEnter, null, true);
      scene.on(cc.Node.EventType.MOUSE_UP, onUp, null, true);
      scene.on("click", block, null, true);
      scene.on(cc.Node.EventType.MOUSE_DOWN, block, null, true);
      scene.on(cc.Node.EventType.TOUCH_START, block, null, true);
      scene.on(cc.Node.EventType.TOUCH_END, block, null, true);
      stopInspect = () => {
        if (!scene.isValid) return;
        scene.off(cc.Node.EventType.MOUSE_ENTER, onEnter, null, true);
        scene.off(cc.Node.EventType.MOUSE_UP, onUp, null, true);
        scene.off("click", block, null, true);
        scene.off(cc.Node.EventType.MOUSE_DOWN, block, null, true);
        scene.off(cc.Node.EventType.TOUCH_START, block, null, true);
        scene.off(cc.Node.EventType.TOUCH_END, block, null, true);
      };
    }),
  );

  registerHandler(Rpc.stopInspectNode, () => {
    stopInspect?.();
    stopInspect = null;
  });

  registerHandler(Rpc.getNodeDetails, (id: any) => {
    const target = nodeMutators[id]?.target;
    if (!target) return null;

    const vec3 = (v: any) =>
      v && typeof v === "object"
        ? {
            x: cleanFloat(Number(v.x)),
            y: cleanFloat(Number(v.y)),
            z: cleanFloat(Number(v.z)),
          }
        : { x: 0, y: 0, z: 0 };

    // Scene extends Node in Cocos 3 — handle scene globals first.
    if (typeof cc.Scene === "function" && target instanceof cc.Scene) {
      return {
        id,
        name: target.name,
        active: target.active,
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
        active: !!target.active,
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
      stopDetails = () => {
        if (!target.isValid) return;
        target.off(cc.Node.EventType.TRANSFORM_CHANGED, onTransform);
        target.off(cc.Node.EventType.LAYER_CHANGED, onLayer);
        target.off(cc.Node.EventType.SIZE_CHANGED, onSize);
        target.off(cc.Node.EventType.ANCHOR_CHANGED, onAnchor);
      };
      return details;
    }
    return null;
  });
}
