import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Space } from "antd";
import {
  ClearOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import type { ProfilerSample } from "@shared/protocol";
import { callRpc, Rpc } from "../bridge/rpc";
import {
  getProfilerState,
  MAX_SAMPLES,
  setProfilerState,
  subscribeProfiler,
  type ProfilerState,
} from "../profilerStore";
import { Sparkline } from "./Sparkline";

type MetricUnit = "" | "ms" | "MB";

type Metric = {
  key: keyof ProfilerSample;
  label: string;
  unit: MetricUnit;
  color: string;
  warnBelow?: number;
  warnAbove?: number;
  /** Hidden when the runtime never reports it (e.g. non-Chromium JS heap). */
  optional?: boolean;
};

const METRICS: Metric[] = [
  { key: "fps", label: "FPS", unit: "", color: "#52c41a", warnBelow: 30 },
  { key: "frame", label: "帧耗时", unit: "ms", color: "#4aa3ff", warnAbove: 33 },
  { key: "logic", label: "逻辑", unit: "ms", color: "#73d13d" },
  { key: "physics", label: "物理", unit: "ms", color: "#b37feb" },
  { key: "render", label: "渲染", unit: "ms", color: "#ffa940" },
  { key: "present", label: "提交", unit: "ms", color: "#ff85c0" },
  { key: "draws", label: "Draw Call", unit: "", color: "#40a9ff" },
  { key: "instances", label: "Instances", unit: "", color: "#36cfc9" },
  { key: "tricount", label: "三角面", unit: "", color: "#9254de" },
  { key: "textureMemory", label: "纹理显存", unit: "MB", color: "#f759ab" },
  { key: "bufferMemory", label: "Buffer 显存", unit: "MB", color: "#ffc53d" },
  { key: "jsHeap", label: "JS 堆", unit: "MB", color: "#ff7a45", optional: true },
];

function format(value: number, unit: MetricUnit): string {
  if (!Number.isFinite(value)) return "-";
  if (unit === "ms") return value.toFixed(2);
  if (unit === "MB") return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

function seriesOf(samples: ProfilerSample[], key: keyof ProfilerSample): number[] {
  return samples.map((s) => {
    const v = s[key];
    return typeof v === "number" ? v : 0;
  });
}

function MetricCard({ metric, data }: { metric: Metric; data: number[] }) {
  const current = data.length ? data[data.length - 1] : 0;
  const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
  const peak = data.length ? Math.max(...data) : 0;

  return (
    <div className="profiler-card">
      <div className="profiler-card-head">
        <span className="profiler-card-label">{metric.label}</span>
        <span className="profiler-card-value" style={{ color: metric.color }}>
          {format(current, metric.unit)}
          {metric.unit && <em>{metric.unit}</em>}
        </span>
      </div>
      <Sparkline
        data={data}
        capacity={MAX_SAMPLES}
        color={metric.color}
        warnBelow={metric.warnBelow}
        warnAbove={metric.warnAbove}
      />
      <div className="profiler-card-foot">
        <span>平均 {format(avg, metric.unit)}</span>
        <span>峰值 {format(peak, metric.unit)}</span>
      </div>
    </div>
  );
}

export function Profiler() {
  const [snap, setSnap] = useState<ProfilerState>(getProfilerState());

  useEffect(() => subscribeProfiler(() => setSnap({ ...getProfilerState() })), []);

  const { running, samples } = snap;

  const toggle = useCallback(async () => {
    const next = !getProfilerState().running;
    setProfilerState({ running: next });
    const ok = await callRpc(next ? Rpc.profilerStart : Rpc.profilerStop);
    if (next && !ok) setProfilerState({ running: false });
  }, []);

  const clear = useCallback(() => setProfilerState({ samples: [] }), []);

  const hasJsHeap = samples.some((s) => typeof s.jsHeap === "number");

  const series = useMemo(() => {
    const visible = METRICS.filter(
      (m) => !m.optional || (m.key === "jsHeap" && hasJsHeap),
    );
    return visible.map((m) => ({ metric: m, data: seriesOf(samples, m.key) }));
  }, [samples, hasJsHeap]);

  const heapLimit = samples.length ? samples[samples.length - 1].jsHeapLimit : undefined;

  return (
    <div className="profiler-panel">
      <div className="profiler-toolbar">
        <Space size={4}>
          <Button
            size="small"
            type={running ? "default" : "primary"}
            icon={running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={toggle}
          >
            {running ? "停止采集" : "开始采集"}
          </Button>
          <Button size="small" icon={<ClearOutlined />} onClick={clear} disabled={!samples.length}>
            清空
          </Button>
        </Space>
        <span className="profiler-hint">
          {running ? `采样中 · ${samples.length}/${MAX_SAMPLES}` : "已停止"}
        </span>
      </div>

      {!samples.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={running ? "等待首个采样窗口..." : "点击「开始采集」查看实时性能"}
        />
      ) : (
        <div className="profiler-grid">
          {series.map(({ metric, data }) => (
            <MetricCard key={String(metric.key)} metric={metric} data={data} />
          ))}
        </div>
      )}

      {hasJsHeap && heapLimit ? (
        <div className="profiler-footnote">JS 堆上限 {heapLimit.toFixed(0)} MB</div>
      ) : null}
    </div>
  );
}
