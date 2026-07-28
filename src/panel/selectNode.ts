import { message } from "antd";
import { callRpc, Rpc } from "./bridge/rpc";
import { findPathIds, getState, setState } from "./store";

let flashTimer: ReturnType<typeof setTimeout> | null = null;

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
      document
        .querySelector(".ant-tree-treenode-selected")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
export async function selectNodeInPanel(id: string, opts?: { flash?: boolean }) {
  if (!id) return;
  const ancestors = findPathIds(getState().scene, id) || [];
  const expanded = new Set([...getState().expandedKeys, ...ancestors]);
  setState({
    selectedId: id,
    details: null,
    expandedKeys: [...expanded],
  });

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

/**
 * Mark the node the pointer is over while picking. Preview only: the selection,
 * the details panel and the tree's expand state are all left alone, so sweeping
 * the cursor across the game cannot disturb what the user was looking at.
 */
export function previewNodeInTree(id: string | null) {
  if (getState().hoverNodeId === id) return;
  setState({ hoverNodeId: id });
}
