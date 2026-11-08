import type { ArchModel } from "../engine";
import { grp, node as nodeOf } from "../engine";
import { NO_SELECTION, type SelectionState } from "./archApi";

/** Drops selected ids that no longer exist after an edit, undo, or scope change. */
export const sanitizeSelection = (
  selection: SelectionState,
  model: ArchModel,
  edgeExists: (id: string) => boolean,
): SelectionState => {
  if (selection.type === null) return selection;
  const exists = {
    node: (id: string) => Boolean(nodeOf(model, id)),
    edge: edgeExists,
    group: (id: string) => Boolean(grp(model, id)),
  }[selection.type];
  const ids = selection.ids.filter(exists);
  if (ids.length === selection.ids.length) return selection;
  return ids.length ? { type: selection.type, ids } : NO_SELECTION;
};
