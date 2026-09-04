import { message } from "antd";
import { callRpc, Rpc } from "./bridge/rpc";
import { collectDisplayedIds, findPathIds, getState, setState } from "./store";

let flashTimer: ReturnType<typeof setTimeout> | null = null;
/** Origin of Shift+click range select; kept until the next plain click. */
let rangeAnchorId: string | null = null;

/** Blink the row and bring it into view once the tree has re-rendered. */
function flashRow(id: string, flash: boolean) {
  if (flash) {
    if (flashTimer) clearTimeout(flashTimer);
    setState({ flashNodeId: id });
    flashTimer = setTimeout(() => {
      if (getState().flashNodeId === id) setState({ flashNodeId: null });
      flashTimer = null;
    }, 900);
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const row =
        document.querySelector(
          `.ant-tree-treenode[data-node-id="${CSS.escape(id)}"]`,
        ) || document.querySelector(".ant-tree-treenode-selected");
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  });
}

function expandAncestors(id: string) {
  const ancestors = findPathIds(getState().scene, id) || [];
  const expanded = new Set([...getState().expandedKeys, ...ancestors]);
  setState({ expandedKeys: [...expanded] });
}

/** Expand ancestors of `id` and scroll the selected tree row into view. */
export function locateNodeInTree(id: string, opts?: { flash?: boolean }) {
  if (!id) return;
  expandAncestors(id);
  flashRow(id, opts?.flash !== false);
}

/** Select a node in the panel tree, expand ancestors, load details, flash row. */
export async function selectNodeInPanel(
  id: string,
  opts?: { flash?: boolean; selectedIds?: string[]; keepAnchor?: boolean },
) {
  if (!id) return;
  const ancestors = findPathIds(getState().scene, id) || [];
  const expanded = new Set([...getState().expandedKeys, ...ancestors]);
  if (!opts?.keepAnchor || !rangeAnchorId) rangeAnchorId = id;
  setState({
    selectedId: id,
    selectedIds: opts?.selectedIds ?? [id],
    details: null,
    expandedKeys: [...expanded],
  });

  // Outline this node; canvas XY drag needs the panel "拖动节点" toggle on.
  void callRpc(Rpc.highlightNode, { id }).catch(() => {});

  try {
    const details = await callRpc(Rpc.getNodeDetails, id);
    if (getState().selectedId !== id) return;
    setState({ details: (details as any) || null });
    if (!details) {
      message.warning("无法获取节点详情");
    }
  } catch (err) {
    console.error(err);
    message.error("获取节点详情失败");
  }

  flashRow(id, opts?.flash !== false);
}

/** Shift+click: select the visible-tree range from the last plain click to `id`. */
export async function selectNodeRange(id: string) {
  if (!id) return;
  const { scene, search, compTypeFilter, expandedKeys, selectedId } = getState();
  const ordered = collectDisplayedIds(scene, expandedKeys, {
    keyword: search,
    compTypes: compTypeFilter,
  });
  const fromId = rangeAnchorId || selectedId || id;
  const a = ordered.indexOf(fromId);
  const b = ordered.indexOf(id);
  const selectedIds =
    a < 0 || b < 0
      ? [id]
      : ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
  await selectNodeInPanel(id, {
    flash: false,
    selectedIds,
    keepAnchor: true,
  });
}

/**
 * Mark the node the pointer is over while picking. Preview only: the selection,
 * the details panel and the tree's expand state are all left alone, so sweeping
 * the cursor across the game cannot disturb what the user was looking at.
 */
export function previewNodeInTree(id: string | null) {
  if (getState().hoverNodeId === id) return;
  setState({ hoverNodeId: id });
}
