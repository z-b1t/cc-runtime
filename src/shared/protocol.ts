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
  /** Content / action → background: open the side panel for this tab. */
  openSidePanel: "cc-runtime::openSidePanel",
  /** Content → background: is window.cc present in the sender tab? */
  probeCc: "cc-runtime::probeCc",
  /** Side panel page → background: this tab's panel became visible. */
  sidePanelOpened: "cc-runtime::sidePanelOpened",
  /** Side panel page → background: this tab's panel is closing. */
  sidePanelClosed: "cc-runtime::sidePanelClosed",
  /** Background → content: re-apply launcher edge position after panel close. */
  launcherRelayout: "cc-runtime::launcherRelayout",
  /** Background → content: hide page launcher while side panel is open. */
  launcherHide: "cc-runtime::launcherHide",
  /** Background → content: show page launcher again after side panel closes. */
  launcherShow: "cc-runtime::launcherShow",
  /** Side panel → background → DevTools page: open a URL in Sources. */
  openInSources: "cc-runtime::openInSources",
  /** Side panel → background: check GitHub Releases. Payload: { force?: boolean }. */
  checkUpdate: "cc-runtime::checkUpdate",
  /** Side panel → background: hide this version until a newer tag appears. */
  ignoreUpdate: "cc-runtime::ignoreUpdate",
  /** Side panel → background: refresh the game tab, then reload the extension. */
  reloadExtension: "cc-runtime::reloadExtension",
} as const;

export const Rpc = {
  refreshSceneData: "refreshSceneData",
  getNodeDetails: "getNodeDetails",
  /** Enter pick mode in the page. Answers with InspectStartResult. */
  inspectStart: "inspect::start",
  inspectStop: "inspect::stop",
  /** Outline a node by panel id, or clear the outline with null. */
  highlightNode: "inspect::highlight",
  /** Enable/disable select-and-drag on the canvas (boolean). */
  setMoveEnabled: "move::setEnabled",
  dragDrop: "dragDrop",
  logNode: "logNode",
  log: "log",
  assetsGetAll: "assets::getAll",
  resolveVisitor: "resolveVisitor",
  flashNode: "flashNode",
  /** Dump component into panel clipboard payload. */
  copyComponent: "copyComponent",
  /** Apply clipboard dump values onto an existing component (same cid). */
  pasteComponentValues: "pasteComponentValues",
  /** addComponent(cid) then apply dump on the current node. */
  pasteComponentAsNew: "pasteComponentAsNew",
  /** Dump node transform/layer into panel clipboard payload. */
  copyNode: "copyNode",
  /** Apply clipboard node values onto the selected node. */
  pasteNodeValues: "pasteNodeValues",
  /** Hook director frame events and start pushing profiler samples. */
  profilerStart: "profiler::start",
  /** Unhook director frame events and reset counters. */
  profilerStop: "profiler::stop",
  /** Walk the scene for a Battle world and push ecs::tree (or ecs::unavailable). */
  ecsRefresh: "ecs::refresh",
  /** Dump one entity's live components. Payload: entity id (number). */
  ecsGetEntity: "ecs::getEntity",
  /** Wrap System.onUpdate and start pushing ecs::systemSample. */
  ecsProfilerStart: "ecs::profilerStart",
  /** Restore System.onUpdate and stop samples. */
  ecsProfilerStop: "ecs::profilerStop",
  /** ECS tree / system-sample push interval in ms. 0 pauses auto push. */
  ecsSetInterval: "ecs::setInterval",
  /** Resolve a component's script URL for Sources. */
  resolveComponentSource: "resolveComponentSource",
  /** Resolve a Button/EventHandler binding's script URL (+ search text). */
  resolveHandlerSource: "resolveHandlerSource",
} as const;

/** Payload for Msg.openInSources (side panel → background → DevTools). */
export interface OpenInSourcesPayload {
  tabId: number;
  url?: string;
  line?: number;
  column?: number;
  /** If set and line is missing, DevTools page searches resource content. */
  searchText?: string;
  className?: string;
  hasFn?: boolean;
}

/** Result of resolveComponentSource / resolveHandlerSource. */
export interface SourceLocation {
  /** Best-effort script URL; may be missing — DevTools will search resources. */
  url?: string;
  line?: number;
  column?: number;
  /** Method or class name to search inside Sources resources. */
  searchText?: string;
  /** Component __classname__ used to narrow resource search. */
  className?: string;
  /** Live function was stashed for console.log fallback. */
  hasFn?: boolean;
}

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

export interface InspectStartResult {
  ok: boolean;
  /** Human-readable failure cause, shown by the panel. */
  reason?: string;
}

/** Node currently under the pointer while picking. */
export interface InspectHover {
  /** Panel node id (Mutator id). */
  id: string;
  name: string;
  /** How many nodes the pointer hits, for Alt+wheel cycling. */
  candidates: number;
  /** 0-based position of `id` within those candidates, front-most first. */
  index: number;
}

export interface InspectPick {
  id: string;
}

export const Event = {
  loadingComplete: "loadingComplete",
  sceneData: "sceneData",
  /** Pick-mode preview: InspectHover, or null once the pointer leaves. */
  inspectHover: "inspect::hover",
  /** Pick-mode commit. */
  inspectPick: "inspect::pick",
  /** Pick mode ended in the page (ESC, or auto-exit after a commit). */
  inspectEnd: "inspect::end",
  syncNodeProp: "syncNodeProp",
  syncCompProp: "syncCompProp",
  updateTransform: "updateTransform",
  updateLayer: "updateLayer",
  updateContentSize: "updateContentSize",
  updateAnchorPoint: "updateAnchorPoint",
  assetsAdd: "assets::add",
  assetsRemove: "assets::remove",
  assetsClear: "assets::clear",
  profilerSample: "profiler::sample",
  nodeDrawCalls: "profiler::nodeDrawCalls",
  ecsTree: "ecs::tree",
  ecsSystemSample: "ecs::systemSample",
  ecsUnavailable: "ecs::unavailable",
} as const;

/** Draw calls of the last drawn frame, numbered in submit order. */
export type NodeDrawCalls = {
  /** Every draw call of the frame, including ones no 2D node owns. */
  total: number;
  /** Panel node id -> 1-based index of the first draw call the node opens. */
  index: Record<string, number>;
};

export const EMPTY_NODE_DRAW_CALLS: NodeDrawCalls = { total: 0, index: {} };

/** One 500ms aggregation window pushed from the page to the panel. */
export interface ProfilerSample {
  /** performance.now() at the end of the window. */
  t: number;
  fps: number;
  frame: number;
  logic: number;
  physics: number;
  render: number;
  present: number;
  draws: number;
  instances: number;
  tricount: number;
  /** GFX texture memory, MB. */
  textureMemory: number;
  /** GFX buffer memory, MB. */
  bufferMemory: number;
  /** Chromium-only, MB. Absent elsewhere. */
  jsHeap?: number;
  jsHeapLimit?: number;
}

/** Shared visitor / construct keys (both panel & page use the same build-time constants). */
export const VISITOR_KEY = "[CC-RUNTIME::VISITOR_KEY]";
export const NEW_KEY = "[CC-RUNTIME::NEW_KEY]";

/** Bump the suffix whenever defaultLayout gains a panel, otherwise saved
 * layouts keep hiding the new one. */
export const LAYOUT_STORAGE_KEY = "cc-runtime::layoutConfig::v3";

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

/** Virtual ECS tree: world → type group → entity. */
export interface EcsTreeNode {
  id: string;
  name: string;
  kind: "world" | "group" | "entity";
  entityId?: number;
  componentNames?: string[];
  children?: EcsTreeNode[];
}

export interface EcsEntityDump {
  id: number;
  type: number | string;
  typeName: string;
  camp: number | string;
  campName: string;
  templateId: string;
  components: Record<string, unknown>;
}

export interface EcsSystemStat {
  name: string;
  avgMs: number;
  peakMs: number;
  calls: number;
  entityCount?: number;
}

/** One aggregation window of per-system onUpdate times. */
export interface EcsSystemSample {
  t: number;
  frameMs: number;
  systems: EcsSystemStat[];
}
