import React, { useCallback, useEffect, useRef, useState } from "react";
import { Input, InputNumber, Popover, Slider } from "antd";

export type Rgba = { r: number; g: number; b: number; a: number };

export function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n))) & 0xff;
}

export function parseColor(val: any): Rgba {
  if (val == null) return { r: 255, g: 255, b: 255, a: 255 };
  if (typeof val === "number") {
    const abgr = val >>> 0;
    return {
      r: abgr & 0xff,
      g: (abgr >>> 8) & 0xff,
      b: (abgr >>> 16) & 0xff,
      a: (abgr >>> 24) & 0xff,
    };
  }
  if (typeof val === "object") {
    if (typeof val._val === "number") return parseColor(val._val);
    return {
      r: clampByte(Number(val.r) || 0),
      g: clampByte(Number(val.g) || 0),
      b: clampByte(Number(val.b) || 0),
      a: clampByte(val.a == null ? 255 : Number(val.a)),
    };
  }
  return { r: 255, g: 255, b: 255, a: 255 };
}

export function packAbgr(c: Rgba) {
  return (
    (((c.a & 0xff) << 24) |
      ((c.b & 0xff) << 16) |
      ((c.g & 0xff) << 8) |
      (c.r & 0xff)) >>>
    0
  );
}

export function toHex6(c: Rgba) {
  return [c.r, c.g, c.b]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

export function toHex8(c: Rgba) {
  return `#${toHex6(c)}${c.a.toString(16).padStart(2, "0")}`;
}

export function parseHexColor(raw: string): Rgba | null {
  let s = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) s += "ff";
  if (!/^[0-9a-fA-F]{8}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
    a: parseInt(s.slice(6, 8), 16),
  };
}

type Hsv = { h: number; s: number; v: number };

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): Omit<Rgba, "a"> {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return {
    r: clampByte((rp + m) * 255),
    g: clampByte((gp + m) * 255),
    b: clampByte((bp + m) * 255),
  };
}

function useDrag(
  onMove: (clientX: number, clientY: number) => void,
  onEnd?: () => void,
) {
  const moveRef = useRef(onMove);
  const endRef = useRef(onEnd);
  moveRef.current = onMove;
  endRef.current = onEnd;

  return useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = (ev: MouseEvent | TouchEvent) => {
      const pt =
        "touches" in ev
          ? ev.touches[0] || ev.changedTouches[0]
          : (ev as MouseEvent);
      if (pt) moveRef.current(pt.clientX, pt.clientY);
    };
    const stop = () => {
      window.removeEventListener("mousemove", handle);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", handle);
      window.removeEventListener("touchend", stop);
      endRef.current?.();
    };
    handle(e.nativeEvent as any);
    window.addEventListener("mousemove", handle);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", handle, { passive: false });
    window.addEventListener("touchend", stop);
  }, []);
}

/** Cocos Creator–style color panel. */
export function ColorPickerPanel({
  value,
  onChange,
  onCommit,
}: {
  value: Rgba;
  onChange: (c: Rgba) => void;
  onCommit: (c: Rgba) => void;
}) {
  const [hsv, setHsv] = useState(() => rgbToHsv(value.r, value.g, value.b));
  const [origin] = useState(value);
  const [hexField, setHexField] = useState(toHex8(value));
  const [hexShort, setHexShort] = useState(toHex6(value).toUpperCase());

  const hsvRef = useRef(hsv);
  const draftRef = useRef(value);
  const commitRef = useRef(onCommit);
  hsvRef.current = hsv;
  draftRef.current = value;
  commitRef.current = onCommit;

  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = rgbToHsv(value.r, value.g, value.b);
    setHsv((prev) =>
      next.s === 0 ? { h: prev.h, s: next.s, v: next.v } : next,
    );
    setHexField(toHex8(value));
    setHexShort(toHex6(value).toUpperCase());
    draftRef.current = value;
  }, [value.r, value.g, value.b, value.a]);

  const hueRgb = hsvToRgb(hsv.h, 1, 1);

  useEffect(() => {
    const canvas = svRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const pure = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
    const gradX = ctx.createLinearGradient(0, 0, w, 0);
    gradX.addColorStop(0, "#fff");
    gradX.addColorStop(1, pure);
    ctx.fillStyle = gradX;
    ctx.fillRect(0, 0, w, h);
    const gradY = ctx.createLinearGradient(0, 0, 0, h);
    gradY.addColorStop(0, "rgba(0,0,0,0)");
    gradY.addColorStop(1, "#000");
    ctx.fillStyle = gradY;
    ctx.fillRect(0, 0, w, h);
  }, [hueRgb.r, hueRgb.g, hueRgb.b]);

  const push = (c: Rgba, commit: boolean) => {
    draftRef.current = c;
    onChange(c);
    if (commit) onCommit(c);
  };

  const fromHsv = (next: Hsv, a: number, commit: boolean) => {
    hsvRef.current = next;
    setHsv(next);
    const rgb = hsvToRgb(next.h, next.s, next.v);
    const c = { ...rgb, a: clampByte(a) };
    setHexField(toHex8(c));
    setHexShort(toHex6(c).toUpperCase());
    push(c, commit);
  };

  const fromRgb = (c: Rgba, commit: boolean) => {
    const next = rgbToHsv(c.r, c.g, c.b);
    const hsvNext =
      next.s === 0
        ? { h: hsvRef.current.h, s: next.s, v: next.v }
        : next;
    hsvRef.current = hsvNext;
    setHsv(hsvNext);
    setHexField(toHex8(c));
    setHexShort(toHex6(c).toUpperCase());
    push(c, commit);
  };

  const finishDrag = () => commitRef.current(draftRef.current);

  const onSvDrag = useDrag((cx, cy) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height));
    fromHsv({ h: hsvRef.current.h, s, v }, draftRef.current.a, false);
  }, finishDrag);

  const onHueDrag = useDrag((_cx, cy) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (cy - rect.top) / rect.height));
    const cur = hsvRef.current;
    fromHsv({ h: t * 360, s: cur.s, v: cur.v }, draftRef.current.a, false);
  }, finishDrag);

  const onAlphaDrag = useDrag((_cx, cy) => {
    const el = alphaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (cy - rect.top) / rect.height));
    fromRgb({ ...draftRef.current, a: clampByte((1 - t) * 255) }, false);
  }, finishDrag);

  const channel = (key: keyof Rgba, labelClass: string) => (
    <div className="ccp-channel" key={key}>
      <span className={`ccp-channel-badge ${labelClass}`}>
        {key.toUpperCase()}
      </span>
      <Slider
        className="ccp-channel-slider"
        min={0}
        max={255}
        value={value[key]}
        onChange={(n) =>
          fromRgb({ ...draftRef.current, [key]: clampByte(Number(n)) }, false)
        }
        onAfterChange={(n) =>
          fromRgb({ ...draftRef.current, [key]: clampByte(Number(n)) }, true)
        }
      />
      <InputNumber
        className="ccp-channel-num"
        size="small"
        min={0}
        max={255}
        value={value[key]}
        onChange={(n) =>
          fromRgb(
            { ...draftRef.current, [key]: clampByte(Number(n) || 0) },
            true,
          )
        }
      />
    </div>
  );

  const rgbaCss = `rgba(${value.r},${value.g},${value.b},${value.a / 255})`;
  const originCss = `rgba(${origin.r},${origin.g},${origin.b},${origin.a / 255})`;

  return (
    <div className="ccp">
      <div className="ccp-preview-row">
        <div className="ccp-preview-swatch-checker">
          <div className="ccp-preview-swatch" style={{ background: rgbaCss }} />
        </div>
        <Input
          className="ccp-hex-short"
          size="small"
          value={hexShort}
          onChange={(e) =>
            setHexShort(
              e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 8),
            )
          }
          onBlur={() => {
            const c = parseHexColor(hexShort);
            if (c) fromRgb(c, true);
            else setHexShort(toHex6(value).toUpperCase());
          }}
          onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
        />
      </div>

      <div className="ccp-pick-row">
        <div
          className="ccp-hue"
          ref={hueRef}
          onMouseDown={onHueDrag}
          onTouchStart={onHueDrag}
        >
          <span
            className="ccp-hue-pointer"
            style={{ top: `${(hsv.h / 360) * 100}%` }}
          />
        </div>

        <div className="ccp-sv-wrap">
          <canvas
            ref={svRef}
            className="ccp-sv"
            width={180}
            height={140}
            onMouseDown={onSvDrag}
            onTouchStart={onSvDrag}
          />
          <span
            className="ccp-sv-cursor"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
            }}
          />
        </div>

        <div
          className="ccp-alpha"
          ref={alphaRef}
          onMouseDown={onAlphaDrag}
          onTouchStart={onAlphaDrag}
        >
          <div
            className="ccp-alpha-fill"
            style={{
              background: `linear-gradient(to bottom, rgb(${value.r},${value.g},${value.b}), transparent)`,
            }}
          />
          <span
            className="ccp-alpha-pointer"
            style={{ top: `${(1 - value.a / 255) * 100}%` }}
          />
        </div>
      </div>

      <div className="ccp-channels">
        {channel("r", "is-r")}
        {channel("g", "is-g")}
        {channel("b", "is-b")}
        {channel("a", "is-a")}
      </div>

      <div className="ccp-footer">
        <div className="ccp-compare">
          <span className="ccp-compare-checker">
            <span style={{ background: originCss }} />
          </span>
          <span className="ccp-compare-checker">
            <span style={{ background: rgbaCss }} />
          </span>
        </div>
        <span className="ccp-hex-label">Hex Color</span>
        <Input
          className="ccp-hex-full"
          size="small"
          value={hexField}
          onChange={(e) => setHexField(e.target.value)}
          onBlur={() => {
            const c = parseHexColor(hexField);
            if (c) fromRgb(c, true);
            else setHexField(toHex8(value));
          }}
          onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            const c = parseHexColor(text);
            if (c) {
              e.preventDefault();
              fromRgb(c, true);
            }
          }}
        />
      </div>
    </div>
  );
}

/** Inspector color field: swatch trigger + Cocos-style popover panel. */
export function ColorAttrField({
  value,
  onCommit,
}: {
  value: any;
  onCommit: (c: Rgba) => void | Promise<void>;
}) {
  const parsed = parseColor(value);
  const [local, setLocal] = useState<Rgba>(parsed);
  const [hexText, setHexText] = useState(
    `#${toHex6(parsed).toUpperCase()}`,
  );
  useEffect(() => {
    const next = parseColor(value);
    setLocal(next);
    setHexText(`#${toHex6(next).toUpperCase()}`);
  }, [value]);

  const commitColor = (c: Rgba) => {
    setLocal(c);
    setHexText(`#${toHex6(c).toUpperCase()}`);
    onCommit(c);
  };

  const applyHexText = (raw: string) => {
    const c = parseHexColor(raw);
    if (c) commitColor(c);
    else setHexText(`#${toHex6(local).toUpperCase()}`);
  };

  const rgbaCss = `rgba(${local.r},${local.g},${local.b},${local.a / 255})`;

  return (
    <div className="attr-color-trigger">
      <Popover
        content={
          <ColorPickerPanel
            value={local}
            onChange={(c) => {
              setLocal(c);
              setHexText(`#${toHex6(c).toUpperCase()}`);
            }}
            onCommit={commitColor}
          />
        }
        trigger="click"
        placement="bottomLeft"
        overlayClassName="attr-color-popover"
        destroyTooltipOnHide
      >
        <span className="attr-color-swatch-checker" title="打开颜色面板">
          <span className="attr-color-swatch" style={{ background: rgbaCss }} />
        </span>
      </Popover>
      <Input
        className="attr-color-hex-inline"
        size="small"
        value={hexText}
        onChange={(e) => setHexText(e.target.value)}
        onBlur={() => applyHexText(hexText)}
        onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          const c = parseHexColor(text);
          if (c) {
            e.preventDefault();
            commitColor(c);
          }
        }}
      />
    </div>
  );
}
