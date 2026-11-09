import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import type { ArchModel, TraceResult, TraceSession, TraceStep } from "../engine";
import { clone, createTraceSession, findNode as nodeOf, runTrace } from "../engine";
import type { TraceView } from "./archApi";

const PLAY_INTERVAL_MS = 1000;

interface TraceRequest {
  compId: string;
  only: string;
  warm: boolean;
  index: number;
  playing: boolean;
}

interface PureRun {
  result: TraceResult;
  session: TraceSession;
}

const runPure = (model: ArchModel, compId: string, only: string, warm: boolean, base: TraceSession): PureRun => {
  const session = clone(base);
  const result = runTrace(model, compId, { only: only || undefined, warm }, session);
  return { result, session };
};

/** Cold run first; a warm run then reuses the cache the cold run filled. */
export const computeTraceResult = (
  model: ArchModel,
  request: Pick<TraceRequest, "compId" | "only" | "warm">,
): TraceResult => {
  const cold = runPure(model, request.compId, request.only, false, createTraceSession());
  if (!request.warm) return cold.result;
  return runPure(model, request.compId, request.only, true, cold.session).result;
};

export interface TraceStateApi {
  trace: TraceView | null;
  start: (componentId: string) => void;
  close: () => void;
  goTo: (index: number) => void;
  togglePlay: () => void;
  setWarm: (warm: boolean) => void;
  setOnly: (functionId: string) => void;
}

export const useTraceState = (model: ArchModel, onStepShown: (step: TraceStep) => void): TraceStateApi => {
  const [request, setRequest] = useState<TraceRequest | null>(null);

  const active = request && nodeOf(model, request.compId) ? request : null;
  const compId = active?.compId ?? null;
  const only = active?.only ?? "";
  const warm = active?.warm ?? false;
  const result = useMemo(
    () => (compId ? computeTraceResult(model, { compId, only, warm }) : null),
    [model, compId, only, warm],
  );
  const lastIndex = result ? result.steps.length - 1 : 0;
  const index = active ? Math.min(active.index, lastIndex) : 0;
  const trace: TraceView | null = active && result ? { ...active, index, result } : null;
  const playing = Boolean(trace?.playing);

  const update = useCallback((patch: Partial<TraceRequest>) => setRequest((c) => (c ? { ...c, ...patch } : c)), []);

  const showStep = (target: number) => {
    if (!trace) return;
    const clamped = Math.max(0, Math.min(target, lastIndex));
    update({ index: clamped });
    onStepShown(trace.result.steps[clamped]);
  };

  const advance = useEffectEvent(() => {
    if (index >= lastIndex) update({ playing: false });
    else showStep(index + 1);
  });

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(advance, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  return {
    trace,
    start: (compId) => setRequest({ compId, only: "", warm: false, index: 0, playing: false }),
    close: () => setRequest(null),
    goTo: showStep,
    togglePlay: () => {
      if (!trace) return;
      if (trace.playing) {
        update({ playing: false });
        return;
      }
      update({ playing: true });
      showStep(trace.index >= lastIndex ? 0 : trace.index + 1);
    },
    setWarm: (warm) => update({ warm, index: 0 }),
    setOnly: (only) => update({ only, index: 0 }),
  };
};
