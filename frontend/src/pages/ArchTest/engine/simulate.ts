import { node } from "./model";
import { applyEdge, expectedFor, outOf, shapeDiff } from "./payload";
import { createTraceSession, runTrace } from "./trace";
import type {
  AnyEdge,
  ArchModel,
  EdgeFlow,
  EdgeInfo,
  FlowState,
  SchemaWarning,
  TraceSession,
  TraceStep,
} from "./types";

export const emptyFlow = (): FlowState => ({ edges: {}, nodes: {}, nodeWarn: {} });

const addUniqueWarnings = (target: SchemaWarning[], incoming: SchemaWarning[]): void => {
  incoming.forEach((w) => {
    if (!target.some((x) => x.path === w.path && x.kind === w.kind)) target.push(w);
  });
};

const recordEdgeFlow = (flow: FlowState, step: TraceStep, edgeId: string): void => {
  const edgeFlow: EdgeFlow = (flow.edges[edgeId] = flow.edges[edgeId] || { warns: [] });
  if (step.dir === "res") {
    edgeFlow.res = step.payload;
    return;
  }
  edgeFlow.req = step.payload;
  edgeFlow.src = step.meta.pre !== undefined ? step.meta.pre : step.payload;
  addUniqueWarnings(edgeFlow.warns, step.warns);
};

const recordNodeFlow = (flow: FlowState, step: TraceStep): void => {
  const nodeFlow = (flow.nodes[step.node] = flow.nodes[step.node] || {});
  if (step.dir === "req" && step.edge) nodeFlow.in = step.payload;
  else if (step.dir === "res" && step.edge) nodeFlow.out = step.payload;
};

export const simulate = (model: ArchModel, session: TraceSession = createTraceSession()): FlowState => {
  const flow = emptyFlow();
  model.nodes
    .filter((n) => n.type === "component")
    .forEach((component) => {
      let steps: TraceStep[];
      try {
        steps = runTrace(model, component.id, { sim: true }, session).steps;
      } catch (error) {
        console.error(error);
        return;
      }
      steps.forEach((step) => {
        if (step.edge) recordEdgeFlow(flow, step, step.edge);
        recordNodeFlow(flow, step);
      });
      const last = steps[steps.length - 1];
      if (last && last.warns.length) flow.nodeWarn[component.id] = last.warns;
    });
  return flow;
};

export const edgeInfo = (model: ArchModel, flow: FlowState, edge: AnyEdge): EdgeInfo => {
  if (edge.derived) {
    const warns: SchemaWarning[] = [];
    edge.ids.forEach((id) => {
      const real = model.edges.find((x) => x.id === id);
      if (real) edgeInfo(model, flow, real).warns.forEach((w) => warns.push(w));
    });
    return { warns, sim: true, count: edge.ids.length };
  }
  const edgeFlow = flow.edges[edge.id];
  if (edgeFlow && edgeFlow.req !== undefined) {
    return { src: edgeFlow.src, req: edgeFlow.req, res: edgeFlow.res, warns: edgeFlow.warns, sim: true };
  }
  const from = node(model, edge.from);
  const to = node(model, edge.to);
  const src = from ? outOf(from) : {};
  const req = applyEdge(edge, src);
  const endpointId = from?.type === "function" ? from.cfg.endpoint : "";
  const expected = to ? expectedFor(to, endpointId) : null;
  return { src, req, res: edgeFlow?.res, warns: expected ? shapeDiff(expected, req) : [], sim: false };
};
