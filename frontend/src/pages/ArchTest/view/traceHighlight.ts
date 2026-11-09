import type { ArchModel, TraceStep } from "../engine";
import { findNode as nodeOf } from "../engine";
import type { TraceView } from "../state/archApi";

export type TraceMark = "none" | "active" | "activeResponse" | "visited" | "dim";

const stepTouches = (model: ArchModel, step: TraceStep, targetId: string): boolean => {
  const target = nodeOf(model, targetId);
  if (target?.type === "layer") return nodeOf(model, step.node)?.layer === target.lid;
  return step.node === targetId;
};

export const traceMark = (model: ArchModel, trace: TraceView | null, targetId: string): TraceMark => {
  if (!trace) return "none";
  const { steps } = trace.result;
  const current = steps[trace.index];
  if (stepTouches(model, current, targetId)) return current.dir === "res" ? "activeResponse" : "active";
  const seen = steps.slice(0, trace.index + 1).some((step) => stepTouches(model, step, targetId));
  return seen ? "visited" : "dim";
};

/** Map of edge id to the direction it was last crossed, for steps up to the current one. */
export const edgeVisits = (trace: TraceView): Record<string, "req" | "res"> => {
  const visits: Record<string, "req" | "res"> = {};
  trace.result.steps.slice(0, trace.index + 1).forEach((step) => {
    if (step.edge) visits[step.edge] = step.dir;
  });
  return visits;
};
