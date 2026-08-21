import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Select, Space, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { ReloadOutlined } from "@ant-design/icons";
import type { EcsTreeNode } from "@shared/protocol";
import { callRpc, Rpc } from "../bridge/rpc";
import {
  ECS_POLL_OPTIONS,
  getEcsState,
  setEcsState,
  subscribeEcs,
  type EcsState,
} from "../ecsStore";

function toTreeData(node: EcsTreeNode): DataNode {
  return {
    key: node.id,
    selectable: node.kind === "entity",
    title: (
      <span className="tree-node-title">
        <span className="tree-node-name">{node.name}</span>
      </span>
    ),
    children: (node.children || []).map(toTreeData),
  };
}

function filterTree(node: EcsTreeNode, keyword: string): EcsTreeNode | null {
  const k = keyword.toLowerCase();
  if (node.kind === "entity") {
    return node.name.toLowerCase().includes(k) ? node : null;
  }
  const children = (node.children || [])
    .map((c) => filterTree(c, k))
    .filter(Boolean) as EcsTreeNode[];
  if (node.kind === "world") return { ...node, children };
  if (children.length) return { ...node, children, name: node.name };
  return node.name.toLowerCase().includes(k) ? { ...node, children: [] } : null;
}

export function EntityTree() {
  const [snap, setSnap] = useState<EcsState>(getEcsState());
  useEffect(() => subscribeEcs(() => setSnap({ ...getEcsState() })), []);

  useEffect(() => {
    void callRpc(Rpc.ecsSetInterval, snap.pollMs);
  }, [snap.pollMs]);

  const visible = useMemo(() => {
    if (!snap.tree) return null;
    const kw = snap.search.trim();
    return kw ? filterTree(snap.tree, kw) : snap.tree;
  }, [snap.tree, snap.search]);

  const treeData = useMemo(
    () => (visible ? [toTreeData(visible)] : []),
    [visible],
  );

  const selectedKey =
    snap.selectedEntityId != null ? `ent-${snap.selectedEntityId}` : undefined;

  const onSelect = useCallback((keys: React.Key[]) => {
    const key = String(keys[0] || "");
    if (!key.startsWith("ent-")) return;
    const id = Number(key.slice(4));
    if (!Number.isFinite(id)) return;
    setEcsState({ selectedEntityId: id });
  }, []);

  const onPoll = useCallback((value: number) => {
    setEcsState({ pollMs: value });
  }, []);

  const refresh = useCallback(() => {
    void callRpc(Rpc.ecsRefresh);
  }, []);

  if (!snap.available && !snap.tree) {
    return (
      <div className="panel-body">
        <Space style={{ marginBottom: 8 }} wrap>
          <Select
            size="small"
            value={snap.pollMs}
            options={[...ECS_POLL_OPTIONS]}
            onChange={onPoll}
            style={{ width: 100 }}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
        </Space>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未检测到 ECS 世界"
        />
      </div>
    );
  }

  return (
    <div className="panel-body">
      <Space style={{ marginBottom: 8 }} wrap>
        <Input.Search
          placeholder="查找实体"
          allowClear
          value={snap.search}
          onChange={(e) => setEcsState({ search: e.target.value })}
          style={{ width: 180 }}
        />
        <Select
          size="small"
          value={snap.pollMs}
          options={[...ECS_POLL_OPTIONS]}
          onChange={onPoll}
          style={{ width: 100 }}
        />
        <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
      </Space>
      <Tree
        blockNode
        treeData={treeData}
        selectedKeys={selectedKey ? [selectedKey] : []}
        expandedKeys={snap.expandedKeys}
        onExpand={(keys) => setEcsState({ expandedKeys: keys.map(String) })}
        onSelect={onSelect}
      />
    </div>
  );
}
