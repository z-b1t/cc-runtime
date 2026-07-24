import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Space, Tree, message } from "antd";
import type { DataNode, EventDataNode } from "antd/es/tree";
import { callRpc, Rpc } from "../bridge/rpc";
import {
  collectIds,
  filterTree,
  getState,
  setState,
  subscribe,
  type AppState,
} from "../store";
import type { SceneNodeData } from "@shared/protocol";

function toTreeData(node: SceneNodeData): DataNode {
  return {
    key: node.id,
    title: node.name || "<Unnamed>",
    disableCheckbox: false,
    children: (node.children || []).map(toTreeData),
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
  useEffect(() => subscribe(() => setSnap({ ...getState() })), []);

  const filtered = useMemo(
    () => filterTree(snap.scene, snap.search),
    [snap.scene, snap.search],
  );
  const treeData = useMemo(
    () => (filtered ? [toTreeData(filtered)] : []),
    [filtered],
  );
  const checkedKeys = useMemo(
    () => collectChecked(snap.scene),
    [snap.scene],
  );

  const onSelect = useCallback(async (keys: React.Key[]) => {
    const id = String(keys[0] || "");
    if (!id) return;
    setState({ selectedId: id, details: null });
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

  const logNode = async () => {
    if (!snap.selectedId) return;
    await callRpc(Rpc.logNode, snap.selectedId);
    message.success("节点已输出至控制台");
  };

  return (
    <div className="panel-body">
      <Space style={{ marginBottom: 8 }} wrap>
        <Input.Search
          placeholder="查找节点"
          allowClear
          value={snap.search}
          onChange={(e) => setState({ search: e.target.value })}
          onSearch={(v) => setState({ search: v })}
          onPressEnter={() => {
            const f = filterTree(snap.scene, snap.search);
            if (f) onSelect([f.id]);
          }}
          style={{ width: 180 }}
        />
        <Button size="small" onClick={() => setState({ search: "" })}>
          清除搜索
        </Button>
        <Button size="small" onClick={expandAll}>
          全部展开
        </Button>
        <Button size="small" onClick={collapseAll}>
          全部折叠
        </Button>
        <Button size="small" onClick={logNode} disabled={!snap.selectedId}>
          将节点输出至控制台
        </Button>
      </Space>
      <Tree
        checkable
        checkStrictly
        draggable
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
