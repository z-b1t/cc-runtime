import {
  type ComponentClipboardPayload,
  type NodeClipboardPayload,
} from "@shared/protocol";

let memoryComponent: ComponentClipboardPayload | null = null;
let memoryNode: NodeClipboardPayload | null = null;

export function getMemoryComponentClipboard(): ComponentClipboardPayload | null {
  return memoryComponent;
}

export function getMemoryNodeClipboard(): NodeClipboardPayload | null {
  return memoryNode;
}

export async function writeComponentClipboard(
  payload: ComponentClipboardPayload,
): Promise<void> {
  memoryComponent = payload;
}

export async function writeNodeClipboard(
  payload: NodeClipboardPayload,
): Promise<void> {
  memoryNode = payload;
}

export async function readComponentClipboard(): Promise<ComponentClipboardPayload | null> {
  return memoryComponent;
}

export async function readNodeClipboard(): Promise<NodeClipboardPayload | null> {
  return memoryNode;
}
