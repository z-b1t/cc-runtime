import { NEW_KEY, VISITOR_KEY } from "../shared/protocol";
import { registerHandler } from "./message";

export const symbolMutate = Symbol("cc-runtime Mutate");
const mutatorMap: Record<string, Mutator> = {};

export function getMutator(target: any): Mutator | null {
  return (target && target[symbolMutate]) || null;
}

export function getMutatorById(id: string): Mutator | null {
  return mutatorMap[id] || null;
}

export class Mutator {
  private _id: string;
  private _target: any;
  private _listens: Array<() => void>;

  get id() {
    return this._id;
  }
  get target() {
    return this._target;
  }

  constructor(target: any) {
    this._target = target;
    this._id =
      this.target.uuid ||
      this.target._uuid ||
      `${Date.now()}-${Math.random()}`;
    mutatorMap[this._id] = this;
    this._listens = [
      registerHandler(`mutatorGet-${this._id}`, ({ name }: any) => {
        const val = this._target[name];
        if (val && ["object", "function"].includes(typeof val)) {
          const m = (val[symbolMutate] =
            val[symbolMutate] || new Mutator(val));
          return { [VISITOR_KEY]: m.id };
        }
        return val;
      }),
      registerHandler(`mutatorSet-${this._id}`, ({ name, value }: any) => {
        const isObject = value && typeof value === "object";
        if (isObject && VISITOR_KEY in value) {
          const visitorId = value[VISITOR_KEY];
          if (visitorId) {
            const m = mutatorMap[visitorId];
            if (!m) {
              throw new Error(
                `value is invalid. visitorId=${visitorId}, name=${name}`,
              );
            }
            this._target[name] = m.target;
            return this._target[name] === m.target;
          }
          this._target[name] = null;
          return this._target[name] === null;
        }
        if (isObject && NEW_KEY in value) {
          try {
            const { cls, args } = value[NEW_KEY];
            // eslint-disable-next-line no-eval
            const Cls = eval(cls);
            value = new Cls(...args);
          } catch {
            /* ignore construct errors */
          }
          this._target[name] = value;
          return this._target[name] === value;
        }
        this._target[name] = value;
        return this._target[name] === value;
      }),
      registerHandler(`mutatorCall-${this._id}`, ({ name, args }: any) => {
        const resolved = (args as any[]).map((arg) => {
          const isObject = arg && typeof arg === "object";
          if (isObject && VISITOR_KEY in arg) {
            const visitorId = arg[VISITOR_KEY];
            if (visitorId) {
              const m = mutatorMap[visitorId];
              if (!m) throw new Error("arg is invalid. visitorId=" + visitorId);
              return m.target;
            }
            return null;
          }
          if (isObject && NEW_KEY in arg) {
            try {
              const { cls, args: cargs } = arg[NEW_KEY];
              // eslint-disable-next-line no-eval
              const Cls = eval(cls);
              return new Cls(...cargs);
            } catch {
              return arg;
            }
          }
          return arg;
        });
        const func = this._target[name];
        if (func instanceof Function) return func.apply(this._target, resolved);
        throw new Error(`There is no function called ${name}`);
      }),
    ];
  }

  destroy() {
    this._listens.splice(0).forEach((u) => u());
    delete mutatorMap[this.id];
    this._target = null;
  }
}
