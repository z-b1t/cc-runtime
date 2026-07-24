import {
  CLIPBOARD_COMPONENT_TYPE,
  CLIPBOARD_NODE_TYPE,
  type ComponentClipboardPayload,
  type NodeClipboardPayload,
} from "@shared/protocol";

let memoryComponent: ComponentClipboardPayload | null = null;
let memoryNode: NodeClipboardPayload | null = null;

function isComponentPayload(v: any): v is ComponentClipboardPayload {
  return !!(
    v &&
    typeof v === "object" &&
    (typeof v.cid === "string" || v.dump) &&
    v.dump &&
    typeof v.dump === "object" &&
    !Array.isArray(v.attrs)
  );
}

function isNodePayload(v: any): v is NodeClipboardPayload {
  return !!(
    v &&
    typeof v === "object" &&
    Array.isArray(v.attrs) &&
    v.dump &&
    typeof v.dump === "object"
  );
}

function parseAnyPayload(
  text: string,
):
  | { kind: "component"; payload: ComponentClipboardPayload }
  | { kind: "node"; payload: NodeClipboardPayload }
  | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (isNodePayload(parsed)) return { kind: "node", payload: parsed };
    if (isComponentPayload(parsed)) {
      return { kind: "component", payload: parsed };
    }
    if (parsed?.type === CLIPBOARD_COMPONENT_TYPE && isComponentPayload(parsed.data)) {
      return { kind: "component", payload: parsed.data };
    }
    if (parsed?.type === CLIPBOARD_NODE_TYPE && isNodePayload(parsed.data)) {
      return { kind: "node", payload: parsed.data };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function getMemoryComponentClipboard(): ComponentClipboardPayload | null {
  return memoryComponent;
}

export function getMemoryNodeClipboard(): NodeClipboardPayload | null {
  return memoryNode;
}

async function writeNativeClipboard(
  format: string,
  payload: unknown,
): Promise<boolean> {
  try {
    const nativeResult = await new Promise<{
      ok?: boolean;
      error?: string;
      native?: boolean;
    }>((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "cc-runtime::writeCreatorClipboard",
            format,
            payload,
          },
          (resp) => {
            void chrome.runtime.lastError;
            resolve(resp || { ok: false });
          },
        );
      } catch {
        resolve({ ok: false });
      }
    });
    if (nativeResult?.ok) return true;
    if (nativeResult && nativeResult.native === false) {
      console.info(
        "[cc-runtime] native clipboard host not registered; using web clipboard. Run: node scripts/register-clipboard-host.mjs <extension-id>",
      );
    }
  } catch (err) {
    console.warn("[cc-runtime] native clipboard write skipped", err);
  }
  return false;
}

async function writeWebClipboard(format: string, json: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const plain = new Blob([json], { type: "text/plain" });
      const custom = new Blob([json], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": plain,
          [`web ${format}`]: custom,
        }),
      ]);
      return;
    }
  } catch (err) {
    console.warn("[cc-runtime] ClipboardItem write failed, fallback", err);
  }

  await new Promise<void>((resolve, reject) => {
    const onCopy = (e: ClipboardEvent) => {
      try {
        e.clipboardData?.setData(format, json);
        e.clipboardData?.setData("text/plain", json);
        e.preventDefault();
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.removeEventListener("copy", onCopy, true);
      }
    };
    document.addEventListener("copy", onCopy, true);
    const ok = document.execCommand("copy");
    if (!ok) {
      document.removeEventListener("copy", onCopy, true);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(json).then(() => resolve()).catch(reject);
      } else {
        reject(new Error("copy command failed"));
      }
    }
  });
}

export async function writeComponentClipboard(
  payload: ComponentClipboardPayload,
): Promise<void> {
  memoryComponent = payload;
  const json = JSON.stringify(payload);
  if (await writeNativeClipboard(CLIPBOARD_COMPONENT_TYPE, payload)) return;
  await writeWebClipboard(CLIPBOARD_COMPONENT_TYPE, json);
}

export async function writeNodeClipboard(
  payload: NodeClipboardPayload,
): Promise<void> {
  memoryNode = payload;
  const json = JSON.stringify(payload);
  if (await writeNativeClipboard(CLIPBOARD_NODE_TYPE, payload)) return;
  await writeWebClipboard(CLIPBOARD_NODE_TYPE, json);
}

export async function readComponentClipboard(): Promise<ComponentClipboardPayload | null> {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const types = item.types || [];
        const prefer =
          types.find((t) => t === CLIPBOARD_COMPONENT_TYPE) ||
          types.find((t) => t === `web ${CLIPBOARD_COMPONENT_TYPE}`) ||
          types.find((t) => t.includes(CLIPBOARD_COMPONENT_TYPE)) ||
          (types.includes("text/plain") ? "text/plain" : null);
        if (!prefer) continue;
        const text = await (await item.getType(prefer)).text();
        const parsed = parseAnyPayload(text);
        if (parsed?.kind === "component") {
          if (
            !parsed.payload.runtime &&
            memoryComponent?.runtime &&
            String(parsed.payload.cid || "") ===
              String(memoryComponent.cid || "")
          ) {
            return memoryComponent;
          }
          memoryComponent = parsed.payload;
          return parsed.payload;
        }
      }
    } else if (navigator.clipboard?.readText) {
      const parsed = parseAnyPayload(await navigator.clipboard.readText());
      if (parsed?.kind === "component") {
        if (
          !parsed.payload.runtime &&
          memoryComponent?.runtime &&
          String(parsed.payload.cid || "") === String(memoryComponent.cid || "")
        ) {
          return memoryComponent;
        }
        memoryComponent = parsed.payload;
        return parsed.payload;
      }
    }
  } catch (err) {
    console.warn("[cc-runtime] clipboard read failed, use memory", err);
  }
  return memoryComponent;
}

export async function readNodeClipboard(): Promise<NodeClipboardPayload | null> {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const types = item.types || [];
        const prefer =
          types.find((t) => t === CLIPBOARD_NODE_TYPE) ||
          types.find((t) => t === `web ${CLIPBOARD_NODE_TYPE}`) ||
          types.find((t) => t.includes(CLIPBOARD_NODE_TYPE)) ||
          (types.includes("text/plain") ? "text/plain" : null);
        if (!prefer) continue;
        const text = await (await item.getType(prefer)).text();
        const parsed = parseAnyPayload(text);
        if (parsed?.kind === "node") {
          if (!parsed.payload.runtime && memoryNode?.runtime) {
            return memoryNode;
          }
          memoryNode = parsed.payload;
          return parsed.payload;
        }
      }
    } else if (navigator.clipboard?.readText) {
      const parsed = parseAnyPayload(await navigator.clipboard.readText());
      if (parsed?.kind === "node") {
        if (!parsed.payload.runtime && memoryNode?.runtime) return memoryNode;
        memoryNode = parsed.payload;
        return parsed.payload;
      }
    }
  } catch (err) {
    console.warn("[cc-runtime] node clipboard read failed, use memory", err);
  }
  return memoryNode;
}
