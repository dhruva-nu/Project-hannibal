import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clone, createNode, normalize, starter, type ArchModel } from "../engine";
import { byName, link } from "../engine/testFixtures";
import { computeTraceResult, useTraceState } from "./useTraceState";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const compId = (model: ArchModel) => byName(model, "UserProfile").id;

const starterWithCacheBeforeService = (): ArchModel => {
  const model = starter();
  const fn = byName(model, "fetchUser");
  const service = byName(model, "User service");
  const cache = createNode("redis", 600, 200);
  model.nodes.push(cache);
  model.edges.find((e) => e.from === fn.id && e.to === service.id)!.to = cache.id;
  link(model, cache, service);
  normalize(model);
  return model;
};

const cacheNotes = (model: ArchModel, warm: boolean) =>
  computeTraceResult(model, { compId: compId(model), only: "", warm }).steps.map((s) => s.meta.cache).filter(Boolean);

describe("computeTraceResult", () => {
  it("misses the cache on a cold run and hits it on a warm run", () => {
    const model = starterWithCacheBeforeService();
    expect(cacheNotes(model, false)).toContain("MISS");
    expect(cacheNotes(model, false)).not.toContain("HIT");
    expect(cacheNotes(model, true)).toContain("HIT");
  });
});

const setup = (model: ArchModel = starter()) => {
  const onStepShown = vi.fn();
  const hook = renderHook(({ m }) => useTraceState(m, onStepShown), { initialProps: { m: model } });
  return { ...hook, onStepShown, model };
};

describe("useTraceState", () => {
  it("has no trace until started and ignores controls", () => {
    const { result, onStepShown } = setup();
    expect(result.current.trace).toBeNull();
    act(() => result.current.goTo(2));
    act(() => result.current.togglePlay());
    act(() => result.current.setWarm(true));
    act(() => result.current.setOnly("anything"));
    expect(result.current.trace).toBeNull();
    expect(onStepShown).not.toHaveBeenCalled();
  });

  it("starts at the first step and clamps navigation to the available steps", () => {
    const { result, model, onStepShown } = setup();
    act(() => result.current.start(compId(model)));
    const total = result.current.trace!.result.steps.length;
    expect(result.current.trace!.index).toBe(0);
    act(() => result.current.goTo(999));
    expect(result.current.trace!.index).toBe(total - 1);
    act(() => result.current.goTo(-4));
    expect(result.current.trace!.index).toBe(0);
    expect(onStepShown).toHaveBeenCalledTimes(2);
  });

  it("plays through the steps once a second and stops at the end", () => {
    const { result, model } = setup();
    act(() => result.current.start(compId(model)));
    const last = result.current.trace!.result.steps.length - 1;
    act(() => result.current.togglePlay());
    expect(result.current.trace!.playing).toBe(true);
    expect(result.current.trace!.index).toBe(1);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.trace!.index).toBe(2);
    for (let tick = 0; tick < last + 2; tick++) act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.trace!.index).toBe(last);
    expect(result.current.trace!.playing).toBe(false);
  });

  it("pauses when toggled while playing and restarts from the top when played at the end", () => {
    const { result, model } = setup();
    act(() => result.current.start(compId(model)));
    act(() => result.current.togglePlay());
    act(() => result.current.togglePlay());
    expect(result.current.trace!.playing).toBe(false);
    const last = result.current.trace!.result.steps.length - 1;
    act(() => result.current.goTo(last));
    act(() => result.current.togglePlay());
    expect(result.current.trace!.index).toBe(0);
    expect(result.current.trace!.playing).toBe(true);
  });

  it("re-runs for warm and single-function modes", () => {
    const model = starterWithCacheBeforeService();
    const { result } = setup(model);
    act(() => result.current.start(compId(model)));
    act(() => result.current.goTo(3));
    act(() => result.current.setWarm(true));
    expect(result.current.trace!.warm).toBe(true);
    expect(result.current.trace!.index).toBe(0);
    expect(result.current.trace!.result.steps.some((s) => s.meta.cache === "HIT")).toBe(true);
    const fnId = result.current.trace!.result.fnOrder[0].id;
    act(() => result.current.setOnly(fnId));
    expect(result.current.trace!.only).toBe(fnId);
    act(() => result.current.setOnly(""));
    expect(result.current.trace!.only).toBe("");
  });

  it("closes the trace and drops it when its component disappears", () => {
    const model = starter();
    const { result, rerender } = setup(model);
    act(() => result.current.start(compId(model)));
    const without = clone(model);
    without.nodes = without.nodes.filter((n) => n.type !== "component");
    rerender({ m: without });
    expect(result.current.trace).toBeNull();
    rerender({ m: model });
    expect(result.current.trace).not.toBeNull();
    act(() => result.current.close());
    expect(result.current.trace).toBeNull();
  });

  it("clamps the shown step when an edit shortens the trace", () => {
    const model = starter();
    const { result, rerender } = setup(model);
    act(() => result.current.start(compId(model)));
    const total = result.current.trace!.result.steps.length;
    act(() => result.current.goTo(total - 1));
    const shorter = clone(model);
    shorter.edges = shorter.edges.filter((e) => e.from !== byName(shorter, "fetchUser").id);
    rerender({ m: shorter });
    expect(result.current.trace!.index).toBe(result.current.trace!.result.steps.length - 1);
  });
});
