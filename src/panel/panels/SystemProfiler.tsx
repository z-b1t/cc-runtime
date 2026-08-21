import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Select, Space } from "antd";
import {
  ClearOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { callRpc, Rpc } from "../bridge/rpc";
import {
  ECS_POLL_OPTIONS,
  MAX_ECS_SAMPLES,
  getEcsState,
  setEcsState,
  subscribeEcs,
  type EcsState,
} from "../ecsStore";
import { Sparkline } from "./Sparkline";

const COLORS = [
  "#4aa3ff",
  "#73d13d",
  "#ffa940",
  "#b37feb",
  "#ff85c0",
  "#36cfc9",
  "#ff7a45",
  "#9254de",
];

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

export function SystemProfiler() {
  const [snap, setSnap] = useState<EcsState>(getEcsState());
  useEffect(() => subscribeEcs(() => setSnap({ ...getEcsState() })), []);

  const { systemsRunning, systemSamples, pollMs, available } = snap;

  const toggle = useCallback(async () => {
    const next = !getEcsState().systemsRunning;
    setEcsState({ systemsRunning: next });
    const ok = await callRpc(next ? Rpc.ecsProfilerStart : Rpc.ecsProfilerStop);
    if (next && !ok) setEcsState({ systemsRunning: false });
  }, []);

  const clear = useCallback(() => setEcsState({ systemSamples: [] }), []);

  const onPoll = useCallback((value: number) => {
    setEcsState({ pollMs: value });
    void callRpc(Rpc.ecsSetInterval, value);
  }, []);

  const names = useMemo(() => {
    const last = systemSamples[systemSamples.length - 1];
    if (last?.systems?.length) return last.systems.map((s) => s.name);
    const seen: string[] = [];
    for (let i = 0; i < systemSamples.length; i++) {
      const list = systemSamples[i].systems || [];
      for (let j = 0; j < list.length; j++) {
        if (seen.indexOf(list[j].name) < 0) seen.push(list[j].name);
      }
    }
    return seen;
  }, [systemSamples]);

  const cards = useMemo(() => {
    return names.map((name, i) => {
      const data = systemSamples.map((s) => {
        const row = s.systems.find((x) => x.name === name);
        return row ? row.avgMs : 0;
      });
      const last = systemSamples[systemSamples.length - 1]?.systems.find(
        (x) => x.name === name,
      );
      const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
      const peak = last?.peakMs ?? (data.length ? Math.max(...data) : 0);
      return {
        name,
        color: COLORS[i % COLORS.length],
        data,
        current: data.length ? data[data.length - 1] : 0,
        avg,
        peak,
        entityCount: last?.entityCount,
      };
    });
  }, [names, systemSamples]);

  return (
    <div className="profiler-panel">
      <div className="profiler-toolbar">
        <Space size={4} wrap>
          <Button
            size="small"
            type={systemsRunning ? "default" : "primary"}
            icon={systemsRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={toggle}
            disabled={!available && !systemsRunning}
          >
            {systemsRunning ? "停止采集" : "开始采集"}
          </Button>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={clear}
            disabled={!systemSamples.length}
          >
            清空
          </Button>
          <Select
            size="small"
            value={pollMs}
            options={[...ECS_POLL_OPTIONS]}
            onChange={onPoll}
            style={{ width: 100 }}
          />
        </Space>
        <span className="profiler-hint">
          {systemsRunning
            ? `采样中 · ${systemSamples.length}/${MAX_ECS_SAMPLES}`
            : "已停止"}
        </span>
      </div>

      {!available && !systemSamples.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未检测到 ECS 世界"
        />
      ) : !systemSamples.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            systemsRunning ? "等待首个采样窗口..." : "点击「开始采集」查看各系统耗时"
          }
        />
      ) : (
        <div className="profiler-grid">
          {cards.map((card) => (
            <div className="profiler-card" key={card.name}>
              <div className="profiler-card-head">
                <span className="profiler-card-label">{card.name}</span>
                <span className="profiler-card-value" style={{ color: card.color }}>
                  {formatMs(card.current)}
                  <em>ms</em>
                </span>
              </div>
              <Sparkline
                data={card.data}
                capacity={MAX_ECS_SAMPLES}
                color={card.color}
                warnAbove={8}
              />
              <div className="profiler-card-foot">
                <span>平均 {formatMs(card.avg)}</span>
                <span>峰值 {formatMs(card.peak)}</span>
                {card.entityCount != null ? (
                  <span>实体 {card.entityCount}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
