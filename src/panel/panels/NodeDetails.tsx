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
import { ExportOutlined } from "@ant-design/icons";
import { callRpc, Rpc } from "../bridge/rpc";
import { getState, setState, subscribe, type AppState } from "../store";
import { NEW_KEY, VISITOR_KEY } from "@shared/protocol";
import { cleanFloat, formatFloatDisplay } from "@shared/number";

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

/** Decode Cocos Color._val (ABGR packed uint32) → #rrggbb */
function colorToHex(val: any): string {
  if (val == null) return "#ffffff";
  if (typeof val === "number") {
    const abgr = val >>> 0;
    const r = abgr & 0xff;
    const g = (abgr >>> 8) & 0xff;
    const b = (abgr >>> 16) & 0xff;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  if (typeof val === "object") {
    if (typeof val._val === "number") return colorToHex(val._val);
    if (typeof val.r === "number") {
      const r = Math.round(val.r) & 0xff;
      const g = Math.round(val.g) & 0xff;
      const b = Math.round(val.b) & 0xff;
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#ffffff";
}

function colorAlpha(val: any): number {
  if (val && typeof val === "object") {
    if (typeof val.a === "number") return Math.round(val.a) & 0xff;
    if (typeof val._val === "number") return (val._val >>> 24) & 0xff;
  }
  if (typeof val === "number") return (val >>> 24) & 0xff;
  return 255;
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
      const hex = colorToHex(val);
      const alpha = colorAlpha(val);
      return (
        <AttrLine title={title} tooltip={tip}>
          <label className="attr-color-picker">
            <span
              className="attr-color-swatch"
              style={{ background: hex }}
            />
            <input
              type="color"
              value={hex}
              onChange={async (e) => {
                const h = e.target.value.replace("#", "");
                const r = parseInt(h.slice(0, 2), 16) || 0;
                const g = parseInt(h.slice(2, 4), 16) || 0;
                const b = parseInt(h.slice(4, 6), 16) || 0;
                const a = alpha;
                const packed =
                  ((a & 0xff) << 24) |
                  ((b & 0xff) << 16) |
                  ((g & 0xff) << 8) |
                  (r & 0xff);
                setVal({ _val: packed >>> 0, r, g, b, a });
                await callRpc(`mutatorSet-${mutatorId}`, {
                  name: attr.name,
                  value: {
                    [NEW_KEY]: { cls: "cc.Color", args: [r, g, b, a] },
                  },
                });
                await refreshNodeDetails();
              }}
            />
          </label>
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
    case "object":
      return (
        <AttrLine title={title} tooltip={tip}>
          <div
            className={`attr-comp-input${val?.[VISITOR_KEY] ? " filled" : ""}`}
          >
            <span className="type-tag">
              <span className="text">{attr.typeName || "Object"}</span>
            </span>
            <span className="input">
              {val?.[VISITOR_KEY] ? String(val[VISITOR_KEY]).slice(0, 8) : "None"}
            </span>
          </div>
        </AttrLine>
      );
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

function LabelInspector({ data, id }: { data: any; id: string }) {
  return (
    <div className="label-panel">
      <AttrLine title="String">
        <Input
          className="attr-input"
          size="small"
          defaultValue={data.string}
          onBlur={(e) =>
            callRpc(`mutatorSet-${id}`, { name: "string", value: e.target.value })
          }
        />
      </AttrLine>
      <AttrLine title="FontSize">
        <InputNumber
          className="attr-input-number"
          size="small"
          defaultValue={data.fontSize}
          onChange={(n) =>
            callRpc(`mutatorSet-${id}`, { name: "fontSize", value: Number(n) })
          }
        />
      </AttrLine>
      <AttrLine title="UseSystemFont">
        <Checkbox
          defaultChecked={data.useSystemFont}
          onChange={(e) =>
            callRpc(`mutatorSet-${id}`, {
              name: "useSystemFont",
              value: e.target.checked,
            })
          }
        />
      </AttrLine>
      <AttrLine title="FontStyle">
        <div className="attr-inline-checks">
          <Checkbox
            defaultChecked={data.fontStyle?.isBold}
            onChange={(e) =>
              callRpc(`mutatorSet-${id}`, {
                name: "isBold",
                value: e.target.checked,
              })
            }
          >
            B
          </Checkbox>
          <Checkbox
            defaultChecked={data.fontStyle?.isItalic}
            onChange={(e) =>
              callRpc(`mutatorSet-${id}`, {
                name: "isItalic",
                value: e.target.checked,
              })
            }
          >
            I
          </Checkbox>
          <Checkbox
            defaultChecked={data.fontStyle?.isUnderline}
            onChange={(e) =>
              callRpc(`mutatorSet-${id}`, {
                name: "isUnderline",
                value: e.target.checked,
              })
            }
          >
            U
          </Checkbox>
        </div>
      </AttrLine>
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
      onActiveChange={(v) =>
        callRpc(`mutatorSet-${comp.id}`, { name: "enabled", value: v })
      }
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
          onChange={(e) =>
            callRpc(`mutatorSet-${d.id}`, {
              name: "active",
              value: e.target.checked,
            })
          }
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
