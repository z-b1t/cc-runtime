import React, { useEffect, useRef } from "react";

const NORMAL_COLOR = "#4aa3ff";
const WARN_COLOR = "#ff4d4f";

type SparklineProps = {
  data: number[];
  /** Slots on the x axis; the newest sample always sits at the right edge. */
  capacity: number;
  height?: number;
  color?: string;
  /** Fixed upper bound. Omitted means auto-scale to the data. */
  max?: number;
  /** Latest value under this turns the line red. */
  warnBelow?: number;
  /** Latest value over this turns the line red. */
  warnAbove?: number;
};

export function Sparkline({
  data,
  capacity,
  height = 44,
  color = NORMAL_COLOR,
  max,
  warnBelow,
  warnAbove,
}: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      const width = canvas.clientWidth;
      if (!ctx || !width) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
      ctx.fillRect(0, 0, width, height);

      if (data.length < 2) return;

      const peak = max ?? Math.max(...data);
      const top = peak > 0 ? peak * 1.15 : 1;
      const latest = data[data.length - 1];
      const warned =
        (warnBelow != null && latest < warnBelow) ||
        (warnAbove != null && latest > warnAbove);
      const stroke = warned ? WARN_COLOR : color;

      const slots = Math.max(capacity - 1, 1);
      const offset = capacity - data.length;
      const pointX = (i: number) => ((offset + i) / slots) * width;
      const pointY = (v: number) => height - (v / top) * (height - 4) - 2;

      ctx.beginPath();
      data.forEach((v, i) => {
        const x = pointX(i);
        const y = pointY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      const area = ctx.createLinearGradient(0, 0, 0, height);
      area.addColorStop(0, `${stroke}55`);
      area.addColorStop(1, `${stroke}00`);
      ctx.save();
      ctx.lineTo(pointX(data.length - 1), height);
      ctx.lineTo(pointX(0), height);
      ctx.closePath();
      ctx.fillStyle = area;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      data.forEach((v, i) => {
        const x = pointX(i);
        const y = pointY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
    };

    draw();

    // Golden Layout resizes panels without a window resize event.
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [data, capacity, height, color, max, warnBelow, warnAbove]);

  return (
    <canvas
      ref={canvasRef}
      className="sparkline"
      style={{ height, width: "100%", display: "block" }}
    />
  );
}
