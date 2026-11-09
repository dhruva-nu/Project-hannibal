import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VIEW, starter } from "../engine";
import { byName } from "../engine/testFixtures";
import { useScopeView, viewportSizeFor } from "./useScopeView";
import { useState } from "react";
import type { ViewMap } from "./useModelStore";

const STAGE = { width: 1000, height: 800 };

const setup = (initial: ViewMap = { overview: { x: 0, y: 0, k: 1 } }) => {
  const model = starter();
  const onScopeChange = vi.fn();
  const hook = renderHook(() => {
    const [views, setViews] = useState<ViewMap>(initial);
    return { views, api: useScopeView({ model, views, setViews, getStageSize: () => STAGE, onScopeChange }) };
  });
  return { ...hook, model, onScopeChange };
};

describe("viewportSizeFor", () => {
  it("shrinks the window inside a layer scope only", () => {
    expect(viewportSizeFor(null, STAGE)).toBe(STAGE);
    expect(viewportSizeFor("client", STAGE)).toEqual({ width: 952, height: 640 });
  });
});

describe("useScopeView", () => {
  it("falls back to the default view when none is stored", () => {
    const { result } = setup({});
    expect(result.current.api.view).toEqual(DEFAULT_VIEW);
    expect(result.current.api.overviewView).toEqual(DEFAULT_VIEW);
  });

  it("pans, sets and zooms the current view", () => {
    const { result } = setup();
    act(() => result.current.api.panBy(10, 20));
    expect(result.current.api.view).toMatchObject({ x: -10, y: -20 });
    act(() => result.current.api.setView({ x: 5, y: 5, k: 1 }));
    act(() => result.current.api.zoomAtPoint(0, 0, 2));
    expect(result.current.api.view.k).toBe(2);
  });

  it("zooms around the centre with the buttons", () => {
    const { result } = setup();
    act(() => result.current.api.zoomFromCenter("in"));
    expect(result.current.api.view.k).toBeCloseTo(1.2);
    act(() => result.current.api.zoomFromCenter("out"));
    expect(result.current.api.view.k).toBeCloseTo(1);
  });

  it("fits the visible nodes", () => {
    const { result } = setup();
    act(() => result.current.api.fit());
    expect(result.current.views.overview.k).not.toBe(1);
  });

  it("opens a layer, fits it the first time, notifies, and closes again", () => {
    const { result, onScopeChange } = setup();
    act(() => result.current.api.openScope("backend"));
    expect(result.current.api.scope).toBe("backend");
    expect(result.current.views.backend).toBeTruthy();
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    act(() => result.current.api.closeScope());
    expect(result.current.api.scope).toBeNull();
    expect(onScopeChange).toHaveBeenCalledTimes(2);
  });

  it("keeps an existing layer view when reopening", () => {
    const stored = { x: 7, y: 8, k: 1.5 };
    const { result } = setup({ overview: { x: 0, y: 0, k: 1 }, backend: stored });
    act(() => result.current.api.openScope("backend"));
    expect(result.current.views.backend).toEqual(stored);
    expect(result.current.api.view).toEqual(stored);
  });

  it("recentres on an off-screen node and leaves visible or unknown ones alone", () => {
    const { result, model } = setup({ overview: { x: -5000, y: 0, k: 1 } });
    const card = model.lnodes[0];
    act(() => result.current.api.ensureVisible(card.id));
    expect(result.current.views.overview.x).not.toBe(-5000);
    const settled = result.current.views.overview;
    act(() => result.current.api.ensureVisible(card.id));
    expect(result.current.views.overview).toEqual(settled);
    act(() => result.current.api.ensureVisible("missing"));
    expect(result.current.views.overview).toEqual(settled);
  });

  it("skips ensureVisible when the target scope has no view yet", () => {
    const { result, model } = setup();
    const api = byName(model, "Get user");
    act(() => result.current.api.ensureVisible(api.id, "backend"));
    expect(result.current.views.backend).toBeUndefined();
  });

  it("can recentre inside a scoped view", () => {
    const { result, model } = setup({ overview: { x: 0, y: 0, k: 1 }, backend: { x: -9000, y: 0, k: 1 } });
    act(() => result.current.api.openScope("backend"));
    act(() => result.current.api.ensureVisible(byName(model, "Get user").id));
    expect(result.current.views.backend.x).not.toBe(-9000);
  });
});
