import { message } from "antd";
import { callRpc, Rpc } from "./bridge/rpc";
import { findPathIds, getState, setState } from "./store";

let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Select a node in the panel tree, expand ancestors, load details, flash row. */
export async function selectNodeInPanel(id: string, opts?: { flash?: boolean }) {
  if (!id) return;
  const scene = getState().scene;
  const ancestors = findPathIds(scene, id) || [];
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

  if (opts?.flash !== false) {
    if (flashTimer) clearTimeout(flashTimer);
    setState({ flashNodeId: id });
    flashTimer = setTimeout(() => {
      if (getState().flashNodeId === id) setState({ flashNodeId: null });
      flashTimer = null;
    }, 900);
  }
}
