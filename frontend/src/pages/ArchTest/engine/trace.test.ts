import { afterEach, describe, expect, it, vi } from "vitest";
import { clone } from "./json";
import { createTraceSession, resolveEndpoint, runTrace, targetsOf } from "./trace";
import {
  GET_USER_ENDPOINT,
  LIST_USERS_ENDPOINT,
  addNode,
  addService,
  byName,
  endpointOf,
  link,
  removeEdgeBetween,
  sampleOnlyEndpoint,
  starterModel,
  starterService,
} from "./testFixtures";
import type {
  ArchModel,
  ComponentNode,
  FunctionNode,
  InfraNode,
  PlacedNode,
  TraceResult,
  TraceStep,
} from "./types";

const trace = (model: ArchModel, options = {}, session = createTraceSession()): TraceResult =>
  runTrace(model, byName(model, "UserProfile").id, options, session);

const titles = (result: TraceResult) => result.steps.map((s) => (s.dir === "req" ? "→ " : "← ") + s.title);

const stepOf = (result: TraceResult, node: PlacedNode, dir: TraceStep["dir"] = "req") =>
  result.steps.find((s) => s.node === node.id && s.dir === dir);

const serviceResponse = (result: TraceResult) => result.steps.find((s) => s.title.startsWith("Responds"));

const fetchUser = (model: ArchModel) => byName<FunctionNode>(model, "fetchUser");

const insertBetween = (model: ArchModel, from: PlacedNode, to: PlacedNode, middle: PlacedNode) => {
  const original = model.edges.find((e) => e.from === from.id && e.to === to.id);
  removeEdgeBetween(model, from, to);
  link(model, from, middle);
  link(model, middle, to, original?.map ?? []);
};

const insertBeforeService = (model: ArchModel, middle: PlacedNode) =>
  insertBetween(model, fetchUser(model), starterService(model), middle);

afterEach(() => vi.restoreAllMocks());

describe("starter trace", () => {
  it("walks component, function, service and database and back", () => {
    const model = starterModel();
    const result = trace(model);
    expect(titles(result)).toEqual([
      "→ User interaction on UserProfile",
      "→ On Load fires fetchUser",
      "→ User service handles GET /users/:id",
      "→ Database executes the query",
      "← Rows returned (2)",
      "← Responds with HTTP 200",
      "← Response received, state updated",
      "← Client receives the response and renders",
    ]);
    expect(result.steps.map((s) => s.i)).toEqual([...result.steps.keys()]);
    expect(result.fnOrder).toEqual([{ id: fetchUser(model).id, name: "fetchUser", trigger: "On Load" }]);
    const last = result.steps[result.steps.length - 1];
    expect(last.payload).toEqual({
      user: { id: 1, name: "Ada Lovelace", email: "ada@example.com" },
      orders: [
        { id: 101, total: 42.5, status: "paid" },
        { id: 102, total: 19.99, status: "shipped" },
      ],
    });
    expect(last.warns).toEqual([]);
    expect(last.meta.writes?.map((w) => w.varId)).toEqual(["v_user", "v_orders"]);
    expect(result.writes.map((w) => w.stepI)).toEqual([6, 6]);
  });

  it("records what each starter step sent and noted", () => {
    const result = trace(starterModel());
    const [component, fn, service, dbRequest, , serviceReply] = result.steps;
    expect(component.meta.notes).toEqual(["Shows a user and their recent orders"]);
    expect(fn.payload).toEqual({ userId: 1 });
    expect(fn.meta.pre).toBeUndefined();
    expect(fn.meta.notes).toEqual(["Runs each time the component mounts"]);
    expect(service.payload).toEqual({ id: 1, includeOrders: true });
    expect(service.meta.pre).toEqual({ userId: 1 });
    expect(service.meta.notes).toEqual(["Headers: Authorization"]);
    expect(service.meta.endpoint).toBe(GET_USER_ENDPOINT);
    expect(service.meta.sql).toContain("LEFT JOIN orders");
    expect(dbRequest.payload).toEqual({ sql: service.meta.sql, params: [1] });
    expect(dbRequest.meta.sql).toBe(service.meta.sql);
    expect(serviceReply.meta).toMatchObject({ status: 200, endpoint: GET_USER_ENDPOINT });
    expect(serviceReply.meta.notes).toEqual(["Nested orders under each users"]);
  });

  it("flags a schema mismatch on the final response", () => {
    const model = starterModel();
    byName<ComponentNode>(model, "UserProfile").cfg.input = '{"user":{"id":1},"extra":"x","orders":[{"id":"s"}]}';
    const warns = trace(model).steps.at(-1)?.warns;
    expect(warns).toEqual([
      { path: "extra", kind: "missing", exp: "string" },
      { path: "orders[0].id", kind: "type", exp: "string", act: "number" },
    ]);
  });

  it("flags request mismatches against the called endpoint", () => {
    const model = starterModel();
    fetchUser(model).cfg.output = '{"userId":"abc"}';
    const serviceStep = trace(model).steps[2];
    expect(serviceStep.warns).toEqual([{ path: "id", kind: "type", exp: "number", act: "string" }]);
  });

  it("records component state writes to local state and the store", () => {
    const model = starterModel();
    const component = byName<ComponentNode>(model, "UserProfile");
    component.cfg.writes = [
      { varId: "v_loading", from: "" },
      { varId: "v_user", from: "userId" },
    ];
    const result = trace(model);
    expect(result.writes.slice(0, 2)).toEqual([
      { varId: "v_loading", value: { userId: 1 }, by: "UserProfile", stepI: 0 },
      { varId: "v_user", value: 1, by: "UserProfile", stepI: 0 },
    ]);
  });

  it("handles components without a description", () => {
    const model = starterModel();
    byName<ComponentNode>(model, "UserProfile").cfg.desc = "";
    expect(trace(model).steps[0].meta.notes).toEqual([""]);
  });

  it("rejects non-components", () => {
    const model = starterModel();
    expect(() => runTrace(model, starterService(model).id, {}, createTraceSession())).toThrow("not a component");
    expect(() => runTrace(model, "ghost", {}, createTraceSession())).toThrow("not a component");
  });

  it("filters to one function and reports components without requests", () => {
    const model = starterModel();
    const component = byName<ComponentNode>(model, "UserProfile");
    const other = addNode<FunctionNode>(model, "function", "other", { trigger: "Polling", interval: 250 });
    link(model, component, other);
    const only = trace(model, { only: other.id });
    expect(only.fnOrder.map((f) => f.name)).toEqual(["fetchUser", "other"]);
    expect(titles(only).slice(1, 3)).toEqual(["→ Polling fires other", "← Response received, state updated"]);
    expect(only.steps[1].meta.notes).toEqual(["Repeats every 250 ms"]);
    const lonely = runTrace(model, addNode<ComponentNode>(model, "component", "Lonely").id, {}, createTraceSession());
    expect(titles(lonely)).toEqual(["→ User interaction on Lonely", "← No request leaves this component"]);
    expect(lonely.steps[1].payload).toEqual({});
  });

  it("describes every function trigger", () => {
    const model = starterModel();
    const fn = fetchUser(model);
    const note = (trigger: FunctionNode["cfg"]["trigger"]) => {
      fn.cfg.trigger = trigger;
      return trace(model).steps[1].meta.notes[0];
    };
    expect(note("Initial Load")).toBe("Runs once when the app boots");
    expect(note("WebSocket")).toBe("Subscribed to wss://example.com/stream");
    fn.cfg.deps = "";
    expect(note("On Component Change")).toBe("Runs when [no deps set] change");
    fn.cfg.deps = "a, b";
    expect(note("On Component Change")).toBe("Runs when [a, b] change");
  });

  it("uses a function's explicit output and its write paths", () => {
    const model = starterModel();
    const fn = fetchUser(model);
    fn.cfg.output = '{"userId":1,"extra":true}';
    fn.cfg.writes = [{ varId: "v_user", from: "" }];
    const result = trace(model);
    expect(result.steps[2].payload).toMatchObject({ id: 1, extra: true });
    expect(result.writes.at(-1)?.value).toEqual(result.steps.at(-2)?.payload);
  });

  it("forwards the incoming payload when a function's output is blank", () => {
    const model = starterModel();
    fetchUser(model).cfg.output = "   ";
    expect(trace(model).steps[2].payload).toEqual({ id: 1, includeOrders: true });
  });
});

describe("endpoint routing", () => {
  it("only calls the service that owns the function's endpoint", () => {
    const model = starterModel();
    const other = addService(model, "Other service", [sampleOnlyEndpoint('{"other":true}')]);
    link(model, fetchUser(model), other);
    const result = trace(model);
    expect(stepOf(result, other)).toBeUndefined();
    expect(stepOf(result, starterService(model))).toBeDefined();
  });

  it("calls every target when none of them owns the endpoint", () => {
    const model = starterModel();
    const other = addService(model, "Other service", [sampleOnlyEndpoint('{"other":true}')]);
    link(model, fetchUser(model), other);
    fetchUser(model).cfg.endpoint = "ep_unowned";
    const result = trace(model);
    expect(stepOf(result, other)).toBeDefined();
    expect(stepOf(result, starterService(model))?.meta.endpoint).toBe(GET_USER_ENDPOINT);
  });

  it("falls back to the first endpoint when the function has not chosen one", () => {
    const model = starterModel();
    fetchUser(model).cfg.endpoint = "";
    const serviceStep = stepOf(trace(model), starterService(model));
    expect(serviceStep?.meta.endpoint).toBe(GET_USER_ENDPOINT);
    expect(serviceStep?.meta.notes).toEqual([
      "The calling function has not chosen an endpoint, using the first",
      "Headers: Authorization",
    ]);
  });

  it("resolves an endpoint by id, falling back to the first one", () => {
    const service = starterService(starterModel());
    expect(resolveEndpoint(service, LIST_USERS_ENDPOINT)?.id).toBe(LIST_USERS_ENDPOINT);
    expect(resolveEndpoint(service, "ghost")?.id).toBe(GET_USER_ENDPOINT);
    service.cfg.endpoints = [];
    expect(resolveEndpoint(service, GET_USER_ENDPOINT)).toBeUndefined();
  });

  it("answers 404 from a service that has no endpoints", () => {
    const model = starterModel();
    const service = starterService(model);
    service.cfg.endpoints = [];
    const result = trace(model);
    expect(stepOf(result, service)?.title).toBe("User service has no endpoint to handle it");
    expect(stepOf(result, service)?.meta.notes).toEqual(["User service has no endpoints yet"]);
    expect(stepOf(result, service, "res")).toMatchObject({
      title: "Responds with HTTP 404",
      payload: { error: "No endpoint" },
      meta: { status: 404 },
    });
  });
});

describe("service endpoint behaviour", () => {
  const withoutDatabase = () => {
    const model = starterModel();
    endpointOf(model).dbId = "";
    return model;
  };

  it("returns the sample 2xx response when the endpoint queries no database", () => {
    const model = withoutDatabase();
    const endpoint = endpointOf(model);
    const service = starterService(model);
    const result = trace(model);
    expect(stepOf(result, service)?.meta.notes).toContain(
      "This endpoint does not query a database, returning its sample response",
    );
    expect(stepOf(result, service, "res")?.meta.status).toBe(200);
    expect(stepOf(result, service, "res")?.payload).toMatchObject({ user: { id: 1 } });
    endpoint.responses = [{ status: 500, desc: "boom", body: '{"e":1}' }];
    expect(stepOf(trace(model), service, "res")).toMatchObject({ payload: { e: 1 }, meta: { status: 500 } });
    endpoint.responses = [{ status: "", desc: "blank", body: "" }];
    const blankStatus = stepOf(trace(model), service, "res");
    expect(blankStatus?.meta.status).toBe(0);
    expect(blankStatus?.title).toBe("Responds with HTTP 200");
    endpoint.responses = [];
    const empty = stepOf(trace(model), service, "res");
    expect(empty).toMatchObject({ payload: {}, meta: { status: 200 }, title: "Responds with HTTP 200" });
  });

  it("returns the sample response when the endpoint has a database but no table", () => {
    const model = starterModel();
    endpointOf(model).q.tables = [];
    const result = trace(model);
    expect(result.steps.some((s) => s.title === "Database executes the query")).toBe(false);
    expect(serviceResponse(result)?.payload).toMatchObject({ user: { id: 1 } });
  });

  it("answers 404 for an empty single result, using a declared body when present", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.where = [{ field: "users.id", op: "=", value: "999" }];
    const declared = serviceResponse(trace(model));
    expect(declared?.meta.status).toBe(404);
    expect(declared?.payload).toEqual({ error: "User not found" });
    endpoint.responses.pop();
    const generic = serviceResponse(trace(model));
    expect(generic?.payload).toEqual({ error: "Not found" });
    expect(generic?.title).toBe("Responds with HTTP 404");
  });

  it("returns raw rows without a response template and without single", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.responseMap = "";
    endpoint.single = false;
    endpoint.headers = [];
    const result = trace(model);
    expect(Array.isArray(serviceResponse(result)?.payload)).toBe(true);
    expect(stepOf(result, starterService(model))?.meta.notes).toEqual([]);
    endpoint.single = true;
    expect(serviceResponse(trace(model))?.payload).toMatchObject({ id: 1, name: "Ada Lovelace" });
  });

  it("combines responses from several function targets by node name", () => {
    const model = starterModel();
    const audit = addNode<InfraNode>(model, "other", "audit");
    link(model, fetchUser(model), audit);
    const functionReply = stepOf(trace(model), fetchUser(model), "res");
    expect(Object.keys(functionReply?.payload as object)).toEqual(["User service", "audit"]);
    expect((functionReply?.payload as { audit: unknown }).audit).toEqual({ ok: true, handledBy: "audit" });
  });
});

describe("database behaviour", () => {
  it("answers from the first route when a service reaches the same database twice", () => {
    const model = starterModel();
    const database = byName(model, "app_db");
    const proxy = addNode<InfraNode>(model, "gateway", "DB proxy");
    link(model, starterService(model), proxy);
    link(model, proxy, database);
    const result = trace(model);
    const request = stepOf(result, starterService(model));
    expect(serviceResponse(result)?.meta.status).toBe(200);
    expect(request?.meta.notes).toContain("2 routes reach the database, using the rows from app_db");
  });

  it("runs the query directly when no database edge exists", () => {
    const model = starterModel();
    removeEdgeBetween(model, starterService(model), byName(model, "app_db"));
    const result = trace(model);
    expect(stepOf(result, starterService(model))?.meta.notes).toEqual([
      "Headers: Authorization",
      "No connection drawn from User service to the database, ran the query directly",
    ]);
    expect(result.steps.some((s) => s.title.startsWith("Database"))).toBe(false);
    expect(result.steps.at(-1)?.payload).toMatchObject({ user: { id: 1 } });
  });

  it("finds no rows when the route to the database fans out into a combined response", () => {
    const model = starterModel();
    const service = starterService(model);
    const database = byName(model, "app_db");
    const proxy = addNode<InfraNode>(model, "other", "proxy");
    const replica = addNode<InfraNode>(model, "other", "replica proxy");
    removeEdgeBetween(model, service, database);
    link(model, service, proxy);
    link(model, proxy, database);
    link(model, proxy, replica);
    link(model, replica, database);
    const result = trace(model);
    expect(stepOf(result, proxy, "res")?.payload).toMatchObject({ app_db: expect.any(Array), "replica proxy": expect.any(Array) });
    expect(serviceResponse(result)?.meta.status).toBe(404);
  });

  it("only sends the query along routes that reach the endpoint's database", () => {
    const model = starterModel();
    const service = starterService(model);
    const unrelated = addNode<InfraNode>(model, "s3", "bucket");
    const proxy = addNode<InfraNode>(model, "other", "proxy");
    link(model, service, unrelated);
    removeEdgeBetween(model, service, byName(model, "app_db"));
    link(model, service, proxy);
    link(model, proxy, byName(model, "app_db"));
    const result = trace(model);
    expect(stepOf(result, unrelated)).toBeUndefined();
    expect(stepOf(result, proxy)?.title).toBe("Request passes through proxy");
    expect(result.steps.at(-1)?.payload).toMatchObject({ user: { id: 1 } });
  });

  it("does not nest when nesting is off and reports a missing table", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.nest = false;
    endpoint.single = false;
    endpoint.responseMap = "";
    const flatResult = serviceResponse(trace(model));
    expect(flatResult?.meta.notes).toEqual([]);
    expect(Array.isArray(flatResult?.payload)).toBe(true);
    endpoint.q.tables = ["ghost"];
    endpoint.q.where = [];
    const result = trace(model);
    expect(serviceResponse(result)?.payload).toEqual([]);
    expect(result.steps.find((s) => s.title.startsWith("Rows returned"))?.title).toBe("Rows returned (0)");
    expect(result.steps.find((s) => s.title === "Database executes the query")?.meta.notes).toEqual([
      "No table selected",
    ]);
  });

  it("names the nesting after the queried tables, with generic fallbacks", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.tables = ["users"];
    expect(serviceResponse(trace(model))?.meta.notes).toEqual(["Nested rows under each users"]);
    endpoint.q.tables = [""];
    expect(serviceResponse(trace(model))?.meta.notes).toEqual(["Nested rows under each row"]);
  });

  it("queries with empty parameters when the request payload is falsy", () => {
    const model = starterModel();
    fetchUser(model).cfg.output = "0";
    const result = trace(model);
    expect(stepOf(result, starterService(model))?.meta.sql).toContain("WHERE users.id = $1");
    expect(result.steps.at(-1)?.title).toBe("Client receives the response and renders");
  });

  it("reports a database reached without a service endpoint", () => {
    const model = starterModel();
    const direct = link(model, fetchUser(model), byName(model, "app_db"));
    const [request, response] = trace(model).steps.filter((s) => s.edge === direct.id);
    expect(request.meta.notes).toEqual(["Reached directly, not through a service endpoint"]);
    expect(response).toMatchObject({ title: "Rows returned", payload: { ok: true } });
  });
});

describe("caches", () => {
  it("shows a cache miss, then a hit on a warm second run, and never hits in simulation", () => {
    const model = starterModel();
    const cache = addNode<InfraNode>(model, "redis", "cache");
    insertBeforeService(model, cache);
    const session = createTraceSession();
    const ranQuery = (result: TraceResult) => result.steps.some((s) => s.title === "Database executes the query");
    const cold = trace(model, {}, session);
    const miss = stepOf(cold, cache);
    expect(miss?.title).toBe("cache: cache lookup");
    expect(miss?.meta.cache).toBe("MISS");
    expect(stepOf(cold, cache, "res")?.title).toBe("cache: stores the response");
    expect(ranQuery(cold)).toBe(true);
    const warm = trace(model, { warm: true }, session);
    const hit = stepOf(warm, cache);
    expect(hit?.meta.cache).toBe("HIT");
    expect(hit?.meta.notes.at(-1)).toBe("Served from cache, nothing downstream runs");
    expect(stepOf(warm, cache, "res")?.title).toBe("cache: served from cache");
    expect(ranQuery(warm)).toBe(false);
    expect(warm.steps.at(-1)?.payload).toEqual(cold.steps.at(-1)?.payload);
    expect(stepOf(trace(model, {}, session), cache)?.meta.cache).toBe("MISS");
    expect(stepOf(trace(model, { sim: true, warm: true }, session), cache)?.meta.cache).toBe("MISS");
  });

  it("honours forced cache modes", () => {
    const model = starterModel();
    const cache = addNode<InfraNode>(model, "tanstack", "tq");
    insertBeforeService(model, cache);
    cache.cfg.behavior = "always hit";
    const forced = trace(model);
    expect(stepOf(forced, cache)?.meta.cache).toBe("HIT");
    expect(forced.steps.some((s) => s.title === "Database executes the query")).toBe(false);
    expect(forced.steps.at(-1)?.payload).toMatchObject({ user: { id: 1 } });
    cache.cfg.behavior = "always miss";
    expect(stepOf(trace(model, { warm: true }), cache)?.meta.cache).toBe("MISS");
    cache.cfg.behavior = "";
    expect(stepOf(trace(model), cache)?.meta.cache).toBe("MISS");
  });

  it("fills in a handled-by response for caches with nothing downstream", () => {
    const model = starterModel();
    const cache = addNode<InfraNode>(model, "cdn", "edge");
    link(model, fetchUser(model), cache);
    expect(stepOf(trace(model), cache, "res")?.payload).toEqual({ ok: true, handledBy: "edge" });
  });

});

describe("load balancers, gateways and pass-through infrastructure", () => {
  it("balances load round robin across runs and picks randomly on request", () => {
    const model = starterModel();
    const balancer = addNode<InfraNode>(model, "lb", "lb");
    const replica = addService(model, "Replica", clone(starterService(model).cfg.endpoints));
    insertBeforeService(model, balancer);
    link(model, balancer, replica);
    const session = createTraceSession();
    expect(stepOf(trace(model, {}, session), balancer)?.meta.notes).toEqual([
      "Chose User service (round robin, 2 targets)",
    ]);
    const second = trace(model, { warm: true }, session);
    expect(stepOf(second, balancer)?.meta.notes).toEqual(["Chose Replica (round robin, 2 targets)"]);
    expect(stepOf(second, balancer)?.title).toBe("lb: choose a backend");
    expect(stepOf(second, replica)?.meta.endpoint).toBe(GET_USER_ENDPOINT);
    balancer.cfg.algorithm = "random";
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(stepOf(trace(model), balancer)?.meta.notes[0]).toBe("Chose Replica (random, 2 targets)");
  });

  it("answers directly from a load balancer without targets", () => {
    const model = starterModel();
    const balancer = addNode<InfraNode>(model, "lb", "lonely-lb");
    link(model, fetchUser(model), balancer);
    expect(stepOf(trace(model), balancer, "res")?.payload).toEqual({ ok: true, handledBy: "lonely-lb" });
  });

  it("describes gateway checks with and without added headers", () => {
    const model = starterModel();
    const gateway = addNode<InfraNode>(model, "gateway", "gw");
    insertBeforeService(model, gateway);
    const gatewayRequest = () => stepOf(trace(model), gateway);
    expect(gatewayRequest()?.meta.notes[0]).toBe("Authentication: JWT, limit 600 req/min, adds X-Request-Id");
    expect(gatewayRequest()?.title).toBe("gw: auth and rate limit");
    gateway.cfg.headers = "";
    expect(gatewayRequest()?.meta.notes[0]).toBe("Authentication: JWT, limit 600 req/min");
    const dead = addNode<InfraNode>(model, "gateway", "dead-end");
    link(model, fetchUser(model), dead);
    expect(stepOf(trace(model), dead, "res")?.payload).toEqual({ ok: true, handledBy: "dead-end" });
  });

  it("passes through queues, buses and plain infrastructure", () => {
    const model = starterModel();
    const queue = addNode<InfraNode>(model, "queue", "jobs");
    const bus = addNode<InfraNode>(model, "bus", "events");
    insertBeforeService(model, queue);
    link(model, queue, bus);
    const result = trace(model);
    const queueStep = stepOf(result, queue);
    expect(queueStep?.title).toBe("Request passes through jobs");
    expect(queueStep?.meta.notes).toEqual(["Asynchronous hop, the sender does not wait for consumers in a real system"]);
    const busResponse = stepOf(result, bus, "res");
    expect(busResponse?.title).toBe("events: response passes back");
    expect(busResponse?.payload).toEqual({ ok: true, handledBy: "events" });
  });

  it("routes through containers into the services inside them", () => {
    const model = starterModel();
    const service = starterService(model);
    const docker = addNode<InfraNode>(model, "docker", "box", {}, { x: 0, y: 0, w: 900, h: 900 });
    const nested = addNode<InfraNode>(model, "k8s", "cluster");
    const queue = addNode<InfraNode>(model, "queue", "unrelated");
    service.parent = docker.id;
    nested.parent = docker.id;
    queue.parent = docker.id;
    insertBeforeService(model, docker);
    removeEdgeBetween(model, docker, service);
    const targets = targetsOf(model, docker.id);
    expect(targets.map((t) => t.t.name)).toEqual(["User service", "cluster"]);
    expect(targets[0].e).toEqual({ id: null, from: docker.id, to: service.id, map: [] });
    const result = trace(model);
    const containerStep = stepOf(result, docker);
    expect(containerStep?.meta.notes[0]).toBe("box hosts 3 service(s) inside it");
    expect(containerStep?.edge).not.toBeNull();
    expect(stepOf(result, service)).toBeDefined();
  });

  it("never targets components", () => {
    const model = starterModel();
    const lonely = addNode<ComponentNode>(model, "component", "Lonely");
    link(model, fetchUser(model), lonely);
    expect(targetsOf(model, fetchUser(model).id).map((t) => t.t.name)).toEqual(["User service"]);
  });

  it("stops runaway cycles", () => {
    const model = starterModel();
    const a = addNode<InfraNode>(model, "other", "a");
    const b = addNode<InfraNode>(model, "other", "b");
    link(model, fetchUser(model), a);
    link(model, a, b);
    link(model, b, a);
    const result = trace(model);
    expect(result.steps.some((s) => JSON.stringify(s.payload).includes("Trace too deep"))).toBe(true);
    expect(result.steps.length).toBeLessThan(200);
  });

  it("merges direct component targets with function results", () => {
    const model = starterModel();
    const extra = addNode<InfraNode>(model, "other", "extra");
    link(model, byName(model, "UserProfile"), extra);
    expect(trace(model).steps.at(-1)?.payload).toMatchObject({ user: { id: 1 }, ok: true, handledBy: "extra" });
  });

  it("keeps a non-object response as the merged result", () => {
    const model = starterModel();
    const component = byName(model, "UserProfile");
    const endpoint = endpointOf(model);
    endpoint.single = false;
    endpoint.responseMap = "";
    removeEdgeBetween(model, component, fetchUser(model));
    link(model, component, addService(model, "rows", [sampleOnlyEndpoint("[1,2]")]));
    expect(trace(model).steps.at(-1)?.payload).toEqual([1, 2]);
    link(model, component, starterService(model));
    expect(trace(model).steps.at(-1)?.payload).toEqual([1, 2]);
  });
});
