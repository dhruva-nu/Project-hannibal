import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { starter, type LayerId, type View } from "@/pages/ArchTest/engine";
import { useDockMotion } from "./useDockMotion";
import { useStageSize } from "./useStageSize";
import { CLOSE_MS, useRetainedScope } from "./useRetainedScope";
import { useWindowGrow } from "./useWindowGrow";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDockMotion", () => {
  beforeEach(() => vi.useFakeTimers());

  it("docks after two frames and stops moving after the transition", () => {
    const { result, rerender } = renderHook(({ scope }) => useDockMotion(scope), { initialProps: { scope: null as "client" | null } });
    expect(result.current).toEqual({ docked: false, moving: false });
    rerender({ scope: "client" });
    expect(result.current).toEqual({ docked: false, moving: true });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current.docked).toBe(true);
    act(() => void vi.advanceTimersByTime(700));
    expect(result.current.moving).toBe(false);
    rerender({ scope: null });
    expect(result.current).toEqual({ docked: false, moving: true });
    act(() => void vi.advanceTimersByTime(700));
    expect(result.current.moving).toBe(false);
  });
});

describe("useRetainedScope", () => {
  beforeEach(() => vi.useFakeTimers());
  const view = { x: 5, y: 6, k: 1 };
  const other = { x: 0, y: 0, k: 1 };
  const clientView = { x: 9, y: 9, k: 2 };
  const viewOfScope = vi.fn((layer: LayerId) => (layer === "client" ? clientView : other));
  type Props = { scope: LayerId | null; v: View };
  const retain = (initialProps: Props) =>
    renderHook(({ scope, v }: Props) => useRetainedScope(scope, v, viewOfScope), { initialProps });

  it("keeps the closed layer with its own saved view until the collapse animation ends", () => {
    const { result, rerender } = retain({ scope: "client", v: view });
    expect(result.current).toEqual({ scope: "client", view, closing: false });
    rerender({ scope: null, v: other });
    expect(result.current).toEqual({ scope: "client", view: clientView, closing: true });
    expect(viewOfScope).toHaveBeenCalledWith("client");
    act(() => void vi.advanceTimersByTime(CLOSE_MS + 50));
    expect(result.current).toEqual({ scope: null, view: other, closing: false });
  });

  it("stays closed when nothing was ever open, and drops the retained layer when reopened", () => {
    const { result, rerender } = retain({ scope: null, v: view });
    expect(result.current).toEqual({ scope: null, view, closing: false });
    rerender({ scope: "client", v: view });
    rerender({ scope: null, v: view });
    expect(result.current.closing).toBe(true);
    rerender({ scope: "db", v: view });
    expect(result.current).toEqual({ scope: "db", view, closing: false });
    act(() => void vi.advanceTimersByTime(CLOSE_MS + 50));
    expect(result.current).toEqual({ scope: "db", view, closing: false });
  });
});

describe("useStageSize", () => {
  const stageWith = (width: number, height: number) => {
    const stage = document.createElement("div");
    stage.getBoundingClientRect = () => ({ width, height }) as DOMRect;
    return { current: stage };
  };

  it("measures the stage and follows resizes", () => {
    let notify = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const ref = stageWith(800, 600);
    const { result, unmount } = renderHook(() => useStageSize(ref));
    expect(result.current).toEqual({ width: 800, height: 600 });
    ref.current.getBoundingClientRect = () => ({ width: 900, height: 600 }) as DOMRect;
    act(() => notify());
    expect(result.current).toEqual({ width: 900, height: 600 });
    act(() => notify());
    expect(result.current).toEqual({ width: 900, height: 600 });
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("measures once when ResizeObserver is unavailable and tolerates a missing stage", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    expect(renderHook(() => useStageSize(stageWith(10, 20))).result.current).toEqual({ width: 10, height: 20 });
    expect(renderHook(() => useStageSize({ current: null })).result.current).toEqual({ width: 0, height: 0 });
  });
});

describe("useWindowGrow", () => {
  const STAGE = { width: 1100, height: 700 };
  const setup = (withWindow: boolean) => {
    const stage = document.createElement("div");
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    if (withWindow) {
      const win = document.createElement("div");
      win.setAttribute("data-live-viewport", "true");
      win.animate = animate as unknown as typeof win.animate;
      stage.appendChild(win);
    }
    const model = starter();
    return { animate, inputs: { stageRef: { current: stage }, model, overviewView: { x: 0, y: 0, k: 1 }, stage: STAGE } };
  };

  it("animates the window out of the opened card", () => {
    const { animate, inputs } = setup(true);
    const { rerender } = renderHook(({ scope }) => useWindowGrow({ ...inputs, scope, shownScope: scope }), { initialProps: { scope: null as "client" | null } });
    expect(animate).not.toHaveBeenCalled();
    rerender({ scope: "client" });
    expect(animate).toHaveBeenCalledOnce();
  });

  it("shrinks the window back into its card on collapse and clears leftovers once unmounted", () => {
    const { animate, inputs } = setup(true);
    const win = inputs.stageRef.current.querySelector("[data-live-viewport]") as HTMLElement;
    const cancel = vi.fn();
    win.getAnimations = (() => [{ cancel }]) as unknown as typeof win.getAnimations;
    const { rerender } = renderHook(({ scope, shownScope }) => useWindowGrow({ ...inputs, scope, shownScope }), {
      initialProps: { scope: "client" as "client" | null, shownScope: "client" as "client" | null },
    });
    rerender({ scope: null, shownScope: "client" });
    expect(animate).toHaveBeenCalledTimes(2);
    const closing = (animate.mock.calls[1] as unknown[])[1] as { fill: string };
    expect(closing.fill).toBe("forwards");
    expect(cancel).not.toHaveBeenCalled();
    rerender({ scope: null, shownScope: null });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does nothing without a window, with reduced motion, or without an origin card", () => {
    const noWindow = setup(false);
    renderHook(() => useWindowGrow({ ...noWindow.inputs, scope: "client", shownScope: "client" }));
    const reduced = setup(true);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    renderHook(() => useWindowGrow({ ...reduced.inputs, scope: "client", shownScope: "client" }));
    vi.unstubAllGlobals();
    const noCard = setup(true);
    noCard.inputs.model.lnodes = [];
    renderHook(() => useWindowGrow({ ...noCard.inputs, scope: "client", shownScope: "client" }));
    expect(reduced.animate).not.toHaveBeenCalled();
    expect(noCard.animate).not.toHaveBeenCalled();
  });
});
