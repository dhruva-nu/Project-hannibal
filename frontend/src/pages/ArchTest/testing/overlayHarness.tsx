import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, vi } from "vitest";
import {
  createTraceSession,
  createEdge,
  createNode,
  normalize,
  runTrace,
  simulate,
  starter,
  type ArchModel,
  type ArchNode,
  type NodeType,
  type TraceOptions,
} from "../engine";
import { ArchContext, NO_SELECTION, type ArchApi, type TraceView } from "../state/archApi";

afterEach(cleanup);

export const nodeOfType = <T extends NodeType>(model: ArchModel, type: T): Extract<ArchNode, { type: T }> => {
  const found = model.nodes.find((n) => n.type === type);
  if (!found) throw new Error(`starter has no ${type}`);
  return found as Extract<ArchNode, { type: T }>;
};

/** Starter diagram with a Redis cache spliced between the function and the service. */
export const starterWithCache = (): ArchModel => {
  const model = starter();
  const fn = nodeOfType(model, "function");
  const service = nodeOfType(model, "service");
  const redis = createNode("redis", 600, 200);
  model.nodes.push(redis);
  const direct = model.edges.find((e) => e.from === fn.id && e.to === service.id);
  if (!direct) throw new Error("starter edge missing");
  direct.to = redis.id;
  model.edges.push(createEdge(redis.id, service.id));
  normalize(model);
  return model;
};

export const traceViewFor = (
  model: ArchModel,
  overrides: Partial<TraceView> & { options?: TraceOptions } = {},
): TraceView => {
  const comp = nodeOfType(model, "component");
  const { options, ...rest } = overrides;
  const session = createTraceSession();
  const cold = runTrace(model, comp.id, {}, session);
  const result = options?.warm ? runTrace(model, comp.id, { warm: true }, session) : cold;
  return { compId: comp.id, only: "", warm: !!options?.warm, index: 0, playing: false, result, ...rest };
};

export const createApi = (model: ArchModel, overrides: Partial<ArchApi> = {}): ArchApi => ({
  model,
  flow: simulate(model),
  selection: NO_SELECTION,
  endpointFocus: null,
  scope: null,
  trace: null,
  commit: vi.fn(),
  edgeById: (id) => model.edges.find((e) => e.id === id),
  groupById: (id) => model.groups.find((g) => g.id === id),
  select: vi.fn(),
  focusEndpoint: vi.fn(),
  reveal: vi.fn(),
  openDetail: vi.fn(),
  openFlow: vi.fn(),
  openModal: vi.fn(),
  closeModal: vi.fn(),
  confirm: vi.fn(),
  notify: vi.fn(),
  undo: vi.fn(),
  connect: vi.fn(),
  insertOnEdge: vi.fn(),
  flipEdge: vi.fn(),
  askDeleteEdge: vi.fn(),
  askDeleteSelection: vi.fn(),
  groupSelected: vi.fn(),
  ungroup: vi.fn(),
  addFunctionTo: vi.fn(),
  startTrace: vi.fn(),
  closeTrace: vi.fn(),
  traceGo: vi.fn(),
  traceTogglePlay: vi.fn(),
  traceSetWarm: vi.fn(),
  traceSetOnly: vi.fn(),
  ...overrides,
});

export const renderWithArch = (ui: ReactElement, model: ArchModel = starter(), overrides: Partial<ArchApi> = {}) => {
  const api = createApi(model, overrides);
  const result = render(<ArchContext.Provider value={api}>{ui}</ArchContext.Provider>);
  return { api, model, ...result };
};
