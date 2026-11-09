import { getPath, isObject, parseJsonOr } from "./json";
import { attachedFunctions, endpointLabel, isContainer, isDbNode, findNode, outgoingEdges, reachableNodes, sourceDb } from "./model";
import { applyEdge, applyMap, expectedFor, shapeDiff } from "./payload";
import { runQuery, shapeRows } from "./query";
import { buildQuery } from "./queryText";
import { NODE_REGISTRY } from "./registry";
import type {
  ArchModel,
  ArchNode,
  ComponentNode,
  EdgeLike,
  Endpoint,
  FunctionCfg,
  FunctionNode,
  InfraNode,
  Params,
  QuerySource,
  Row,
  ServiceNode,
  StateWrite,
  StepMeta,
  TraceOptions,
  TraceResult,
  TraceSession,
  TraceStep,
} from "./types";

const MAX_TRACE_DEPTH = 30;
const MAX_KEY_PREVIEW = 120;

export const createTraceSession = (): TraceSession => ({ cacheStore: {}, roundRobin: {} });

interface TraceContext {
  model: ArchModel;
  session: TraceSession;
  opts: TraceOptions;
  steps: TraceStep[];
  depth: number;
  store: Record<string, unknown>;
  writes: StateWrite[];
  connection: { source: QuerySource; params: Params } | null;
  /** Endpoint the active function calls; services and gateways route by it. */
  endpointId: string;
}

interface Target {
  e: EdgeLike;
  t: ArchNode;
}

interface ForwardResult {
  edge: EdgeLike;
  node: ArchNode;
  resp: unknown;
}

interface ResponseMeta {
  writes?: StateWrite[];
  status?: number;
  rows?: number;
  cache?: "HIT" | "MISS";
  endpoint?: string;
  notes?: string[];
}

interface CallEnv {
  ctx: TraceContext;
  req: unknown;
  requestStep: TraceStep;
  meta: ResponseMeta;
}

type StepDraft = Omit<TraceStep, "i" | "meta"> & { meta?: Partial<StepMeta> };

export const targetsOf = (model: ArchModel, id: string): Target[] => {
  const source = findNode(model, id);
  const direct = outgoingEdges(model, id)
    .map((e) => ({ e: e as EdgeLike, t: findNode(model, e.to) }))
    .filter((x): x is Target => !!x.t && x.t.type !== "component");
  if (direct.length || !isContainer(source)) return direct;
  return model.nodes
    .filter((c) => c.parent === id && (c.type === "service" || isContainer(c)))
    .map((c) => ({ e: { id: null, from: id, to: c.id, map: [] }, t: c }));
};

const pushStep = (ctx: TraceContext, draft: StepDraft): TraceStep => {
  const step: TraceStep = {
    ...draft,
    i: ctx.steps.length,
    meta: { ...draft.meta, notes: draft.meta?.notes ?? [] },
  };
  ctx.steps.push(step);
  return step;
};

const requestTitle = (n: ArchNode, endpoint: Endpoint | undefined): string => {
  switch (n.type) {
    case "function":
      return n.cfg.trigger + " fires " + n.name;
    case "service":
      return endpoint ? n.name + " handles " + endpointLabel(endpoint) : n.name + " has no endpoint to handle it";
    case "sqldb":
    case "nosql":
      return "Database executes the query";
    default: {
      const behaviour = NODE_REGISTRY[n.type].beh;
      if (behaviour === "cache") return n.name + ": cache lookup";
      if (behaviour === "lb") return n.name + ": choose a backend";
      if (behaviour === "gateway") return n.name + ": auth and rate limit";
      return "Request passes through " + n.name;
    }
  }
};

const responseTitle = (n: ArchNode, meta: ResponseMeta): string => {
  switch (n.type) {
    case "function":
      return "Response received, state updated";
    case "service":
      return "Responds with HTTP " + (meta.status || 200);
    case "sqldb":
    case "nosql":
      return "Rows returned" + (meta.rows !== undefined ? " (" + meta.rows + ")" : "");
    default:
      if (NODE_REGISTRY[n.type].beh === "cache") {
        return n.name + (meta.cache === "HIT" ? ": served from cache" : ": stores the response");
      }
      return n.name + ": response passes back";
  }
};

const combine = (results: ForwardResult[]): unknown => {
  if (!results.length) return undefined;
  if (results.length === 1) return results[0].resp;
  const combined: Record<string, unknown> = {};
  results.forEach((r) => {
    combined[r.node.name] = r.resp;
  });
  return combined;
};

const ownsEndpoint = (n: ArchNode, endpointId: string): boolean =>
  n.type === "service" && n.cfg.endpoints.some((e) => e.id === endpointId);

const routeToEndpoint = (ctx: TraceContext, targets: Target[]): Target[] => {
  if (!ctx.endpointId || !targets.some((x) => ownsEndpoint(x.t, ctx.endpointId))) return targets;
  return targets.filter((x) => x.t.type !== "service" || ownsEndpoint(x.t, ctx.endpointId));
};

const forwardAll = (
  ctx: TraceContext,
  from: ArchNode,
  payload: unknown,
  keep: (target: Target) => boolean = () => true,
): ForwardResult[] => {
  const targets = routeToEndpoint(ctx, targetsOf(ctx.model, from.id)).filter(keep);
  return targets.map((x) => ({
    edge: x.e,
    node: x.t,
    resp: call(ctx, x.t, x.e, applyEdge(x.e, payload), payload),
  }));
};

const functionLifecycleNote = (cfg: FunctionCfg): string => {
  switch (cfg.trigger) {
    case "Polling":
      return "Repeats every " + cfg.interval + " ms";
    case "WebSocket":
      return "Subscribed to " + cfg.url;
    case "On Component Change":
      return "Runs when [" + (cfg.deps || "no deps set") + "] change";
    case "Initial Load":
      return "Runs once when the app boots";
    default:
      return "Runs each time the component mounts";
  }
};

const callFunction = (env: CallEnv, fn: FunctionNode): unknown => {
  const { ctx, req, requestStep, meta } = env;
  const out = fn.cfg.output && fn.cfg.output.trim() ? parseJsonOr(fn.cfg.output, req) : req;
  requestStep.meta.notes.push(functionLifecycleNote(fn.cfg));
  const previousEndpoint = ctx.endpointId;
  ctx.endpointId = fn.cfg.endpoint;
  const resp = combine(forwardAll(ctx, fn, out));
  ctx.endpointId = previousEndpoint;
  meta.writes = fn.cfg.writes.map((w) => ({
    varId: w.varId,
    value: w.from ? getPath(resp, w.from) : resp,
    by: fn.name,
  }));
  return resp;
};

const notFoundBody = (endpoint: Endpoint): unknown => {
  const declared = endpoint.responses.find((r) => +r.status === 404);
  return declared ? parseJsonOr(declared.body, { error: "Not found" }) : { error: "Not found" };
};

export const resolveEndpoint = (service: ServiceNode, endpointId: string): Endpoint | undefined =>
  service.cfg.endpoints.find((e) => e.id === endpointId) ?? service.cfg.endpoints[0];

const sampleResponse = (env: CallEnv, endpoint: Endpoint): unknown => {
  const sample = endpoint.responses.find((r) => +r.status >= 200 && +r.status < 300) ?? endpoint.responses[0];
  env.meta.status = sample ? +sample.status : 200;
  env.requestStep.meta.notes.push("This endpoint does not query a database, returning its sample response");
  return sample ? parseJsonOr(sample.body, {}) : {};
};

const DB_TYPES: ArchNode["type"][] = ["sqldb", "nosql"];

const leadsToDb = (model: ArchModel, target: Target, dbId: string): boolean =>
  target.t.id === dbId || reachableNodes(model, target.t.id, "fwd", DB_TYPES).some((d) => d.id === dbId);

const queryRows = (env: CallEnv, service: ServiceNode, endpoint: Endpoint, params: Params): Row[] => {
  const { ctx, requestStep } = env;
  const built = buildQuery(ctx.model, endpoint, params);
  requestStep.meta.sql = built.sql;
  const previousConnection = ctx.connection;
  ctx.connection = { source: endpoint, params };
  const query = { sql: built.sql, params: built.binds.map((b) => b.value) };
  const routed = forwardAll(ctx, service, query, (x) => leadsToDb(ctx.model, x, endpoint.dbId));
  ctx.connection = previousConnection;
  if (!routed.length) {
    requestStep.meta.notes.push("No connection drawn from " + service.name + " to the database, ran the query directly");
    return runQuery(ctx.model, endpoint, params).rows;
  }
  if (routed.length > 1) {
    requestStep.meta.notes.push(routed.length + " routes reach the database, using the rows from " + routed[0].node.name);
  }
  const rows = routed[0].resp;
  return Array.isArray(rows) ? (rows as Row[]) : [];
};

const shapeResponse = (env: CallEnv, endpoint: Endpoint, rows: Row[]): unknown => {
  let root: unknown = shapeRows(env.ctx.model, endpoint, rows);
  if (endpoint.q.nest) {
    const tables = endpoint.q.tables;
    env.meta.notes = ["Nested " + (tables.slice(1).join(", ") || "rows") + " under each " + (tables[0] || "row")];
  }
  if (endpoint.single && Array.isArray(root)) root = root.length ? root[0] : null;
  if (endpoint.single && (root === null || root === undefined)) {
    env.meta.status = 404;
    return notFoundBody(endpoint);
  }
  env.meta.status = 200;
  const template = parseJsonOr(endpoint.responseMap, null);
  return template ? applyMap(template, root, {}) : root;
};

const callService = (env: CallEnv, service: ServiceNode): unknown => {
  const { ctx, requestStep, meta } = env;
  const endpoint = resolveEndpoint(service, ctx.endpointId);
  if (!endpoint) {
    meta.status = 404;
    requestStep.meta.notes.push(service.name + " has no endpoints yet");
    return { error: "No endpoint" };
  }
  requestStep.meta.endpoint = meta.endpoint = endpoint.id;
  if (!ctx.endpointId) requestStep.meta.notes.push("The calling function has not chosen an endpoint, using the first");
  if (endpoint.headers.length) requestStep.meta.notes.push("Headers: " + endpoint.headers.map((h) => h.k).join(", "));
  if (!sourceDb(ctx.model, endpoint) || !endpoint.q.tables.length) return sampleResponse(env, endpoint);
  const params = (env.req || {}) as Params;
  return shapeResponse(env, endpoint, queryRows(env, service, endpoint, params));
};

const callDatabase = (env: CallEnv): unknown => {
  const { ctx, requestStep, meta } = env;
  if (!ctx.connection) {
    requestStep.meta.notes.push("Reached directly, not through a service endpoint");
    return { ok: true };
  }
  const { source, params } = ctx.connection;
  const result = runQuery(ctx.model, source, params);
  meta.rows = result.rows.length;
  requestStep.meta.sql = buildQuery(ctx.model, source, params).sql;
  if (result.error) requestStep.meta.notes.push(result.error);
  return result.rows;
};

const cacheMode = (infra: InfraNode): string => String(infra.cfg.behavior || "auto");

const callCache = (env: CallEnv, infra: InfraNode): unknown => {
  const { ctx, req, requestStep, meta } = env;
  const key = infra.id + "|" + JSON.stringify(req);
  const mode = cacheMode(infra);
  const hit = !ctx.opts.sim && (mode === "always hit" ? true : mode === "always miss" ? false : key in ctx.store);
  requestStep.meta.notes.push("Key: " + key.slice(key.indexOf("|") + 1).slice(0, MAX_KEY_PREVIEW));
  if (hit) {
    if (!(key in ctx.store)) {
      const savedSteps = ctx.steps;
      ctx.steps = [];
      ctx.store[key] = combine(forwardAll(ctx, infra, req));
      ctx.steps = savedSteps;
    }
    requestStep.meta.cache = meta.cache = "HIT";
    requestStep.meta.notes.push("Served from cache, nothing downstream runs");
    return ctx.store[key];
  }
  requestStep.meta.cache = meta.cache = "MISS";
  const resp = combine(forwardAll(ctx, infra, req));
  ctx.store[key] = resp;
  return resp === undefined ? { ok: true, handledBy: infra.name } : resp;
};

const nextLoadBalancerIndex = (ctx: TraceContext, infra: InfraNode, targetCount: number): number => {
  if (infra.cfg.algorithm === "random") return Math.floor(Math.random() * targetCount);
  const counter = ctx.session.roundRobin[infra.id] || 0;
  ctx.session.roundRobin[infra.id] = counter + 1;
  return counter % targetCount;
};

const callLoadBalancer = (env: CallEnv, infra: InfraNode): unknown => {
  const { ctx, req, requestStep } = env;
  const targets = targetsOf(ctx.model, infra.id);
  if (!targets.length) return { ok: true, handledBy: infra.name };
  const picked = targets[nextLoadBalancerIndex(ctx, infra, targets.length)].t;
  requestStep.meta.notes.push(
    "Chose " + picked.name + " (" + infra.cfg.algorithm + ", " + targets.length + " targets)",
  );
  return combine(forwardAll(ctx, infra, req, (x) => x.t.id === picked.id));
};

const callGateway = (env: CallEnv, infra: InfraNode): unknown => {
  const { ctx, req, requestStep } = env;
  requestStep.meta.notes.push(
    "Authentication: " +
      infra.cfg.auth +
      ", limit " +
      infra.cfg.rate +
      " req/min" +
      (infra.cfg.headers ? ", adds " + infra.cfg.headers : ""),
  );
  const resp = combine(forwardAll(ctx, infra, req));
  return resp === undefined ? { ok: true, handledBy: infra.name } : resp;
};

const callPassThrough = (env: CallEnv, n: ArchNode): unknown => {
  const { ctx, req, requestStep } = env;
  if (isContainer(n)) {
    requestStep.meta.notes.push(
      n.name + " hosts " + ctx.model.nodes.filter((c) => c.parent === n.id).length + " service(s) inside it",
    );
  }
  if (n.type === "queue" || n.type === "bus") {
    requestStep.meta.notes.push("Asynchronous hop, the sender does not wait for consumers in a real system");
  }
  const results = forwardAll(ctx, n, req);
  return results.length ? combine(results) : { ok: true, handledBy: n.name };
};

const dispatchCall = (env: CallEnv, n: ArchNode): unknown => {
  if (n.type === "function") return callFunction(env, n);
  if (n.type === "service") return callService(env, n);
  if (isDbNode(n)) return callDatabase(env);
  const behaviour = NODE_REGISTRY[n.type].beh;
  if (behaviour === "cache") return callCache(env, n as InfraNode);
  if (behaviour === "lb") return callLoadBalancer(env, n as InfraNode);
  if (behaviour === "gateway") return callGateway(env, n as InfraNode);
  return callPassThrough(env, n);
};

const recordResponse = (ctx: TraceContext, n: ArchNode, inEdge: EdgeLike | null | undefined, resp: unknown, meta: ResponseMeta) => {
  const responseStep = pushStep(ctx, {
    dir: "res",
    node: n.id,
    edge: inEdge?.id ?? null,
    payload: resp,
    title: responseTitle(n, meta),
    warns: [],
    meta: { ...meta, notes: meta.notes ? [...meta.notes] : [] },
  });
  if (meta.writes && meta.writes.length) {
    meta.writes.forEach((w) => {
      w.stepI = responseStep.i;
      ctx.writes.push(w);
    });
  }
};

const call = (
  ctx: TraceContext,
  n: ArchNode,
  inEdge: EdgeLike | null | undefined,
  req: unknown,
  pre?: unknown,
): unknown => {
  if (ctx.depth > MAX_TRACE_DEPTH) return { error: "Trace too deep (cycle?)" };
  ctx.depth++;
  const endpoint = n.type === "service" ? resolveEndpoint(n, ctx.endpointId) : undefined;
  const expected = expectedFor(n, endpoint?.id);
  const requestStep = pushStep(ctx, {
    dir: "req",
    node: n.id,
    edge: inEdge?.id ?? null,
    payload: req,
    title: requestTitle(n, endpoint),
    warns: expected ? shapeDiff(expected, req) : [],
    meta: { pre: pre !== undefined && JSON.stringify(pre) !== JSON.stringify(req) ? pre : undefined },
  });
  const meta: ResponseMeta = {};
  const resp = dispatchCall({ ctx, req, requestStep, meta }, n);
  recordResponse(ctx, n, inEdge, resp, meta);
  ctx.depth--;
  return resp;
};

const mergeResponses = (responses: unknown[]): unknown => {
  let merged: unknown;
  responses.forEach((r) => {
    if (isObject(r)) merged = Object.assign((merged as object) || {}, r);
    else if (r !== undefined && merged === undefined) merged = r;
  });
  return merged;
};

const requireComponent = (model: ArchModel, id: string): ComponentNode => {
  const found = findNode(model, id);
  if (found?.type !== "component") throw new Error("Cannot trace " + id + ": not a component");
  return found;
};

export const runTrace = (
  model: ArchModel,
  componentId: string,
  options: TraceOptions,
  session: TraceSession,
): TraceResult => {
  const component = requireComponent(model, componentId);
  if (!options.sim && !options.warm) {
    session.cacheStore = {};
    session.roundRobin = {};
  }
  const ctx: TraceContext = {
    model,
    session,
    opts: options,
    steps: [],
    depth: 0,
    store: options.sim ? {} : session.cacheStore,
    writes: [],
    connection: null,
    endpointId: "",
  };
  const initialOutput = parseJsonOr(component.cfg.output, {});
  const start = pushStep(ctx, {
    dir: "req",
    node: componentId,
    edge: null,
    title: "User interaction on " + component.name,
    payload: initialOutput,
    warns: [],
  });
  start.meta.notes.push(component.cfg.desc || "");
  component.cfg.writes.forEach((w) => {
    ctx.writes.push({
      varId: w.varId,
      value: w.from ? getPath(initialOutput, w.from) : initialOutput,
      by: component.name,
      stepI: 0,
    });
  });
  let functions = attachedFunctions(model, componentId);
  const fnOrder = functions.map((f) => ({ id: f.id, name: f.name, trigger: f.cfg.trigger }));
  if (options.only) functions = functions.filter((f) => f.id === options.only);
  const responses: unknown[] = functions.map((f) => {
    const edge = model.edges.find((x) => x.from === componentId && x.to === f.id);
    return call(ctx, f, edge, applyEdge(edge, initialOutput), initialOutput);
  });
  if (!options.only) {
    targetsOf(model, componentId)
      .filter((x) => x.t.type !== "function")
      .forEach((x) => {
        responses.push(call(ctx, x.t, x.e, applyEdge(x.e, initialOutput), initialOutput));
      });
  }
  const merged = mergeResponses(responses);
  const expected = parseJsonOr(component.cfg.input, null);
  const finalStep = pushStep(ctx, {
    dir: "res",
    node: componentId,
    edge: null,
    title: responses.length ? "Client receives the response and renders" : "No request leaves this component",
    payload: merged === undefined ? {} : merged,
    warns: expected && merged !== undefined ? shapeDiff(expected, merged) : [],
  });
  finalStep.meta.writes = ctx.writes.slice();
  return { steps: ctx.steps, fnOrder, writes: ctx.writes };
};
