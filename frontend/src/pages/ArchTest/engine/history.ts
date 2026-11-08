export const HISTORY_LIMIT = 60;
export const COALESCE_WINDOW_MS = 1500;

export interface History {
  undoStack: string[];
  redoStack: string[];
  lastCheckpoint: { key: string; time: number };
}

export const createHistory = (): History => ({
  undoStack: [],
  redoStack: [],
  lastCheckpoint: { key: "", time: 0 },
});

export const canUndo = (history: History): boolean => history.undoStack.length > 0;
export const canRedo = (history: History): boolean => history.redoStack.length > 0;

/** Records the state before an edit. Returns false when the edit was coalesced into the previous checkpoint. */
export const checkpoint = (
  history: History,
  takeSnapshot: () => string,
  key: string | undefined,
  now: number,
): boolean => {
  const last = history.lastCheckpoint;
  if (key && last.key === key && now - last.time < COALESCE_WINDOW_MS) {
    last.time = now;
    return false;
  }
  history.lastCheckpoint = { key: key || "", time: now };
  history.undoStack.push(takeSnapshot());
  if (history.undoStack.length > HISTORY_LIMIT) history.undoStack.shift();
  history.redoStack = [];
  return true;
};

/** Returns the snapshot to restore, or null when there is nothing to undo. */
export const undo = (history: History, currentSnapshot: string): string | null => {
  const previous = history.undoStack.pop();
  if (previous === undefined) return null;
  history.redoStack.push(currentSnapshot);
  return previous;
};

/** Returns the snapshot to restore, or null when there is nothing to redo. */
export const redo = (history: History, currentSnapshot: string): string | null => {
  const next = history.redoStack.pop();
  if (next === undefined) return null;
  history.undoStack.push(currentSnapshot);
  return next;
};
