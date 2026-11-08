import { describe, expect, it } from "vitest";
import {
  COALESCE_WINDOW_MS,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  checkpoint,
  createHistory,
  redo,
  undo,
} from "./history";

describe("history", () => {
  it("starts empty", () => {
    const history = createHistory();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history, "now")).toBeNull();
    expect(redo(history, "now")).toBeNull();
  });

  it("records checkpoints and clears redo", () => {
    const history = createHistory();
    expect(checkpoint(history, () => "a", undefined, 0)).toBe(true);
    expect(undo(history, "b")).toBe("a");
    expect(canRedo(history)).toBe(true);
    checkpoint(history, () => "c", undefined, 10);
    expect(canRedo(history)).toBe(false);
  });

  it("coalesces edits with the same key inside the window", () => {
    const history = createHistory();
    expect(checkpoint(history, () => "1", "field", 1000)).toBe(true);
    expect(checkpoint(history, () => "2", "field", 1000 + COALESCE_WINDOW_MS - 1)).toBe(false);
    expect(history.undoStack).toEqual(["1"]);
    expect(checkpoint(history, () => "3", "field", 1000 + 2 * COALESCE_WINDOW_MS)).toBe(true);
    expect(checkpoint(history, () => "4", "other", 1000 + 2 * COALESCE_WINDOW_MS + 1)).toBe(true);
    expect(history.undoStack).toEqual(["1", "3", "4"]);
  });

  it("caps the undo stack", () => {
    const history = createHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) checkpoint(history, () => String(i), undefined, i);
    expect(history.undoStack).toHaveLength(HISTORY_LIMIT);
    expect(history.undoStack[0]).toBe("5");
  });

  it("round trips undo and redo", () => {
    const history = createHistory();
    checkpoint(history, () => "s0", undefined, 0);
    expect(undo(history, "s1")).toBe("s0");
    expect(redo(history, "s0")).toBe("s1");
    expect(canUndo(history)).toBe(true);
  });
});
