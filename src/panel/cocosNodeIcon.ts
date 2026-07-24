import type { SceneNodeData } from "@shared/protocol";

import defaultIcon from "../assets/cocos-icons/default.png";
import spriteIcon from "../assets/cocos-icons/sprite.png";
import labelIcon from "../assets/cocos-icons/label.png";
import canvasIcon from "../assets/cocos-icons/canvas.png";
import buttonIcon from "../assets/cocos-icons/button.png";
import editboxIcon from "../assets/cocos-icons/editbox.png";
import layoutIcon from "../assets/cocos-icons/layout.png";
import scrollviewIcon from "../assets/cocos-icons/scrollview.png";
import progressbarIcon from "../assets/cocos-icons/progressbar.png";
import toggleIcon from "../assets/cocos-icons/toggle.png";
import particlesystemIcon from "../assets/cocos-icons/particlesystem.png";
import richtextIcon from "../assets/cocos-icons/richtext.png";
import webviewIcon from "../assets/cocos-icons/webview.png";
import videoplayerIcon from "../assets/cocos-icons/videoplayer.png";
import pageviewIcon from "../assets/cocos-icons/pageview.png";
import sliderIcon from "../assets/cocos-icons/slider.png";
import togglegroupIcon from "../assets/cocos-icons/togglegroup.png";
import tiledmapIcon from "../assets/cocos-icons/tiledmap.png";
import atlaslabelIcon from "../assets/cocos-icons/atlaslabel.png";

/** Higher priority first — first match wins. */
const ICON_BY_TYPE: Array<{ type: string; src: string }> = [
  { type: "canvas", src: canvasIcon },
  { type: "tiledmap", src: tiledmapIcon },
  { type: "particlesystem", src: particlesystemIcon },
  { type: "videoplayer", src: videoplayerIcon },
  { type: "webview", src: webviewIcon },
  { type: "pageview", src: pageviewIcon },
  { type: "scrollview", src: scrollviewIcon },
  { type: "progressbar", src: progressbarIcon },
  { type: "togglegroup", src: togglegroupIcon },
  { type: "toggle", src: toggleIcon },
  { type: "slider", src: sliderIcon },
  { type: "button", src: buttonIcon },
  { type: "editbox", src: editboxIcon },
  { type: "richtext", src: richtextIcon },
  { type: "label", src: labelIcon },
  { type: "atlaslabel", src: atlaslabelIcon },
  { type: "sprite", src: spriteIcon },
  { type: "layout", src: layoutIcon },
];

function normalizeCompType(type: unknown): string {
  if (typeof type !== "string") return "";
  return type.replace(/^cc\./i, "").toLowerCase();
}

export function resolveNodeIconSrc(node: SceneNodeData): string {
  const types = new Set(
    (node.components || []).map((c) => normalizeCompType(c?.type)).filter(Boolean),
  );
  for (const entry of ICON_BY_TYPE) {
    if (types.has(entry.type)) return entry.src;
  }
  return defaultIcon;
}
