import { vi, type Mock } from "vitest";
import { clone, starter, type ArchModel } from "../../../engine";
import { NO_SELECTION } from "../../../state/archApi";
import type { GestureContext } from "./gestureContext";

export type FakeContext = GestureContext & {
  select: Mock;
  commit: Mock;
  setOverrides: Mock;
  setPreview: Mock;
  setMarquee: Mock;
  setPanning: Mock;
  setView: Mock;
  openScope: Mock;
  openDetail: Mock;
  connect: Mock;
  reveal: Mock;
  elementAt: Mock;
};

export const makeContext = (overrides: Partial<GestureContext> = {}): FakeContext => {
  const model: ArchModel = starter();
  return {
    model,
    selection: NO_SELECTION,
    scope: null,
    view: { x: 0, y: 0, k: 1 },
    viewportRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    select: vi.fn(),
    commit: vi.fn(),
    setOverrides: vi.fn(),
    setPreview: vi.fn(),
    setMarquee: vi.fn(),
    setPanning: vi.fn(),
    setView: vi.fn(),
    openScope: vi.fn(),
    openDetail: vi.fn(),
    connect: vi.fn(),
    reveal: vi.fn(),
    elementAt: vi.fn(() => null),
    now: () => 1000,
    lastClick: { id: null, time: 0 },
    ...overrides,
  } as FakeContext;
};

/** Run the mutator the way the model store does: on a clone of the context's model. */
export const committedDraft = (ctx: FakeContext, call = 0): ArchModel => {
  const draft = clone(ctx.model);
  (ctx.commit.mock.calls[call][0] as (d: ArchModel) => void)(draft);
  return draft;
};

export const pointer = (type: "pointermove" | "pointerup" | "pointercancel", x: number, y: number) =>
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));

export const down = (x: number, y: number, extra: { shiftKey?: boolean } = {}) => ({ clientX: x, clientY: y, ...extra });
