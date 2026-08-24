import React, { useEffect, useState } from "react";
import { Checkbox, Collapse, Empty, Input, InputNumber } from "antd";
import { callRpc, Rpc } from "../bridge/rpc";
import { cleanFloat, formatFloatDisplay } from "@shared/number";
import { getEcsState, setEcsState, subscribeEcs, type EcsState } from "../ecsStore";

const { Panel } = Collapse;

const AXIS_CLASS: Record<string, string> = {
  x: "axis-x",
  y: "axis-y",
  z: "axis-z",
  w: "axis-w",
};

const AXIS_ORDER = ["x", "y", "z", "w"];

function capitalize(name: string) {
  if (!name) return name;
  return name[0].toUpperCase() + name.slice(1);
}

function formatScalar(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(cleanFloat(value, 4));
  return String(value);
}

function isPrimitive(value: unknown): boolean {
  return value == null || typeof value !== "object";
}

function isAxisMap(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  return (
    keys.length > 0 &&
    keys.every((k) => AXIS_ORDER.includes(k) && typeof data[k] === "number")
  );
}

function AttrLine({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="attr-line">
      <div className="attr-line-title" title={title}>
        {capitalize(title)}
      </div>
      <div className="attr-line-content">{children}</div>
    </div>
  );
}

function ScalarControl({ value }: { value: unknown }) {
  if (typeof value === "boolean") {
    return <Checkbox checked={value} />;
  }
  if (typeof value === "number") {
    return (
      <InputNumber
        className="attr-input-number"
        size="small"
        value={cleanFloat(value)}
        formatter={(v, info) => formatFloatDisplay(v, info?.userTyping)}
      />
    );
  }
  return (
    <Input
      className="attr-input"
      size="small"
      value={formatScalar(value)}
      readOnly
    />
  );
}

function AxisGroup({
  value,
  keys,
}: {
  value: Record<string, number>;
  keys: string[];
}) {
  return (
    <div className="attr-group">
      <div className="attr-group-line">
        {keys.map((k) => (
          <div className="attr-group-item" key={k}>
            <div className={`attr-group-item-title ${AXIS_CLASS[k] || ""}`}>
              {k.toUpperCase()}
            </div>
            <div className="attr-group-item-content">
              <InputNumber
                className="attr-input-number"
                size="small"
                value={cleanFloat(Number(value[k]) || 0)}
                formatter={(v, info) => formatFloatDisplay(v, info?.userTyping)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttrPanel({
  title,
  panelKey,
  children,
}: {
  title: string;
  panelKey: string;
  children: React.ReactNode;
}) {
  return (
    <div className="attr-panel">
      <Collapse defaultActiveKey={[panelKey]} ghost={false}>
        <Panel
          key={panelKey}
          header={
            <div className="attr-panel-header">
              <div className="attr-panel-header-left">
                <span className="attr-panel-title">{title}</span>
              </div>
            </div>
          }
        >
          {children}
        </Panel>
      </Collapse>
    </div>
  );
}

function CollapsibleSubAttr({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const entityId = getEcsState().selectedEntityId;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [entityId]);

  return (
    <div className="custom-sub-attr">
      <div
        className={`custom-sub-attr-title custom-sub-attr-toggle${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        role="button"
      >
        <span className="custom-sub-attr-caret" />
        {capitalize(title)} ({count})
      </div>
      {open ? children : null}
    </div>
  );
}

function AttrField({ title, data }: { title: string; data: unknown }) {
  if (isPrimitive(data)) {
    return (
      <AttrLine title={title}>
        <ScalarControl value={data} />
      </AttrLine>
    );
  }
  if (Array.isArray(data)) {
    if (!data.length || data.every(isPrimitive)) {
      return (
        <AttrLine title={title}>
          <ScalarControl
            value={data.length ? `[${data.map(formatScalar).join(", ")}]` : "[]"}
          />
        </AttrLine>
      );
    }
    return (
      <CollapsibleSubAttr title={title} count={data.length}>
        {data.map((v, i) => (
          <AttrField key={i} title={String(i)} data={v} />
        ))}
      </CollapsibleSubAttr>
    );
  }
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (!keys.length) {
    return (
      <AttrLine title={title}>
        <ScalarControl value="{}" />
      </AttrLine>
    );
  }
  if (isAxisMap(obj)) {
    const ordered = AXIS_ORDER.filter((k) => k in obj);
    return (
      <AttrLine title={title}>
        <AxisGroup value={obj as Record<string, number>} keys={ordered} />
      </AttrLine>
    );
  }
  return (
    <CollapsibleSubAttr title={title} count={keys.length}>
      {keys.map((k) => (
        <AttrField key={k} title={k} data={obj[k]} />
      ))}
    </CollapsibleSubAttr>
  );
}

function ComponentFields({ data }: { data: unknown }) {
  if (isPrimitive(data) || Array.isArray(data)) {
    return <AttrField title="value" data={data} />;
  }
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (!keys.length) {
    return <ScalarControl value="{}" />;
  }
  return (
    <div className="custom-panel">
      {keys.map((k) => (
        <AttrField key={k} title={k} data={obj[k]} />
      ))}
    </div>
  );
}

export function EntityDetails() {
  const [snap, setSnap] = useState<EcsState>(getEcsState());
  useEffect(() => subscribeEcs(() => setSnap({ ...getEcsState() })), []);

  const { selectedEntityId, pollMs, entityDump, available } = snap;

  useEffect(() => {
    let timer: number | undefined;
    const pull = async () => {
      const id = getEcsState().selectedEntityId;
      if (id == null) {
        setEcsState({ entityDump: null });
        return;
      }
      const dump = await callRpc(Rpc.ecsGetEntity, id);
      if (getEcsState().selectedEntityId !== id) return;
      setEcsState({ entityDump: (dump as EcsState["entityDump"]) || null });
    };
    void pull();
    if (pollMs > 0 && selectedEntityId != null) {
      timer = window.setInterval(pull, pollMs);
    }
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [selectedEntityId, pollMs]);

  if (!available) {
    return (
      <div className="node-details">
        <div className="empty">未检测到 ECS 世界</div>
      </div>
    );
  }

  if (selectedEntityId == null) {
    return (
      <div className="node-details">
        <div className="empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="在实体树中选择一个实体"
          />
        </div>
      </div>
    );
  }

  if (!entityDump) {
    return (
      <div className="node-details">
        <div className="empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="正在读取实体..."
          />
        </div>
      </div>
    );
  }

  const names = Object.keys(entityDump.components || {});
  return (
    <div className="node-details">
      <div className="name-bar">
        <Input
          className="name-input"
          size="small"
          value={String(entityDump.id)}
          readOnly
        />
      </div>
      <AttrPanel title="Entity" panelKey="entity">
        <div className="custom-panel">
          <AttrField title="type" data={entityDump.typeName} />
          <AttrField title="camp" data={entityDump.campName} />
          <AttrField title="templateId" data={entityDump.templateId || ""} />
        </div>
      </AttrPanel>
      {names.length ? (
        names.map((name) => (
          <AttrPanel key={name} title={name} panelKey={name}>
            <ComponentFields data={entityDump.components[name]} />
          </AttrPanel>
        ))
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无组件" />
      )}
    </div>
  );
}
