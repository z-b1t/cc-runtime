import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Select, Space, Tree } from "antd";
import type { DataNode, EventDataNode } from "antd/es/tree";
import { callRpc, Rpc } from "../bridge/rpc";
import {
  collectCompTypes,
  collectIds,
  collectMatchingNodes,
  findNode,
  getState,
  setState,
  subscribe,
  type AppState,
} from "../store";
import type { NodeDrawCalls, SceneNodeData } from "@shared/protocol";
import { locateNodeInTree, selectNodeInPanel } from "../selectNode";

type DcGutter = {
  /** Colors the gutter; `data-dc` carries the text CSS renders. */
  className?: string;
  "data-dc"?: string;
  tip?: string;
};

/**
 * The draw call index belongs in a gutter at the tree's left edge, so it goes
 * through `data-dc` — rc-tree forwards `data-*` onto the row element — and is
 * drawn by CSS instead of living inside the indented row content.
 */
function dcGutter(
  node: SceneNodeData,
  nodeDc: NodeDrawCalls,
  isRoot: boolean,
): DcGutter {
  // The scene root never renders, so its gutter is free for the frame total.
  if (isRoot && nodeDc.total > 0) {
    return { className: "dc-total", "data-dc": `DC[${nodeDc.total}]` };
  }
  const at = nodeDc.index[node.id] || 0;
  if (at <= 0) return {};
  return {
    className: at % 2 === 1 ? "dc-odd" : "dc-even",
    "data-dc": String(at),
    tip: `本帧第 ${at} 个 draw call 由该节点开启，共 ${nodeDc.total} 个`,
  };
}

function toTreeData(
  node: SceneNodeData,
  flashNodeId: string | null,
  nodeDc: NodeDrawCalls,
  isRoot = false,
): DataNode {
  const { tip, ...gutter } = dcGutter(node, nodeDc, isRoot);
  return {
    ...gutter,
    key: node.id,
    title: (
      <span
        title={tip}
        className={
          flashNodeId === node.id ? "tree-node-title is-flashing" : "tree-node-title"
        }
      >
        {node.name || "<Unnamed>"}
      </span>
    ),
    disableCheckbox: false,
    children: (node.children || []).map((c) => toTreeData(c, flashNodeId, nodeDc)),
  };
}

function collectChecked(node: SceneNodeData | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.active) out.push(node.id);
  node.children?.forEach((c) => collectChecked(c, out));
  return out;
}

export function NodeTree() {
  const [snap, setSnap] = useState<AppState>(getState());
  useEffect(() => {
    const unsub = subscribe(() => setSnap({ ...getState() }));
    return () => {
      unsub();
    };
  }, []);

  const matches = useMemo(
    () =>
      collectMatchingNodes(snap.scene, {
        keyword: snap.search,
        compTypes: snap.compTypeFilter,
      }),
    [snap.scene, snap.search, snap.compTypeFilter],
  );

  const treeData = useMemo(() => {
    if (matches) {
      return matches.map((n) => toTreeData(n, snap.flashNodeId, snap.nodeDc));
    }
    return snap.scene
      ? [toTreeData(snap.scene, snap.flashNodeId, snap.nodeDc, true)]
      : [];
  }, [matches, snap.scene, snap.flashNodeId, snap.nodeDc]);

  const compTypeOptions = useMemo(
    () =>
      collectCompTypes(snap.scene).map((t) => ({
        label: t,
        value: t,
      })),
    [snap.scene],
  );

  const checkedKeys = useMemo(
    () => collectChecked(snap.scene),
    [snap.scene],
  );

  const onSelect = useCallback(async (keys: React.Key[]) => {
    const id = String(keys[0] || "");
    if (!id) return;
    await selectNodeInPanel(id, { flash: false });
  }, []);

  const clearSearchAndLocate = useCallback(() => {
    setState({ search: "" });
    const id = getState().selectedId;
    if (id) {
      // Wait for tree to re-render with full hierarchy before locating.
      setTimeout(() => locateNodeInTree(id, { flash: true }), 0);
    }
  }, []);

  const onCheck = useCallback(
    async (
      _checked: any,
      info: { node: EventDataNode; checked: boolean },
    ) => {
      const id = String(info.node.key);
      await callRpc(`mutatorSet-${id}`, {
        name: "active",
        value: info.checked,
      });
      const scene = getState().scene;
      const n = findNode(scene, id);
      if (n) {
        n.active = info.checked;
        setState({ scene: { ...scene! } });
      }
      const details = getState().details;
      if (details?.id === id) {
        setState({ details: { ...details, active: info.checked } });
      }
    },
    [],
  );

  const onDrop = useCallback(async (info: any) => {
    const dragId = String(info.dragNode.key);
    const dropId = String(info.node.key);

    let index = -1;
    if (info.dropToGap) {
      // antd: dropPosition = relative(-1|1) + siblingIndex.
      // Recover insert index among siblings: before → i, after → i+1.
      const posParts = String(info.node.pos || "").split("-");
      const siblingIndex = Number(posParts[posParts.length - 1]) || 0;
      const relative = Number(info.dropPosition) - siblingIndex;
      index = relative === -1 ? siblingIndex : siblingIndex + 1;
    }
    // !dropToGap → index -1 → injected inserts as first child (rc-tree maps
    // "above first sibling" onto the parent node).

    await callRpc(Rpc.dragDrop, {
      dragId,
      containerId: dropId,
      index,
    });
    await callRpc(Rpc.refreshSceneData);
  }, []);

  const expandAll = () => {
    setState({ expandedKeys: collectIds(snap.scene) });
  };
  const collapseAll = () => setState({ expandedKeys: [] });

  return (
    <div className="panel-body">
      <Space style={{ marginBottom: 8 }} wrap>
        <Input.Search
          placeholder="查找节点"
          allowClear
          value={snap.search}
          onChange={(e) => {
            const v = e.target.value;
            if (!v && snap.search) {
              clearSearchAndLocate();
              return;
            }
            setState({ search: v });
          }}
          onSearch={(v) => {
            if (!v && snap.search) {
              clearSearchAndLocate();
              return;
            }
            setState({ search: v });
          }}
          onPressEnter={() => {
            if (matches?.length) onSelect([matches[0].id]);
          }}
          style={{ width: 180 }}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="组件类型"
          value={snap.compTypeFilter}
          options={compTypeOptions}
          onChange={(v) => setState({ compTypeFilter: v })}
          maxTagCount="responsive"
          style={{ minWidth: 200, maxWidth: 280 }}
          size="small"
        />
        <Button size="small" onClick={expandAll}>
          全部展开
        </Button>
        <Button size="small" onClick={collapseAll}>
          全部折叠
        </Button>
      </Space>
      <Tree
        // The gutter only earns its width once the profiler reports draw calls.
        className={snap.nodeDc.total > 0 ? "tree-dc-gutter" : undefined}
        checkable
        checkStrictly
        draggable={{ icon: false }}
        blockNode
        allowDrop={() => true}
        treeData={treeData}
        checkedKeys={{ checked: checkedKeys, halfChecked: [] }}
        selectedKeys={snap.selectedId ? [snap.selectedId] : []}
        expandedKeys={snap.expandedKeys}
        onExpand={(keys) => setState({ expandedKeys: keys.map(String) })}
        onSelect={onSelect}
        onCheck={onCheck as any}
        onDrop={onDrop}
      />
    </div>
  );
}
