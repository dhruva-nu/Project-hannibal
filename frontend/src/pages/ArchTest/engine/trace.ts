import { getPath, isObject, pj } from "./json";
import { attachedFns, isContainer, isDbNode, node, outE } from "./model";
import { applyEdge, applyMap, expectedFor, shapeDiff } from "./payload";
import { buildQuery, runQuery, shapeConnector } from "./query";
import { REG } from "./registry";
import type {
  ApiNode,
  ArchModel,
  ArchNode,
  ComponentNode,
  ConnectorNode,
  EdgeLike,
  FunctionCfg,
  FunctionNode,
  InfraNode,
  Params,
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
  connection: { connectorId: string; params: Params } | null;
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
  const source = node(model, id);
  const direct = outE(model, id)
    .map((e) => ({ e: e as EdgeLike, t: node(model, e.to) }))
    .filter((x): x is Target => !!x.t && x.t.type !== "component" && x.t.type !== "state");
  if (direct.length || !isContainer(source)) return direct;
  return model.nodes
    .filter((c) => c.parent === id && (c.type === "api" || isContainer(c)))
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

const requestTitle = (n: ArchNode): string => {
  switch (n.type) {
    case "function":
      return n.cfg.trigger + " fires " + n.name;
    case "api":
      return n.cfg.method + " " + n.cfg.path + " receives the request";
    case "connector":
      return "Connector builds the query";
    case "sqldb":
    case "nosql":
      return "Database executes the query";
    default: {
      const behaviour = REG[n.type].beh;
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
    case "api":
      return "Responds with HTTP " + (meta.status || 200);
    case "connector":
      return "Connector returns the result";
    case "sqldb":
    case "nosql":
      return "Rows returned" + (meta.rows !== undefined ? " (" + meta.rows + ")" : "");
    default:
      if (REG[n.type].beh === "cache") {
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

const forwardAll = (ctx: TraceContext, from: ArchNode, payload: unknown, only?: string): ForwardResult[] => {
  let targets = targetsOf(ctx.model, from.id);
  if (only) targets = targets.filter((x) => x.t.id === only);
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
  const out = fn.cfg.output && fn.cfg.output.trim() ? pj(fn.cfg.output, req) : req;
  requestStep.meta.notes.push(functionLifecycleNote(fn.cfg));
  const resp = combine(forwardAll(ctx, fn, out));
  meta.writes = fn.cfg.writes.map((w) => ({
    varId: w.varId,
    value: w.from ? getPath(resp, w.from) : resp,
    by: fn.name,
  }));
  return resp;
};

const notFoundBody = (api: ApiNode): unknown => {
  const declared = api.cfg.responses.find((r) => +r.status === 404);
  return declared ? pj(declared.body, { error: "Not found" }) : { error: "Not found" };
};

const callApi = (env: CallEnv, api: ApiNode): unknown => {
  const { ctx, req, requestStep, meta } = env;
  const results = forwardAll(ctx, api, req);
  const named: Record<string, unknown> = {};
  results.forEach((r) => {
    named[r.node.name] = r.resp;
  });
  let status = 200;
  let body: unknown;
  if (results.length) {
    let root = combine(results);
    if (api.cfg.single && Array.isArray(root)) root = root.length ? root[0] : null;
    if (api.cfg.single && (root === null || root === undefined)) {
      status = 404;
      body = notFoundBody(api);
    } else {
      const template = pj(api.cfg.responseMap, null);
      body = template ? applyMap(template, root, named) : root;
    }
  } else {
    const sample = api.cfg.responses.find((r) => +r.status >= 200 && +r.status < 300) ?? api.cfg.responses[0];
    body = sample ? pj(sample.body, {}) : {};
    status = sample ? +sample.status : 200;
    requestStep.meta.notes.push("No connector attached, returning the sample response");
  }
  meta.status = status;
  if (api.cfg.headers.length) requestStep.meta.notes.push("Headers: " + api.cfg.headers.map((h) => h.k).join(", "));
  return body;
};

const callConnector = (env: CallEnv, connector: ConnectorNode): unknown => {
  const { ctx, requestStep, meta } = env;
  const params = (env.req || {}) as Params;
  const built = buildQuery(ctx.model, connector, params);
  requestStep.meta.sql = built.sql;
  const previousConnection = ctx.connection;
  ctx.connection = { connectorId: connector.id, params };
  let rows: unknown;
  if (targetsOf(ctx.model, connector.id).length) {
    rows = combine(forwardAll(ctx, connector, { sql: built.sql, params: built.binds.map((b) => b.value) }));
  } else {
    rows = runQuery(ctx.model, connector, params).rows;
    requestStep.meta.notes.push("No database connection drawn, ran the query directly");
  }
  ctx.connection = previousConnection;
  if (!Array.isArray(rows)) rows = [];
  if (connector.cfg.q.nest) {
    const tables = connector.cfg.q.tables;
    meta.notes = ["Nested " + (tables.slice(1).join(", ") || "rows") + " under each " + (tables[0] || "row")];
  }
  return shapeConnector(ctx.model, connector, rows);
};

const callDatabase = (env: CallEnv): unknown => {
  const { ctx, requestStep, meta } = env;
  const connectorNode = ctx.connection ? node(ctx.model, ctx.connection.connectorId) : undefined;
  if (!ctx.connection || connectorNode?.type !== "connector") {
    requestStep.meta.notes.push("Reached directly, not through a connector");
    return { ok: true };
  }
  const { params } = ctx.connection;
  const result = runQuery(ctx.model, connectorNode, params);
  meta.rows = result.rows.length;
  requestStep.meta.sql = buildQuery(ctx.model, connectorNode, params).sql;
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
  return combine(forwardAll(ctx, infra, req, picked.id));
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
  if (n.type === "api") return callApi(env, n);
  if (n.type === "connector") return callConnector(env, n);
  if (isDbNode(n)) return callDatabase(env);
  const behaviour = REG[n.type].beh;
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
  const expected = expectedFor(n);
  const requestStep = pushStep(ctx, {
    dir: "req",
    node: n.id,
    edge: inEdge?.id ?? null,
    payload: req,
    title: requestTitle(n),
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
  const found = node(model, id);
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
  };
  const initialOutput = pj(component.cfg.output, {});
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
  let functions = attachedFns(model, componentId);
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
  const expected = pj(component.cfg.input, null);
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
