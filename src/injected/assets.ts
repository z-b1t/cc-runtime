import { Event, Rpc } from "../shared/protocol";
import { registerHandler, sendEvent } from "./message";
import { Mutator, symbolMutate } from "./mutator";

declare const cc: any;

let assetMap: Record<string, Mutator> = {};

function assetName(asset: any): string {
  let raw: string;
  if (asset.name || asset.url) raw = asset.name || asset.url;
  else if (asset instanceof cc.Material) raw = asset.effectName;
  else if (asset instanceof cc.Texture2D) raw = assetName(asset.image);
  else if (asset instanceof cc.Prefab) raw = asset.data.name;
  else raw = asset._uuid;
  return raw?.split("/").pop() || raw;
}

function wrapAsset(asset: any, key: string) {
  if (!asset?.isValid) return undefined;
  if (!asset[symbolMutate]) {
    asset[symbolMutate] = new Mutator(asset);
    assetMap[key] = asset[symbolMutate];
  }
  return {
    id: asset[symbolMutate].id,
    _id: key,
    type: asset.__classname__,
    typeId: asset.__cid__,
    name: assetName(asset),
  };
}

function snapshotAssets() {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(assetMap)) {
    const m = assetMap[key];
    const target = m?.target;
    out[key] = {
      id: m.id,
      _id: key,
      type: target?.__classname__,
      typeId: target?.__cid__,
      name: target ? assetName(target) : key,
    };
  }
  return out;
}

export function hookAssets() {
  cc.assetManager.assets.forEach(wrapAsset);
  registerHandler(Rpc.assetsGetAll, () => snapshotAssets());

  const add = cc.assetManager.assets.add;
  cc.assetManager.assets.add = function (key: string, asset: any) {
    const ret = add.call(this, key, asset);
    sendEvent(Event.assetsAdd, { key, val: wrapAsset(asset, key) });
    return ret;
  };

  const remove = cc.assetManager.assets.remove;
  cc.assetManager.assets.remove = function (key: string) {
    const ret = remove.call(this, key);
    const m = assetMap[key];
    delete assetMap[key];
    sendEvent(Event.assetsRemove, { key, id: m?.id });
    m?.destroy();
    return ret;
  };

  const clear = cc.assetManager.assets.clear;
  cc.assetManager.assets.clear = function () {
    const ret = clear.call(this);
    for (const k in assetMap) assetMap[k].destroy();
    assetMap = {};
    sendEvent(Event.assetsClear, {});
    return ret;
  };

  const destroy = cc.assetManager.assets.destroy;
  cc.assetManager.assets.destroy = function () {
    const ret = destroy.call(this);
    assetMap = {};
    sendEvent(Event.assetsClear, {});
    return ret;
  };
}
