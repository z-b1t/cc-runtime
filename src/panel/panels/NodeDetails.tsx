import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
  Select,
  Tooltip,
  message,
} from "antd";
import { ExportOutlined, DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { callRpc, Rpc } from "../bridge/rpc";
import { getState, setState, subscribe, type AppState } from "../store";
import { selectNodeInPanel } from "../selectNode";
import { NEW_KEY, VISITOR_KEY } from "@shared/protocol";
import { cleanFloat, formatFloatDisplay } from "@shared/number";
import { ColorAttrField, packAbgr } from "./ColorPicker";

const { Panel } = Collapse;

const AXIS_CLASS: Record<string, string> = {
  x: "axis-x",
  y: "axis-y",
  z: "axis-z",
  w: "axis-w",
  h: "axis-y",
  width: "axis-x",
  height: "axis-y",
};

function axisClassFor(key: string, typeName?: string) {
  if (typeName === "cc.Size" || typeName === "cc.Rect") {
    if (key === "w" || key === "width") return "axis-x";
    if (key === "h" || key === "height") return "axis-y";
  }
  return AXIS_CLASS[key] || "";
}

async function refreshNodeDetails() {
  const id = getState().details?.id;
  if (!id) return;
  const details = await callRpc(Rpc.getNodeDetails, id);
  if (details) setState({ details });
}

function capitalize(name: string) {
  if (!name) return name;
  return name[0].toUpperCase() + name.slice(1);
}

function enumOptions(list: any): { label: string; value: any }[] {
  if (!list) return [];
  if (Array.isArray(list)) {
    return list
      .filter((item) => item && typeof item === "object" && "name" in item)
      .map((item) => ({ label: String(item.name), value: item.value }));
  }
  return Object.entries(list)
    .filter(([k, v]) => Number.isNaN(Number(k)) && (typeof v === "number" || typeof v === "string"))
    .map(([k, v]) => ({ label: k, value: v as any }));
}

/** Cocos-style prop row: label 33% / control 67% */
function AttrLine({
  title,
  tooltip,
  readonly,
  children,
}: {
  title: string;
  tooltip?: string;
  readonly?: boolean;
  children: React.ReactNode;
}) {
  const label = (
    <div className="attr-line-title" title={tooltip || title}>
      {capitalize(title)}
    </div>
  );
  return (
    <div className={`attr-line${readonly ? " is-readonly" : ""}`}>
      {tooltip ? <Tooltip title={tooltip}>{label}</Tooltip> : label}
      <div className="attr-line-content">{children}</div>
    </div>
  );
}

function AxisGroup({
  value,
  onChange,
  keys,
  perLine,
  typeName,
  disabled,
}: {
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  keys: string[];
  perLine?: number;
  typeName?: string;
  disabled?: boolean;
}) {
  const cols = perLine || (keys.length > 3 ? 2 : keys.length || 1);
  const rows: string[][] = [];
  for (let i = 0; i < keys.length; i += cols) {
    rows.push(keys.slice(i, i + cols));
  }
  return (
    <div className="attr-group">
      {rows.map((row, ri) => (
        <div className="attr-group-line" key={ri}>
          {row.map((k) => (
            <div className="attr-group-item" key={k}>
              <div
                className={`attr-group-item-title ${axisClassFor(k, typeName)}`}
              >
                {k.length <= 1 ? k.toUpperCase() : capitalize(k)}
              </div>
              <div className="attr-group-item-content">
                <InputNumber
                  className="attr-input-number"
                  size="small"
                  step={0.01}
                  disabled={disabled}
                  value={cleanFloat(Number(value?.[k]) || 0)}
                  formatter={(v, info) =>
                    formatFloatDisplay(v, info?.userTyping)
                  }
                  onChange={(n) =>
                    onChange({
                      ...value,
                      [k]: cleanFloat(n == null ? 0 : Number(n)),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function plainToNewKey(next: Record<string, number>, typeName?: string) {
  if (typeName === "cc.Size") {
    return {
      [NEW_KEY]: {
        cls: "cc.Size",
        args: [next.w ?? next.width ?? 0, next.h ?? next.height ?? 0],
      },
    };
  }
  if (typeName === "cc.Rect") {
    return {
      [NEW_KEY]: {
        cls: "cc.Rect",
        args: [
          next.x ?? 0,
          next.y ?? 0,
          next.w ?? next.width ?? 0,
          next.h ?? next.height ?? 0,
        ],
      },
    };
  }
  if (typeName === "cc.Vec2") {
    return { [NEW_KEY]: { cls: "cc.Vec2", args: [next.x || 0, next.y || 0] } };
  }
  if (typeName === "cc.Vec4" || typeName === "cc.Quat") {
    return {
      [NEW_KEY]: {
        cls: typeName,
        args: [next.x || 0, next.y || 0, next.z || 0, next.w || 0],
      },
    };
  }
  return {
    [NEW_KEY]: {
      cls: "cc.Vec3",
      args: [next.x || 0, next.y || 0, next.z || 0],
    },
  };
}

/** One Click Event row: Target / Component / Handler / CustomEventData. */
function EventHandlerItem({
  index,
  event,
  onRemove,
}: {
  index: number;
  event: any;
  onRemove: () => void;
}) {
  const eventId = event?.[VISITOR_KEY];
  const [component, setComponent] = useState(String(event?.component || ""));
  const [handler, setHandler] = useState(String(event?.handler || ""));
  const [customData, setCustomData] = useState(
    String(event?.customEventData ?? ""),
  );

  useEffect(() => {
    setComponent(String(event?.component || ""));
    setHandler(String(event?.handler || ""));
    setCustomData(String(event?.customEventData ?? ""));
  }, [event?.component, event?.handler, event?.customEventData]);

  const commitField = async (name: string, value: any) => {
    if (!eventId) return;
    await callRpc(`mutatorSet-${eventId}`, { name, value });
    await refreshNodeDetails();
  };

  const target = event?.target;
  const targetVisitorId = target?.[VISITOR_KEY];
  const targetName =
    (target?.name && String(target.name).trim()) || "None";
  const compOpts = Array.from(
    new Set([
      ...(event?.componentOptions || []),
      ...(component ? [component] : []),
    ]),
  ).map((n) => ({ label: n, value: n }));
  const handlerOpts = Array.from(
    new Set([
      ...(event?.handlerOptions || []),
      ...(handler ? [handler] : []),
    ]),
  ).map((n) => ({ label: n, value: n }));

  return (
    <div className="event-handler-item">
      <div className="event-handler-item-header">
        <span className="event-handler-item-title">{`Event [${index}]`}</span>
        <span className="event-handler-item-actions">
          <Tooltip title="刷新">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => refreshNodeDetails()}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={onRemove}
            />
          </Tooltip>
        </span>
      </div>
      <AttrLine title="Target">
        <div
          className={`attr-comp-input${targetVisitorId ? " filled clickable" : ""}`}
          role={targetVisitorId ? "button" : undefined}
          title={targetVisitorId ? `跳转到：${targetName}` : undefined}
          onClick={
            targetVisitorId
              ? async () => {
                  const resolved = (await callRpc(
                    Rpc.resolveVisitor,
                    targetVisitorId,
                  )) as { nodeId?: string } | null;
                  const nodeId = resolved?.nodeId;
                  if (!nodeId) return;
                  await selectNodeInPanel(nodeId);
                  callRpc(Rpc.flashNode, nodeId).catch(() => {});
                }
              : undefined
          }
        >
          <span className="type-tag">
            <span className="text">cc.Node</span>
          </span>
          <span className="input">{targetVisitorId ? targetName : "None"}</span>
        </div>
      </AttrLine>
      <AttrLine title="Component">
        <Select
          className="attr-select"
          size="small"
          value={component || undefined}
          placeholder="None"
          options={compOpts}
          showSearch
          allowClear
          optionFilterProp="label"
          onChange={async (v) => {
            const next = v || "";
            setComponent(next);
            await commitField("_componentName", next);
          }}
        />
      </AttrLine>
      <AttrLine title="Handler">
        <Select
          className="attr-select"
          size="small"
          value={handler || undefined}
          placeholder="None"
          options={handlerOpts}
          showSearch
          allowClear
          optionFilterProp="label"
          onChange={async (v) => {
            const next = v || "";
            setHandler(next);
            await commitField("handler", next);
          }}
        />
      </AttrLine>
      <AttrLine title="CustomEventData">
        <Input
          className="attr-input"
          size="small"
          value={customData}
          onChange={(e) => setCustomData(e.target.value)}
          onBlur={() => commitField("customEventData", customData)}
        />
      </AttrLine>
    </div>
  );
}

function AttrField({
  attr,
  mutatorId,
}: {
  attr: any;
  mutatorId: string;
}) {
  const [val, setVal] = useState(attr.default);
  useEffect(() => setVal(attr.default), [attr.default]);

  const commit = async (next: any) => {
    setVal(next);
    await callRpc(`mutatorSet-${mutatorId}`, { name: attr.name, value: next });
    await refreshNodeDetails();
  };

  const title = attr.displayName || attr.name;
  const tip =
    attr.tooltip && !String(attr.tooltip).startsWith("i18n:")
      ? attr.tooltip
      : title;

  if (attr.visible === false) return null;

  // valueMap keeps its editors when readonly (e.g. Sprite.fillCenter non-RADIAL).
  if (attr.readonly && attr.type !== "valueMap") {
    return (
      <AttrLine title={title} tooltip={tip} readonly>
        <span className="attr-readonly">{String(val)}</span>
      </AttrLine>
    );
  }

  switch (attr.type) {
    case "boolean":
      return (
        <AttrLine title={title} tooltip={tip}>
          <Checkbox checked={!!val} onChange={(e) => commit(e.target.checked)} />
        </AttrLine>
      );
    case "number":
      return (
        <AttrLine title={title} tooltip={tip}>
          <InputNumber
            className="attr-input-number"
            size="small"
            value={typeof val === "number" ? cleanFloat(val) : val}
            step={attr.step ?? 0.01}
            formatter={(v, info) => formatFloatDisplay(v, info?.userTyping)}
            onChange={(n) => commit(cleanFloat(Number(n) || 0))}
          />
        </AttrLine>
      );
    case "string":
      return (
        <AttrLine title={title} tooltip={tip}>
          <Input
            className="attr-input"
            size="small"
            value={val ?? ""}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => commit(val)}
          />
        </AttrLine>
      );
    case "enum": {
      const opts = enumOptions(attr.enumList);
      return (
        <AttrLine title={title} tooltip={tip}>
          <Select
            className="attr-select"
            size="small"
            value={val}
            options={opts}
            optionFilterProp="label"
            showSearch
            onChange={commit}
          />
        </AttrLine>
      );
    }
    case "bitMask": {
      // Multi-select by flag name; commit OR of selected bit values.
      const opts = enumOptions(attr.bitmaskList);
      const nameByValue = new Map(opts.map((o) => [o.value, o.label]));
      const valueByName = new Map(opts.map((o) => [o.label, o.value]));
      const selectedNames: string[] = [];
      const num = Number(val) || 0;
      for (const o of opts) {
        if ((num & Number(o.value)) === Number(o.value) && Number(o.value) !== 0) {
          selectedNames.push(o.label);
        }
      }
      // Orphan bits not in list (same as original "N *")
      for (let b = 0; b < 32; b++) {
        const bit = 1 << b;
        if ((num & bit) === bit && !nameByValue.has(bit)) {
          const label = `${bit} *`;
          opts.push({ label, value: bit });
          valueByName.set(label, bit);
          selectedNames.push(label);
        }
      }
      return (
        <AttrLine title={title} tooltip={tip}>
          <Select
            className="attr-select"
            size="small"
            mode="multiple"
            allowClear
            value={selectedNames}
            options={opts.map((o) => ({ label: o.label, value: o.label }))}
            optionFilterProp="label"
            maxTagCount="responsive"
            onChange={(names: string[]) => {
              const next = names.reduce(
                (acc, name) => acc | (Number(valueByName.get(name)) || 0),
                0,
              );
              commit(next >>> 0);
            }}
          />
        </AttrLine>
      );
    }
    case "color": {
      return (
        <AttrLine title={title} tooltip={tip}>
          <ColorAttrField
            value={val}
            onCommit={async (c) => {
              setVal({ _val: packAbgr(c), ...c });
              await callRpc(`mutatorSet-${mutatorId}`, {
                name: attr.name,
                value: {
                  [NEW_KEY]: { cls: "cc.Color", args: [c.r, c.g, c.b, c.a] },
                },
              });
              await refreshNodeDetails();
            }}
          />
        </AttrLine>
      );
    }
    case "valueMap": {
      const map = val && typeof val === "object" ? val : {};
      const keys = Object.keys(map).filter((k) => typeof map[k] === "number");
      // Prefer stable Size/Rect/Vec order (w/h for Size/Rect)
      const preferred = ["x", "y", "z", "w", "h", "width", "height"];
      keys.sort((a, b) => {
        const ia = preferred.indexOf(a);
        const ib = preferred.indexOf(b);
        if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return a.localeCompare(b);
      });
      if (!keys.length) {
        return (
          <AttrLine title={title} tooltip={tip}>
            <span className="attr-readonly">{JSON.stringify(map)}</span>
          </AttrLine>
        );
      }
      return (
        <AttrLine title={title} tooltip={tip} readonly={!!attr.readonly}>
          <AxisGroup
            value={map}
            keys={keys}
            typeName={attr.typeName}
            disabled={!!attr.readonly}
            perLine={keys.length > 3 ? 2 : keys.length}
            onChange={async (next) => {
              if (attr.readonly) return;
              setVal(next);
              await callRpc(`mutatorSet-${mutatorId}`, {
                name: attr.name,
                value: plainToNewKey(next, attr.typeName),
              });
              await refreshNodeDetails();
            }}
          />
        </AttrLine>
      );
    }
    case "object": {
      const visitorId = val?.[VISITOR_KEY];
      const jumpable = !!visitorId;
      const displayName =
        (val?.name && String(val.name).trim()) ||
        attr.typeName ||
        "Object";
      return (
        <AttrLine title={title} tooltip={tip}>
          <div
            className={`attr-comp-input${jumpable ? " filled clickable" : ""}`}
            role={jumpable ? "button" : undefined}
            title={jumpable ? `跳转到：${displayName}` : undefined}
            onClick={
              jumpable
                ? async () => {
                    const resolved = (await callRpc(
                      Rpc.resolveVisitor,
                      visitorId,
                    )) as { nodeId?: string } | null;
                    const nodeId = resolved?.nodeId;
                    if (!nodeId) return;
                    await selectNodeInPanel(nodeId);
                    callRpc(Rpc.flashNode, nodeId).catch(() => {});
                  }
                : undefined
            }
          >
            <span className="type-tag">
              <span className="text">{attr.typeName || "Object"}</span>
            </span>
            <span className="input">{jumpable ? displayName : "None"}</span>
          </div>
        </AttrLine>
      );
    }
    case "sub":
      return (
        <div className="custom-sub-attr">
          <div className="custom-sub-attr-title">{capitalize(title)}</div>
          {(attr.subAttrs || []).map((s: any) => (
            <AttrField
              key={s.name}
              attr={{ ...s, default: val?.[s.name] }}
              mutatorId={mutatorId}
            />
          ))}
        </div>
      );
    case "eventHandlerArray": {
      const list: any[] = Array.isArray(val) ? val : [];
      const setLen = async (n: number) => {
        await callRpc(`mutatorSet-${mutatorId}`, {
          name: attr.name,
          value: { __ccArrayLen: Math.max(0, n | 0) },
        });
        await refreshNodeDetails();
      };
      const removeAt = async (idx: number) => {
        await callRpc(`mutatorSet-${mutatorId}`, {
          name: attr.name,
          value: { __ccArraySplice: idx },
        });
        await refreshNodeDetails();
      };
      return (
        <div className="event-handler-array">
          <div className="event-handler-array-title" title={tip}>
            {title}
          </div>
          <AttrLine title="Count">
            <InputNumber
              className="attr-input-number"
              size="small"
              min={0}
              step={1}
              value={list.length}
              onChange={(n) => setLen(Number(n) || 0)}
            />
          </AttrLine>
          {list.map((ev, idx) => (
            <EventHandlerItem
              key={ev?.[VISITOR_KEY] || idx}
              index={idx}
              event={ev}
              onRemove={() => removeAt(idx)}
            />
          ))}
        </div>
      );
    }
    default:
      return (
        <AttrLine title={title} tooltip={tip}>
          <Input
            className="attr-input"
            size="small"
            value={val == null ? "" : String(val)}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => commit(val)}
          />
        </AttrLine>
      );
  }
}

/** Cocos 3.8.8 Label inspector attrs (order + visibility). */
function buildLabelAttrs(data: any): any[] {
  const useSystemFont = !!data.useSystemFont;
  const isBMFont = !!data.isBMFont;
  const isUnderline = !!data.isUnderline;
  const enableOutline = !!data.enableOutline;
  const enableShadow = !!data.enableShadow;
  const cacheChar =
    data.cacheMode === (data.cacheModeMap?.CHAR ?? 2);
  const notBMFont = !isBMFont;
  const shadowVisible = enableShadow && notBMFont && !cacheChar;

  return [
    {
      name: "customMaterial",
      type: "object",
      typeName: "cc.Material",
      default: data.customMaterial,
    },
    { name: "color", type: "color", typeName: "cc.Color", default: data.color },
    { name: "string", type: "string", default: data.string ?? "" },
    {
      name: "horizontalAlign",
      type: "enum",
      enumList: data.horizontalAlignMap,
      default: data.horizontalAlign,
    },
    {
      name: "verticalAlign",
      type: "enum",
      enumList: data.verticalAlignMap,
      default: data.verticalAlign,
    },
    {
      name: "actualFontSize",
      type: "number",
      default: data.actualFontSize,
      readonly: true,
      step: 1,
    },
    { name: "fontSize", type: "number", default: data.fontSize, step: 1 },
    {
      name: "fontFamily",
      type: "string",
      default: data.fontFamily ?? "",
      visible: useSystemFont,
    },
    { name: "lineHeight", type: "number", default: data.lineHeight, step: 1 },
    {
      name: "spacingX",
      type: "number",
      default: data.spacingX,
      visible: !useSystemFont && isBMFont,
      step: 1,
    },
    {
      name: "overflow",
      type: "enum",
      enumList: data.overflowMap,
      default: data.overflow,
    },
    {
      name: "enableWrapText",
      type: "boolean",
      default: data.enableWrapText,
    },
    {
      name: "font",
      type: "object",
      typeName: "cc.Font",
      default: data.font,
      visible: !useSystemFont,
    },
    {
      name: "useSystemFont",
      type: "boolean",
      default: data.useSystemFont,
    },
    {
      name: "cacheMode",
      type: "enum",
      enumList: data.cacheModeMap,
      default: data.cacheMode,
    },
    { name: "isBold", type: "boolean", default: data.isBold },
    { name: "isItalic", type: "boolean", default: data.isItalic },
    { name: "isUnderline", type: "boolean", default: data.isUnderline },
    {
      name: "underlineHeight",
      type: "number",
      default: data.underlineHeight,
      visible: isUnderline,
      step: 1,
    },
    {
      name: "enableOutline",
      type: "boolean",
      default: data.enableOutline,
      visible: notBMFont,
    },
    {
      name: "outlineColor",
      type: "color",
      typeName: "cc.Color",
      default: data.outlineColor,
      visible: enableOutline && notBMFont,
    },
    {
      name: "outlineWidth",
      type: "number",
      default: data.outlineWidth,
      visible: enableOutline && notBMFont,
      step: 0.1,
    },
    {
      name: "enableShadow",
      type: "boolean",
      default: data.enableShadow,
      visible: notBMFont && !cacheChar,
    },
    {
      name: "shadowColor",
      type: "color",
      typeName: "cc.Color",
      default: data.shadowColor,
      visible: shadowVisible,
    },
    {
      name: "shadowOffset",
      type: "valueMap",
      typeName: "cc.Vec2",
      default: data.shadowOffset,
      visible: shadowVisible,
    },
    {
      name: "shadowBlur",
      type: "number",
      default: data.shadowBlur,
      visible: shadowVisible,
      step: 0.1,
    },
  ];
}

function LabelInspector({ data, id }: { data: any; id: string }) {
  const attrs = useMemo(() => buildLabelAttrs(data), [data]);
  return (
    <div className="label-panel">
      {attrs.map((a) => (
        <AttrField key={a.name} attr={a} mutatorId={id} />
      ))}
    </div>
  );
}

function WidgetInspector({ data, id }: { data: any; id: string }) {
  const flags = [
    "isAlignTop",
    "isAlignBottom",
    "isAlignLeft",
    "isAlignRight",
    "isAlignVerticalCenter",
    "isAlignHorizontalCenter",
  ] as const;
  const nums = [
    "top",
    "bottom",
    "left",
    "right",
    "verticalCenter",
    "horizontalCenter",
  ] as const;
  return (
    <div className="label-panel">
      {flags.map((f) => (
        <AttrLine key={f} title={f}>
          <Checkbox
            defaultChecked={!!data[f]}
            onChange={(e) =>
              callRpc(`mutatorSet-${id}`, {
                name: f,
                value: e.target.checked,
              })
            }
          />
        </AttrLine>
      ))}
      {nums.map((k) => (
        <AttrLine key={k} title={k}>
          <InputNumber
            className="attr-input-number"
            size="small"
            defaultValue={
              typeof data[k] === "number" ? cleanFloat(data[k]) : data[k]
            }
            step={0.01}
            formatter={(v, info) => formatFloatDisplay(v, info?.userTyping)}
            onChange={(n) =>
              callRpc(`mutatorSet-${id}`, {
                name: k,
                value: cleanFloat(Number(n) || 0),
              })
            }
          />
        </AttrLine>
      ))}
    </div>
  );
}

function AttrPanel({
  title,
  activeCheckable,
  active,
  onActiveChange,
  addon,
  children,
  panelKey,
}: {
  title: string;
  activeCheckable?: boolean;
  active?: boolean;
  onActiveChange?: (v: boolean) => void;
  addon?: React.ReactNode;
  children: React.ReactNode;
  panelKey: string;
}) {
  return (
    <div className="attr-panel">
      <Collapse defaultActiveKey={[panelKey]} ghost={false}>
        <Panel
          key={panelKey}
          header={
            <div className="attr-panel-header">
              <div className="attr-panel-header-left">
                {activeCheckable && (
                  <Checkbox
                    checked={!!active}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onActiveChange?.(e.target.checked)}
                  />
                )}
                <span className="attr-panel-title">{title}</span>
              </div>
              {addon}
            </div>
          }
        >
          {children}
        </Panel>
      </Collapse>
    </div>
  );
}

function ComponentPanel({ comp }: { comp: any }) {
  const log = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await callRpc(Rpc.log, { datas: [comp], level: "log" });
    message.success("已输出至控制台");
  };

  let body: React.ReactNode;
  if (comp.type === "cc.Label") {
    body = <LabelInspector data={comp} id={comp.id} />;
  } else if (comp.type === "cc.Widget") {
    body = <WidgetInspector data={comp} id={comp.id} />;
  } else if (comp.attrs) {
    body = (
      <div className="custom-panel">
        {comp.attrs.map((a: any) => (
          <AttrField key={a.name} attr={a} mutatorId={comp.id} />
        ))}
      </div>
    );
  } else {
    body = (
      <div className="custom-panel">
        {Object.keys(comp)
          .filter((k) => !["id", "type", "typeId", "enabled"].includes(k))
          .map((k) => (
            <AttrField
              key={k}
              attr={{ name: k, type: typeof comp[k], default: comp[k] }}
              mutatorId={comp.id}
            />
          ))}
      </div>
    );
  }

  return (
    <AttrPanel
      panelKey={comp.id}
      title={comp.type}
      activeCheckable={typeof comp.enabled === "boolean"}
      active={comp.enabled}
      onActiveChange={async (v) => {
        await callRpc(`mutatorSet-${comp.id}`, { name: "enabled", value: v });
        const details = getState().details;
        if (!details?.components) return;
        setState({
          details: {
            ...details,
            components: details.components.map((c: any) =>
              c.id === comp.id ? { ...c, enabled: v } : c,
            ),
          },
        });
      }}
      addon={
        <Tooltip title="输出数据到控制台">
          <Button
            className="export-button"
            type="text"
            size="small"
            icon={<ExportOutlined />}
            onClick={log}
          />
        </Tooltip>
      }
    >
      {body}
    </AttrPanel>
  );
}

function NodeTransform({
  id,
  nodeAttrs,
}: {
  id: string;
  nodeAttrs: NonNullable<NonNullable<AppState["details"]>["nodeAttrs"]>;
}) {
  const { position, eulerAngles, scale, layer, layerNameMap } = nodeAttrs;

  const layerOpts = useMemo(
    () =>
      Object.entries(layerNameMap || {})
        .filter(
          ([k, v]) =>
            typeof v === "number" && k !== "NONE" && k !== "ALL",
        )
        .map(([k, v]) => ({ label: k, value: v as number })),
    [layerNameMap],
  );

  const setVec = async (
    prop: "position" | "eulerAngles" | "scale",
    v: Record<string, number>,
  ) => {
    await callRpc(`mutatorSet-${id}`, {
      name: prop,
      value: {
        [NEW_KEY]: { cls: "cc.Vec3", args: [v.x || 0, v.y || 0, v.z || 0] },
      },
    });
    const d = getState().details;
    if (!d?.nodeAttrs) return;
    setState({
      details: {
        ...d,
        nodeAttrs: { ...d.nodeAttrs, [prop]: v as any },
      },
    });
  };

  return (
    <div className="node-panel">
      <AttrLine title="Position">
        <AxisGroup
          value={position}
          keys={["x", "y", "z"]}
          onChange={(v) => setVec("position", v)}
        />
      </AttrLine>
      <AttrLine title="Rotation">
        <AxisGroup
          value={eulerAngles}
          keys={["x", "y", "z"]}
          onChange={(v) => setVec("eulerAngles", v)}
        />
      </AttrLine>
      <AttrLine title="Scale">
        <AxisGroup
          value={scale}
          keys={["x", "y", "z"]}
          onChange={(v) => setVec("scale", v)}
        />
      </AttrLine>
      <AttrLine title="Layer">
        <Select
          className="attr-select"
          size="small"
          value={layer}
          options={layerOpts}
          onChange={(v) =>
            callRpc(`mutatorSet-${id}`, { name: "layer", value: v })
          }
        />
      </AttrLine>
    </div>
  );
}

export function NodeDetails() {
  const [snap, setSnap] = useState<AppState>(getState());
  useEffect(() => subscribe(() => setSnap({ ...getState() })), []);
  const d = snap.details;

  if (!d) {
    return (
      <div className="node-details">
        <div className="empty">选择节点以查看详情</div>
      </div>
    );
  }

  return (
    <div className="node-details">
      <div className="name-bar">
        <Checkbox
          checked={!!d.active}
          onChange={(e) => {
            const active = e.target.checked;
            setState({ details: { ...d, active } });
            callRpc(`mutatorSet-${d.id}`, {
              name: "active",
              value: active,
            });
          }}
        />
        <Input
          className="name-input"
          size="small"
          value={d.name}
          onChange={(e) => {
            const name = e.target.value;
            setState({
              details: { ...d, name },
            });
            callRpc(`mutatorSet-${d.id}`, { name: "name", value: name });
          }}
        />
      </div>

      {(d.rootAttrs || []).length > 0 && (
        <div className="root-attrs">
          {d.rootAttrs!.map((a: any) => (
            <AttrField key={a.name} attr={a} mutatorId={d.id} />
          ))}
        </div>
      )}

      {d.nodeAttrs && (
        <AttrPanel panelKey="node" title="Node">
          <NodeTransform id={d.id} nodeAttrs={d.nodeAttrs} />
        </AttrPanel>
      )}

      {(d.components || []).map((c) => (
        <ComponentPanel key={c.id} comp={c} />
      ))}
    </div>
  );
}
