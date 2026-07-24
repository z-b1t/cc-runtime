/** Shared cc-runtime message protocol */

export const Msg = {
  page2content_request: "cc-runtime::page2content_request",
  page2content_response: "cc-runtime::page2content_response",
  content2page_request: "cc-runtime::content2page_request",
  content2page_response: "cc-runtime::content2page_response",
  content2devtool_request: "cc-runtime::content2devtool_request",
  content2devtool_response: "cc-runtime::content2devtool_response",
  devtool2content_request: "cc-runtime::devtool2content_request",
  devtool2content_response: "cc-runtime::devtool2content_response",
  background2devtool_tabReloaded: "cc-runtime::background2devtool_request|tabReloaded",
  devtool2background_response: "cc-runtime::devtool2background_response",
} as const;

export const Rpc = {
  refreshSceneData: "refreshSceneData",
  getNodeDetails: "getNodeDetails",
  startInspectNode: "startInspectNode",
  stopInspectNode: "stopInspectNode",
  dragDrop: "dragDrop",
  logNode: "logNode",
  log: "log",
  assetsGetAll: "assets::getAll",
  resolveVisitor: "resolveVisitor",
  flashNode: "flashNode",
  /** Dump component into Creator-compatible `_dump_component_` payload. */
  copyComponent: "copyComponent",
  /** Apply clipboard dump values onto an existing component (same cid). */
  pasteComponentValues: "pasteComponentValues",
  /** addComponent(cid) then apply dump on the current node. */
  pasteComponentAsNew: "pasteComponentAsNew",
  /** Dump node transform/layer into Creator-compatible `_dump_node_` payload. */
  copyNode: "copyNode",
  /** Apply clipboard node values onto the selected node. */
  pasteNodeValues: "pasteNodeValues",
} as const;

/** Cocos Creator Editor.Clipboard custom type for component copy/paste. */
export const CLIPBOARD_COMPONENT_TYPE = "_dump_component_";
/** Cocos Creator Editor.Clipboard custom type for node value copy/paste. */
export const CLIPBOARD_NODE_TYPE = "_dump_node_";

export interface ComponentClipboardPayload {
  cid: string;
  dump: any;
  /** Flat runtime prop snapshot for reliable in-game paste (panel use). */
  runtime?: Record<string, any>;
}

export interface NodeClipboardPayload {
  type: string;
  attrs: string[];
  dump: Record<string, any>;
  /** Runtime snapshot: position / eulerAngles / scale / layer. */
  runtime?: {
    position: { x: number; y: number; z: number };
    eulerAngles: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    layer: number;
  };
}

export const Event = {
  loadingComplete: "loadingComplete",
  sceneData: "sceneData",
  selectNode: "selectNode",
  syncNodeProp: "syncNodeProp",
  syncCompProp: "syncCompProp",
  updateTransform: "updateTransform",
  updateLayer: "updateLayer",
  updateContentSize: "updateContentSize",
  updateAnchorPoint: "updateAnchorPoint",
  assetsAdd: "assets::add",
  assetsRemove: "assets::remove",
  assetsClear: "assets::clear",
} as const;

/** Shared visitor / construct keys (both panel & page use the same build-time constants). */
export const VISITOR_KEY = "[CC-RUNTIME::VISITOR_KEY]";
export const NEW_KEY = "[CC-RUNTIME::NEW_KEY]";

export const LAYOUT_STORAGE_KEY = "cc-runtime::layoutConfig";

export type BatchItem = { id: string; type: string; data?: unknown };
export type Envelope = { type: string; id?: string; data?: unknown };

export interface SceneNodeData {
  id: string;
  _id?: string;
  name: string;
  active: boolean;
  parentId?: string | null;
  children?: SceneNodeData[];
  components?: any[];
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface NodeDetails {
  id: string;
  name: string;
  active: boolean;
  nodeAttrs?: {
    position: Vec3Like;
    eulerAngles: Vec3Like;
    scale: Vec3Like;
    layer: number;
    layerNameMap?: Record<string, number>;
  };
  components?: any[];
  rootAttrs?: any[];
}
