import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
  LayoutConfig,
  GoldenLayout,
  ContentItem,
  type ComponentContainer,
  type ComponentItem,
} from "golden-layout";
import { Menu, message, Spin } from "antd";
import {
  AimOutlined,
  ReloadOutlined,
  BorderOuterOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  EMPTY_NODE_DRAW_CALLS,
  LAYOUT_STORAGE_KEY,
  Msg,
  type InspectStartResult,
} from "@shared/protocol";
import { injectIntoPage, isInjected } from "./bridge/inject";
import { bindSidePanelPort, connectSidePanelPort } from "./bridge/panelPort";
import {
  callRpc,
  Event,
  getInspectedTabId,
  onEvent,
  Rpc,
  setInspectedTabId,
  waitForEvent,
} from "./bridge/rpc";
import { collectIds, findNode, getState, setState, subscribe } from "./store";
import { pushSample, resetProfiler } from "./profilerStore";
import {
  locateNodeInTree,
  previewNodeInTree,
  selectNodeInPanel,
} from "./selectNode";
import { NodeTree } from "./panels/NodeTree";
import { NodeDetails } from "./panels/NodeDetails";
import { Profiler } from "./panels/Profiler";
import "golden-layout/dist/css/goldenlayout-base.css";
import "golden-layout/dist/css/themes/goldenlayout-dark-theme.css";
import "antd/dist/antd.dark.css";
import "./app.css";

const PANELS = [
  { key: "win-NodeTree", type: "NodeTree", title: "节点树" },
  { key: "win-NodeDetails", type: "NodeDetails", title: "节点详情" },
  { key: "win-Profiler", type: "Profiler", title: "性能" },
] as const;

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
        type: "stack",
        content: [
          {
            type: "component",
            componentType: "NodeDetails",
            title: "节点详情",
          },
          {
            type: "component",
            componentType: "Profiler",
            title: "性能",
          },
        ],
      },
    ],
  },
};

function mountReact(container: ComponentContainer, element: React.ReactElement) {
  const el = container.element;
  el.classList.add("gl-react-host");
  ReactDOM.render(element, el);
  container.on("destroy", () => {
    ReactDOM.unmountComponentAtNode(el);
  });
}

function findComponentByType(
  layout: GoldenLayout,
  type: string,
): ComponentItem | undefined {
  const root = layout.rootItem;
  if (!root) return undefined;
  const stack: ContentItem[] = [root];
  while (stack.length) {
    const item = stack.pop()!;
    if (ContentItem.isComponentItem(item) && item.componentType === type) {
      return item;
    }
    stack.push(...item.contentItems);
  }
  return undefined;
}

function openOrFocusPanel(layout: GoldenLayout, type: string, title: string) {
  const existing = findComponentByType(layout, type);
  if (existing) {
    const parent = existing.parent;
    if (parent && ContentItem.isStack(parent)) {
      parent.setActiveComponentItem(existing, true);
    } else {
      layout.focusComponent(existing);
    }
    return;
  }
  layout.addComponent(type, undefined, title);
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
    let id = getInspectedTabId();
    if (id == null) {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tab?.id == null) {
        message.error("无法获取当前标签页");
        setState({ injecting: false });
        return;
      }
      id = tab.id;
      setInspectedTabId(id);
    }
    bindSidePanelPort(id);
    chrome.runtime.sendMessage(
      { type: Msg.sidePanelOpened, tabId: id },
      () => {
        void chrome.runtime.lastError;
      },
    );
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
      const { scene: prevScene, expandedKeys } = getState();
      setState({
        scene,
        // First load only: seed default expands. Keep [] after "collapse all".
        expandedKeys: prevScene
          ? expandedKeys
          : collectIds(scene).slice(0, 50),
      });
    });
    onEvent(Event.inspectHover, (payload: any) => {
      previewNodeInTree(payload?.id ? String(payload.id) : null);
    });
    onEvent(Event.inspectPick, async (payload: any) => {
      const id = String(payload?.id || "");
      if (!id) return;
      // Make the tree visible and show the full hierarchy for this pick.
      if (layoutRef.current) {
        openOrFocusPanel(layoutRef.current, "NodeTree", "节点树");
      }
      const { search, compTypeFilter } = getState();
      if (search || compTypeFilter.length) {
        setState({ search: "", compTypeFilter: [] });
      }
      if (!findNode(getState().scene, id)) {
        // Picked a node the last scene push did not include yet.
        await callRpc(Rpc.refreshSceneData);
        if (!(await waitForNodeInScene(id))) {
          message.warning("节点不在当前场景树中");
          return;
        }
      }
      await selectNodeInPanel(id);
      locateNodeInTree(id, { flash: true });
    });
    onEvent(Event.inspectEnd, () => {
      setState({ inspecting: false, hoverNodeId: null });
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
    onEvent(Event.profilerSample, (sample: any) => pushSample(sample));
    onEvent(Event.nodeDrawCalls, (dc: any) =>
      setState({ nodeDc: dc || EMPTY_NODE_DRAW_CALLS }),
    );
    onEvent("tabReloaded", (data: any) => {
      const inspected = getInspectedTabId();
      if (inspected == null) return;
      if (data?.tabId != null && data.tabId !== inspected) return;
      message.loading({ content: "页面正在刷新，请稍等...", key: "inj", duration: 0 });
      // The injected collector is gone with the old page.
      resetProfiler();
      setState({
        injecting: true,
        // The injected pick session died with the old page.
        inspecting: false,
        scene: null,
        details: null,
        selectedId: null,
        flashNodeId: null,
        hoverNodeId: null,
        nodeDc: EMPTY_NODE_DRAW_CALLS,
      });
      bootstrap();
    });

    bootstrap();
  }, [bootstrap]);

  // Tell background when this tab's side panel closes so it disables the
  // tab-scoped panel and the page launcher can restore its edge position.
  // Port disconnect (below) is the reliable close signal; pagehide is backup.
  useEffect(() => {
    connectSidePanelPort();
    const notifyClosed = () => {
      const id = getInspectedTabId();
      if (id == null) return;
      chrome.runtime.sendMessage(
        { type: Msg.sidePanelClosed, tabId: id },
        () => {
          void chrome.runtime.lastError;
        },
      );
    };
    window.addEventListener("pagehide", notifyClosed);
    return () => {
      window.removeEventListener("pagehide", notifyClosed);
      notifyClosed();
    };
  }, []);

  // ESC has to work from the panel too: while the pointer is over the panel,
  // the page never sees the keystroke.
  useEffect(() => {
    if (!inspecting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      void stopInspect();
    };
    // Closing the side panel mid-pick would otherwise leave the page swallowing input.
    const onPageHide = () => {
      void callRpc(Rpc.inspectStop);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [inspecting]);

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
    layout.registerComponentFactoryFunction("Profiler", (container) => {
      mountReact(container, <Profiler />);
    });

    let config = defaultLayout;
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // saveLayout() returns ResolvedLayoutConfig (numeric sizes); loadLayout needs LayoutConfig.
        config = LayoutConfig.isResolved(parsed)
          ? LayoutConfig.fromResolved(parsed)
          : (parsed as LayoutConfig);
      }
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
        await stopInspect();
      } else {
        setState({ inspecting: true });
        try {
          const res = (await callRpc(Rpc.inspectStart)) as InspectStartResult | null;
          if (!res?.ok) {
            setState({ inspecting: false });
            message.error(res?.reason || "开启侦测失败");
          }
        } catch (err) {
          console.error(err);
          setState({ inspecting: false });
          message.error("开启侦测失败");
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
    } else {
      const panel = PANELS.find((p) => p.key === key);
      if (panel && layoutRef.current) {
        openOrFocusPanel(layoutRef.current, panel.type, panel.title);
      }
    }
  };

  return (
    <div className="cc-runtime-app">
      <Menu mode="horizontal" theme="dark" selectable={false} onClick={onMenu}>
        <Menu.Item
          key="inspect"
          icon={inspecting ? <StopOutlined /> : <AimOutlined />}
        >
          {inspecting ? "取消侦测" : "侦测节点"}
        </Menu.Item>
        <Menu.Item key="refresh" icon={<ReloadOutlined />}>
          刷新场景
        </Menu.Item>
        <Menu.SubMenu key="window" title="窗口" popupClassName="cc-menubar-popup">
          {PANELS.map((p) => (
            <Menu.Item key={p.key}>{p.title}</Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item key="reset" icon={<BorderOuterOutlined />}>
            重置布局
          </Menu.Item>
        </Menu.SubMenu>
      </Menu>
      <div className="layout-host" ref={hostRef} />
      {injecting && (
        <div className="inject-mask">
          <Spin tip="页面正在刷新，请稍等..." />
        </div>
      )}
      <div className="footer">
        {/* <a href="mailto:qq493843456@163.com">联系我: qq493843456@163.com</a> */}
      </div>
    </div>
  );
}

/** Resolve once a scene push contains `id`; false if none does in time. */
function waitForNodeInScene(id: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    if (findNode(getState().scene, id)) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, timeoutMs);
    const unsub = subscribe(() => {
      if (!findNode(getState().scene, id)) return;
      clearTimeout(timer);
      unsub();
      resolve(true);
    });
  });
}

async function stopInspect() {
  setState({ inspecting: false, hoverNodeId: null });
  try {
    await callRpc(Rpc.inspectStop);
  } catch (err) {
    console.error(err);
  }
}
