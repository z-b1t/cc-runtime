import { type NodeDrawCalls } from "../shared/protocol";
import { symbolMutate } from "./mutator";

declare const cc: any;

/**
 * Per-node draw call attribution for 2D/UI.
 *
 * Cocos batches draw calls, so a draw call belongs to a run of components, not
 * to one node. The run being flushed is described by `Batcher2D._currComponent`,
 * which makes "which draw call did this node open" the one attribution the
 * engine can actually answer. Nodes that merged into someone else's batch get
 * no index — those are the cheap ones.
 *
 * Numbering follows the real submit order rather than the batch order: batches
 * are matched to their input assembler while the batcher walks, then counted as
 * the command buffer draws them. That way draw calls no 2D node owns (3D models,
 * the engine's own profiler) still consume an index, and the last index lines up
 * with the device's own draw call total.
 *
 * Web only: on native the batching happens in C++ and `update()` returns early.
 */

/** Batch slot -> owning node, for the frame the batcher is walking. */
let slotOwners: any[] = [];
/** Input assembler -> owning node, for the frame being drawn. */
let iaOwners = new Map<any, any>();
/** Node -> index of the first draw call it owns, 1-based. */
let drawIndex = new Map<any, number>();
let drawCount = 0;

let lastIndex = new Map<any, number>();
let lastCount = 0;

let restoreHooks: (() => void) | null = null;

function batchCount(batcher: any): number {
  return batcher._batches?.length || 0;
}

function batchAt(batcher: any, i: number): any {
  const batches = batcher._batches;
  // CachedArray keeps the entries in `array`, plain arrays index directly.
  return batches?.array ? batches.array[i] : batches?.[i];
}

/** Take the batch slots a call pushed; nested calls have taken theirs already. */
function claimSlots(batcher: any, from: number, node: any) {
  if (!node) return;
  const to = batchCount(batcher);
  for (let i = from; i < to; i++) {
    if (slotOwners[i] === undefined) slotOwners[i] = node;
  }
}

/** Shadow an instance method, returning an undo that restores the original. */
function shadow(obj: any, key: string, wrap: (orig: Function) => Function) {
  const hadOwn = Object.prototype.hasOwnProperty.call(obj, key);
  const orig = obj[key];
  if (typeof orig !== "function") return () => {};
  obj[key] = wrap(orig);
  return () => {
    if (hadOwn) obj[key] = orig;
    else delete obj[key];
  };
}

/** Wrap an entry point that flushes the pending run, then pushes its own batches. */
function shadowOwnBatches(batcher: any, key: string) {
  return shadow(batcher, key, (orig) =>
    function (this: any, ...args: any[]) {
      const from = batchCount(this);
      const ret = orig.apply(this, args);
      claimSlots(this, from, args[0]?.node);
      return ret;
    },
  );
}

/** Command buffers the pipeline draws through; usually just the device's own. */
function commandBuffers(): any[] {
  const root = cc.director?.root;
  const found: any[] = [];
  const add = (cb: any) => {
    if (cb && typeof cb.draw === "function" && !found.includes(cb)) found.push(cb);
  };
  add(root?.device?.commandBuffer);
  (root?.pipeline?.commandBuffers || []).forEach(add);
  return found;
}

export function startDrawCallHooks(): boolean {
  if (restoreHooks) return true;
  const batcher = cc.director?.root?.batcher2D;
  if (!batcher) return false;

  const undo: (() => void)[] = [];

  // One update() call is one frame of UI walking, and it runs before the
  // pipeline draws, so the frame that just finished drawing is done being
  // counted and can be published.
  undo.push(
    shadow(batcher, "update", (orig) =>
      function (this: any, ...args: unknown[]) {
        lastIndex = drawIndex;
        lastCount = drawCount;
        drawIndex = new Map();
        drawCount = 0;
        slotOwners = [];
        iaOwners = new Map();

        const ret = orig.apply(this, args);

        for (let i = 0; i < batchCount(this); i++) {
          const ia = batchAt(this, i)?.inputAssembler;
          if (ia && slotOwners[i]) iaOwners.set(ia, slotOwners[i]);
        }
        return ret;
      },
    ),
  );

  // The `renderComp` argument is only a stencil hint, and `finishMergeBatches()`
  // omits it entirely — read the run's owner off the batcher instead.
  undo.push(
    shadow(batcher, "autoMergeBatches", (orig) =>
      function (this: any, renderComp?: any) {
        const owner = this._currComponent || renderComp;
        const from = batchCount(this);
        const ret = orig.call(this, renderComp);
        claimSlots(this, from, owner?.node);
        return ret;
      },
    ),
  );

  // Graphics / UIMeshRenderer: one batch per subModel.
  undo.push(shadowOwnBatches(batcher, "commitModel"));
  // Spine / DragonBones through the pre-3.6.2 path: one batch per call.
  undo.push(shadowOwnBatches(batcher, "commitIA"));
  // Mask: one clear batch per subModel, charged to the masking node.
  undo.push(shadowOwnBatches(batcher, "_insertMaskBatch"));

  for (const cb of commandBuffers()) {
    undo.push(
      shadow(cb, "draw", (orig) =>
        function (this: any, infoOrAssembler: any) {
          const ret = orig.call(this, infoOrAssembler);
          drawCount += 1;
          // Non-2D draws pass a DrawInfo, or an assembler we never saw.
          const node = iaOwners.get(infoOrAssembler);
          if (node && !drawIndex.has(node)) drawIndex.set(node, drawCount);
          return ret;
        },
      ),
    );
  }

  restoreHooks = () => undo.forEach((fn) => fn());
  return true;
}

export function stopDrawCallHooks() {
  restoreHooks?.();
  restoreHooks = null;
  slotOwners = [];
  iaOwners = new Map();
  drawIndex = new Map();
  drawCount = 0;
  lastIndex = new Map();
  lastCount = 0;
}

/** Last drawn frame, keyed by the panel's node id. */
export function takeNodeDrawCalls(): NodeDrawCalls {
  const index: Record<string, number> = {};
  lastIndex.forEach((at, node) => {
    const id = node?.[symbolMutate]?.id;
    if (id) index[id] = at;
  });
  return { total: lastCount, index };
}
