import { Event } from "../shared/protocol";
import { hookAssets } from "./assets";
import { sendEvent } from "./message";
import { hookProfiler } from "./profiler";
import { hookScene } from "./scene";

declare const cc: any;

if (typeof cc !== "undefined") {
  hookAssets();
  hookScene();
  hookProfiler();
  sendEvent(Event.loadingComplete, null);
} else {
  console.warn("[cc-runtime] window.cc not found — inject after Cocos boots");
}
