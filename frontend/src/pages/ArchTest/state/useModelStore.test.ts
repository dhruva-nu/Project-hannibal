import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blank, STORAGE_KEY, starter } from "../engine";
import { byName } from "../engine/testFixtures";
import { installLocalStorage } from "./testStorage";
import { readStorage, useModelStore } from "./useModelStore";

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as Storage;
  return { storage, data };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const renamed = (name: string) => (draft: { name: string }) => {
  draft.name = name;
};

describe("readStorage", () => {
  it("returns localStorage when available", () => {
    installLocalStorage();
    expect(readStorage()).toBe(window.localStorage);
  });

  it("returns null when storage access throws", () => {
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("blocked");
      },
      configurable: true,
    });
    expect(readStorage()).toBeNull();
  });
});

describe("useModelStore", () => {
  it("starts from the starter diagram without storage and from saved data when present", () => {
    const fresh = renderHook(() => useModelStore(null));
    expect(fresh.result.current.model.name).toBe("User profile example");
    expect(fresh.result.current.views.overview).toBeTruthy();
    const saved = { ...blank(), name: "Saved" };
    const { storage } = fakeStorage({ [STORAGE_KEY]: JSON.stringify(saved) });
    const restored = renderHook(() => useModelStore(storage));
    expect(restored.result.current.model.name).toBe("Saved");
  });

  it("commits immutably, tracks undo and redo availability and restores snapshots", () => {
    const { result } = renderHook(() => useModelStore(null));
    const original = result.current.model;
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commit(renamed("One")));
    expect(result.current.model).not.toBe(original);
    expect(original.name).toBe("User profile example");
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.model.name).toBe("User profile example");
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.model.name).toBe("One");
  });

  it("does nothing when undo or redo have no history", () => {
    const { result } = renderHook(() => useModelStore(null));
    const before = result.current.model;
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(result.current.model).toBe(before);
  });

  it("coalesces rapid commits with the same key into one undo step", () => {
    const { result } = renderHook(() => useModelStore(null));
    act(() => result.current.commit(renamed("a"), "typing"));
    vi.advanceTimersByTime(500);
    act(() => result.current.commit(renamed("ab"), "typing"));
    act(() => result.current.undo());
    expect(result.current.model.name).toBe("User profile example");
  });

  it("replaces the whole model as one undoable step", () => {
    const { result } = renderHook(() => useModelStore(null));
    act(() => result.current.replaceModel(blank()));
    expect(result.current.model.name).toBe("Untitled architecture");
    act(() => result.current.undo());
    expect(byName(result.current.model, "fetchUser")).toBeTruthy();
  });

  it("renames without creating an undo step", () => {
    const { result } = renderHook(() => useModelStore(null));
    act(() => result.current.setName("Renamed"));
    expect(result.current.model.name).toBe("Renamed");
    expect(result.current.canUndo).toBe(false);
  });

  it("updates views through the setter", () => {
    const { result } = renderHook(() => useModelStore(null));
    act(() => result.current.setViews((v) => ({ ...v, client: { x: 1, y: 2, k: 3 } })));
    expect(result.current.views.client).toEqual({ x: 1, y: 2, k: 3 });
  });

  it("saves to storage after the debounce with the current views", () => {
    const { storage, data } = fakeStorage();
    const { result } = renderHook(() => useModelStore(storage));
    act(() => result.current.commit(renamed("Persisted")));
    expect(data.has(STORAGE_KEY)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(JSON.parse(data.get(STORAGE_KEY)!).name).toBe("Persisted");
    expect(JSON.parse(data.get(STORAGE_KEY)!).views.overview).toBeTruthy();
  });

  it("saves the model's own view when no overview view is stored", () => {
    const { storage, data } = fakeStorage();
    const { result } = renderHook(() => useModelStore(storage));
    act(() => result.current.setViews(() => ({})));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(JSON.parse(data.get(STORAGE_KEY)!).view).toEqual(result.current.model.view);
  });

  it("does not persist without storage", () => {
    const { result } = renderHook(() => useModelStore(null));
    act(() => result.current.commit(renamed("x")));
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(starter().name).toBeTruthy();
  });
});
