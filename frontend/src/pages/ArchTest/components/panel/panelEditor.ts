import { clone, getPath, setPath, type ArchModel } from "../../engine";
import { findPlacedNode, useArch } from "../../state/archApi";

export type EditTarget = "node" | "edge" | "group" | "model";

export interface Editor {
  /** Set a dotted path on the target, coalescing rapid edits of the same path into one undo step. */
  set: (path: string, value: unknown) => void;
  push: (path: string, item: unknown) => void;
  remove: (path: string, index: number) => void;
  /** Run an arbitrary mutation on the cloned target and draft model. */
  edit: <T>(mutator: (target: T, draft: ArchModel) => void, coalesceKey?: string) => void;
}

const locate = (draft: ArchModel, kind: EditTarget, id: string): object | undefined => {
  if (kind === "node") return findPlacedNode(draft, id);
  if (kind === "edge") return draft.edges.find((e) => e.id === id);
  if (kind === "model") return draft;
  return draft.groups.find((g) => g.id === id);
};

const arrayAt = (target: object, path: string): unknown[] => {
  const list = getPath(target, path);
  if (!Array.isArray(list)) throw new Error(`Expected an array at "${path}"`);
  return list;
};

export const useEditor = (kind: EditTarget, id: string): Editor => {
  const { commit } = useArch();

  const edit: Editor["edit"] = (mutator, coalesceKey) =>
    commit((draft) => {
      const target = locate(draft, kind, id);
      if (!target) throw new Error(`Cannot edit missing ${kind} "${id}"`);
      mutator(target as never, draft);
    }, coalesceKey);

  return {
    edit,
    set: (path, value) => edit((target) => setPath(target, path, value), `f:${id}:${path}`),
    push: (path, item) => edit((target) => arrayAt(target as object, path).push(clone(item))),
    remove: (path, index) => edit((target) => arrayAt(target as object, path).splice(index, 1)),
  };
};

/** An editor whose paths are relative to a sub-object of the target (e.g. one endpoint inside a service). */
export const scopeEditor = (editor: Editor, scopeKey: string, pick: (target: never) => object): Editor => {
  const edit: Editor["edit"] = (mutator, coalesceKey) =>
    editor.edit((target, draft) => mutator(pick(target as never) as never, draft), coalesceKey);
  return {
    edit,
    set: (path, value) => edit((target) => setPath(target, path, value), `f:${scopeKey}:${path}`),
    push: (path, item) => edit((target) => arrayAt(target as object, path).push(clone(item))),
    remove: (path, index) => edit((target) => arrayAt(target as object, path).splice(index, 1)),
  };
};
