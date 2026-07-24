import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { LayoutConfig, GoldenLayout } from "golden-layout";
import { Menu, message, Spin } from "antd";
import {
  AimOutlined,
  ReloadOutlined,
  BorderOuterOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { LAYOUT_STORAGE_KEY } from "@shared/protocol";
import { injectIntoPage, isInjected } from "./bridge/inject";
import {
  callRpc,
  Event,
  onEvent,
  Rpc,
  setInspectedTabId,
  waitForEvent,
} from "./bridge/rpc";
import { collectIds, findNode, getState, setState, subscribe } from "./store";
import { selectNodeInPanel } from "./selectNode";
import { NodeTree } from "./panels/NodeTree";
import { NodeDetails } from "./panels/NodeDetails";
import "golden-layout/dist/css/goldenlayout-base.css";
import "golden-layout/dist/css/themes/goldenlayout-dark-theme.css";
import "antd/dist/antd.dark.css";
import "./app.css";

const defaultLayout: LayoutConfig = {
  root: {
    type: "row",
    content: [
      {
        type: "component",
        componentType: "NodeTree",
        title: "节点树",
      },
      {
        type: "component",
        componentType: "NodeDetails",
        title: "节点详情",
      },
    ],
  },
};

function mountReact(
  container: { element: HTMLElement; on: (ev: string, cb: () => void) => void },
  element: React.ReactElement,
) {
  const el = container.element;
  el.classList.add("gl-react-host");
  ReactDOM.render(element, el);
  container.on("destroy", () => {
    ReactDOM.unmountComponentAtNode(el);
  });
}

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<GoldenLayout | null>(null);
  const [injecting, setInjecting] = useState(true);
  const [inspecting, setInspecting] = useState(false);

  useEffect(() => subscribe(() => {
    setInjecting(getState().injecting);
    setInspecting(getState().inspecting);
  }), []);

  const bootstrap = useCallback(async () => {
    const id = chrome.devtools.inspectedWindow.tabId;
    setInspectedTabId(id);
    setState({ injecting: true });
    message.loading({ content: "加载中，请稍等", key: "inj", duration: 0 });
    try {
      const already = await isInjected();
      if (!already) {
        const loaded = waitForEvent(Event.loadingComplete, 120000);
        await injectIntoPage();
        await loaded;
      }
      message.destroy("inj");
      setState({ injecting: false });
      await callRpc(Rpc.refreshSceneData);
      const assets = await callRpc(Rpc.assetsGetAll);
      setState({ assets: (assets as any) || {} });
    } catch (e) {
      console.error(e);
      message.destroy("inj");
      message.error("注入失败或超时：请确认页面已加载 Cocos Creator (window.cc)");
      setState({ injecting: false });
    }
  }, []);

  useEffect(() => {
    onEvent(Event.sceneData, (data) => {
      const scene = data as any;
      setState({
        scene,
        expandedKeys: getState().expandedKeys.length
          ? getState().expandedKeys
          : collectIds(scene).slice(0, 50),
      });
    });
    onEvent(Event.selectNode, async (uuid) => {
      await callRpc(Rpc.refreshSceneData);
      const scene = getState().scene;
      const match = findByUuid(scene, String(uuid));
      if (match) {
        await selectNodeInPanel(match.id);
      }
    });
    onEvent(Event.updateTransform, (payload: any) => {
      const d = getState().details;
      if (!d || d.id !== payload.id || !d.nodeAttrs) return;
      setState({
        details: {
          ...d,
          nodeAttrs: {
            ...d.nodeAttrs,
            position: { ...payload.position },
            eulerAngles: { ...payload.eulerAngles },
            scale: { ...payload.scale },
          },
        },
      });
    });
    onEvent(Event.updateLayer, (payload: any) => {
      const d = getState().details;
      if (!d || d.id !== payload.id || !d.nodeAttrs) return;
      setState({
        details: {
          ...d,
          nodeAttrs: { ...d.nodeAttrs, layer: payload.layer },
        },
      });
    });
    onEvent(Event.syncCompProp, (payload: any) => {
      const d = getState().details;
      if (!d?.components || payload?.key !== "enabled") return;
      const next = d.components.map((c: any) =>
        c.id === payload.id ? { ...c, enabled: payload.value } : c,
      );
      if (next === d.components) return;
      setState({ details: { ...d, components: next } });
    });
    onEvent(Event.syncNodeProp, (payload: any) => {
      if (payload?.key !== "active") return;
      const d = getState().details;
      if (d && d.id === payload.id) {
        setState({ details: { ...d, active: payload.value } });
      }
      const scene = getState().scene;
      const node = findNode(scene, String(payload.id));
      if (node) {
        node.active = !!payload.value;
        setState({ scene: { ...scene! } });
      }
    });
    onEvent(Event.assetsAdd, ({ key, val }: any) => {
      setState({ assets: { ...getState().assets, [key]: val } });
    });
    onEvent(Event.assetsRemove, ({ key }: any) => {
      const next = { ...getState().assets };
      delete next[key];
      setState({ assets: next });
    });
    onEvent(Event.assetsClear, () => setState({ assets: {} }));
    onEvent("tabReloaded", () => {
      message.loading({ content: "页面正在刷新，请稍等...", key: "inj", duration: 0 });
      setState({ injecting: true, scene: null, details: null, selectedId: null, flashNodeId: null });
      bootstrap();
    });

    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || layoutRef.current) return;

    const layout = new GoldenLayout(host);
    layoutRef.current = layout;

    layout.registerComponentFactoryFunction("NodeTree", (container) => {
      mountReact(container, <NodeTree />);
    });
    layout.registerComponentFactoryFunction("NodeDetails", (container) => {
      mountReact(container, <NodeDetails />);
    });

    let config = defaultLayout;
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (raw) config = JSON.parse(raw);
    } catch {
      /* ignore */
    }

    // Container must be visible with real size before loadLayout.
    const start = () => {
      try {
        layout.loadLayout(config);
      } catch (err) {
        console.warn("[cc-runtime] loadLayout failed, using default", err);
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
        layout.loadLayout(defaultLayout);
      }
      layout.setSize(host.clientWidth, host.clientHeight);
    };

    requestAnimationFrame(start);

    const onResize = () => {
      if (host.clientWidth && host.clientHeight) {
        layout.setSize(host.clientWidth, host.clientHeight);
      }
    };
    window.addEventListener("resize", onResize);

    layout.on("stateChanged", () => {
      try {
        localStorage.setItem(
          LAYOUT_STORAGE_KEY,
          JSON.stringify(layout.saveLayout()),
        );
      } catch {
        /* ignore */
      }
    });

    return () => {
      window.removeEventListener("resize", onResize);
      layout.destroy();
      layoutRef.current = null;
    };
  }, []);

  const onMenu = async ({ key }: { key: string }) => {
    if (key === "inspect") {
      if (inspecting) {
        await callRpc(Rpc.stopInspectNode);
        setState({ inspecting: false });
      } else {
        setState({ inspecting: true });
        try {
          await callRpc(Rpc.startInspectNode);
        } finally {
          setState({ inspecting: false });
        }
      }
    } else if (key === "refresh") {
      await callRpc(Rpc.refreshSceneData);
      message.success("刷新成功");
    } else if (key === "reset") {
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
      message.info("布局已重置");
      if (layoutRef.current && hostRef.current) {
        layoutRef.current.loadLayout(defaultLayout);
        layoutRef.current.setSize(
          hostRef.current.clientWidth,
          hostRef.current.clientHeight,
        );
      }
    }
  };

  return (
    <div className="cc-runtime-app">
      <Menu
        mode="horizontal"
        theme="dark"
        selectable={false}
        onClick={onMenu}
        items={[
          {
            key: "inspect",
            icon: inspecting ? <StopOutlined /> : <AimOutlined />,
            label: inspecting ? "取消侦测" : "侦测节点",
          },
          {
            key: "refresh",
            icon: <ReloadOutlined />,
            label: "刷新场景",
          },
          {
            key: "reset",
            icon: <BorderOuterOutlined />,
            label: "重置布局",
          },
        ]}
      />
      <div className="layout-host" ref={hostRef} />
      {injecting && (
        <div className="inject-mask">
          <Spin tip="页面正在刷新，请稍等..." />
        </div>
      )}
      <div className="footer">
        <a href="mailto:initial_r@qq.com">联系我: initial_r@qq.com</a>
      </div>
    </div>
  );
}

function findByUuid(node: any, uuid: string): any {
  if (!node) return null;
  if (node._id === uuid || node.id === uuid) return node;
  for (const c of node.children || []) {
    const f = findByUuid(c, uuid);
    if (f) return f;
  }
  return null;
}
