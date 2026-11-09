import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceStep } from "../engine";
import { installLocalStorage } from "./testStorage";
import { useArchController } from "./useArchController";

const captured = vi.hoisted(() => ({ onStepShown: null as ((step: TraceStep) => void) | null }));

vi.mock("./useTraceState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useTraceState")>();
  return {
    ...actual,
    useTraceState: (...args: Parameters<typeof actual.useTraceState>) => {
      captured.onStepShown = args[1];
      return actual.useTraceState(...args);
    },
  };
});

beforeEach(() => {
  installLocalStorage();
});

describe("useArchController following trace steps", () => {
  it("fails loudly when a trace step points at a node that is not in the diagram", () => {
    renderHook(() => useArchController(() => ({ width: 1000, height: 800 })));
    const orphanStep = { i: 3, dir: "req", node: "ghost", edge: null, payload: null, title: "", warns: [], meta: {} } as unknown as TraceStep;
    expect(() => captured.onStepShown!(orphanStep)).toThrow('Trace step 3 points at node "ghost", which is not in the diagram');
  });
});
