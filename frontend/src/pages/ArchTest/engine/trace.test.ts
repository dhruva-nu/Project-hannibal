import { afterEach, describe, expect, it, vi } from "vitest";
import { createTraceSession, runTrace, targetsOf } from "./trace";
import { addNode, byName, link, removeEdgeBetween, starterModel } from "./testFixtures";
import type {
  ApiNode,
  ArchModel,
  ComponentNode,
  ConnectorNode,
  FunctionNode,
  InfraNode,
  PlacedNode,
  TraceResult,
} from "./types";

const trace = (model: ArchModel, options = {}, session = createTraceSession()): TraceResult =>
  runTrace(model, byName(model, "UserProfile").id, options, session);

const titles = (result: TraceResult) => result.steps.map((s) => (s.dir === "req" ? "→ " : "← ") + s.title);

const insertBetween = (model: ArchModel, from: PlacedNode, to: PlacedNode, middle: PlacedNode) => {
  const original = model.edges.find((e) => e.from === from.id && e.to === to.id);
  removeEdgeBetween(model, from, to);
  link(model, from, middle);
  link(model, middle, to, original?.map ?? []);
};

afterEach(() => vi.restoreAllMocks());

describe("starter trace", () => {
  it("walks component, function, api, connector and database and back", () => {
    const model = starterModel();
    const result = trace(model);
    expect(titles(result)).toEqual([
      "→ User interaction on UserProfile",
      "→ On Load fires fetchUser",
      "→ GET /users/:id receives the request",
      "→ Connector builds the query",
      "→ Database executes the query",
      "← Rows returned (2)",
      "← Connector returns the result",
      "← Responds with HTTP 200",
      "← Response received, state updated",
      "← Client receives the response and renders",
    ]);
    expect(result.steps.map((s) => s.i)).toEqual([...result.steps.keys()]);
    expect(result.fnOrder).toEqual([{ id: byName(model, "fetchUser").id, name: "fetchUser", trigger: "On Load" }]);
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
    expect(result.steps[3].meta.sql).toContain("LEFT JOIN orders");
    expect(result.steps[1].meta.pre).toBeUndefined();
    expect(result.steps[1].payload).toEqual({ userId: 1 });
    expect(result.steps[2].payload).toEqual({ id: 1, includeOrders: true });
    expect(result.steps[2].meta.pre).toEqual({ userId: 1 });
    expect(result.steps[1].meta.notes).toEqual(["Runs each time the component mounts"]);
    expect(result.steps[2].meta.notes).toEqual(["Headers: Authorization"]);
    expect(result.steps[7].meta.status).toBe(200);
    expect(result.steps[6].meta.notes).toEqual(["Nested orders under each users"]);
    expect(result.steps[0].meta.notes).toEqual(["Expects a user and their recent orders"]);
    expect(result.writes.map((w) => w.stepI)).toEqual([8, 8]);
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

  it("flags request mismatches on the api step", () => {
    const model = starterModel();
    const fn = byName<FunctionNode>(model, "fetchUser");
    fn.cfg.output = '{"userId":"abc"}';
    const apiStep = trace(model).steps[2];
    expect(apiStep.warns).toEqual([{ path: "id", kind: "type", exp: "number", act: "string" }]);
  });

  it("records component state writes", () => {
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
    expect(() => runTrace(model, byName(model, "Get user").id, {}, createTraceSession())).toThrow("not a component");
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
    const fn = byName<FunctionNode>(model, "fetchUser");
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
    const fn = byName<FunctionNode>(model, "fetchUser");
    fn.cfg.output = '{"userId":1,"extra":true}';
    fn.cfg.writes = [{ varId: "v_user", from: "" }];
    const result = trace(model);
    expect(result.steps[2].payload).toMatchObject({ id: 1, extra: true });
    expect(result.writes.at(-1)?.value).toEqual(result.steps.at(-2)?.payload);
  });
});

describe("api behaviour", () => {
  const withoutConnector = () => {
    const model = starterModel();
    removeEdgeBetween(model, byName(model, "Get user"), byName(model, "userWithOrders"));
    return model;
  };

  it("returns the sample 2xx response when nothing is attached", () => {
    const model = withoutConnector();
    const api = byName<ApiNode>(model, "Get user");
    const result = trace(model);
    expect(result.steps[2].meta.notes).toContain("No connector attached, returning the sample response");
    expect(result.steps[3].meta.status).toBe(200);
    api.cfg.responses = [{ status: 500, desc: "boom", body: '{"e":1}' }];
    expect(trace(model).steps[3].payload).toEqual({ e: 1 });
    expect(trace(model).steps[3].meta.status).toBe(500);
    api.cfg.responses = [{ status: "", desc: "blank", body: "" }];
    const blankStatus = trace(model).steps[3];
    expect(blankStatus.meta.status).toBe(0);
    expect(blankStatus.title).toBe("Responds with HTTP 200");
    api.cfg.responses = [];
    const empty = trace(model).steps[3];
    expect(empty.payload).toEqual({});
    expect(empty.meta.status).toBe(200);
    expect(empty.title).toBe("Responds with HTTP 200");
  });

  it("answers 404 for an empty single result, using a declared body when present", () => {
    const model = starterModel();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    connector.cfg.q.where = [{ field: "users.id", op: "=", value: "999" }];
    const declared = trace(model).steps.find((s) => s.title.startsWith("Responds"));
    expect(declared?.meta.status).toBe(404);
    expect(declared?.payload).toEqual({ error: "User not found" });
    byName<ApiNode>(model, "Get user").cfg.responses.pop();
    const generic = trace(model).steps.find((s) => s.title.startsWith("Responds"));
    expect(generic?.payload).toEqual({ error: "Not found" });
    expect(generic?.title).toBe("Responds with HTTP 404");
  });

  it("returns raw connector rows without a response template and without single", () => {
    const model = starterModel();
    const api = byName<ApiNode>(model, "Get user");
    api.cfg.responseMap = "";
    api.cfg.single = false;
    api.cfg.headers = [];
    const step = trace(model).steps.find((s) => s.title.startsWith("Responds"));
    expect(Array.isArray(step?.payload)).toBe(true);
    expect(trace(model).steps[2].meta.notes).toEqual([]);
    api.cfg.single = true;
    const single = trace(model).steps.find((s) => s.title.startsWith("Responds"));
    expect(single?.payload).toMatchObject({ id: 1, name: "Ada Lovelace" });
  });

  it("combines several downstream responses by node name", () => {
    const model = starterModel();
    const api = byName<ApiNode>(model, "Get user");
    api.cfg.single = false;
    api.cfg.responseMap = '{"both":"$","one":"$userWithOrders","lookup":"$audit.ok"}';
    const audit = addNode<InfraNode>(model, "other", "audit");
    link(model, api, audit);
    const step = trace(model).steps.find((s) => s.title.startsWith("Responds"));
    expect(Object.keys((step?.payload as { both: object }).both)).toEqual(["userWithOrders", "audit"]);
    expect((step?.payload as { lookup: boolean }).lookup).toBe(true);
    expect(Array.isArray((step?.payload as { one: unknown }).one)).toBe(true);
  });
});

describe("connector and database behaviour", () => {
  it("runs the query directly when no database edge exists", () => {
    const model = starterModel();
    removeEdgeBetween(model, byName(model, "userWithOrders"), byName(model, "app_db"));
    const result = trace(model);
    expect(result.steps[3].meta.notes).toEqual(["No database connection drawn, ran the query directly"]);
    expect(result.steps.some((s) => s.title.startsWith("Database"))).toBe(false);
    expect(result.steps.at(-1)?.payload).toMatchObject({ user: { id: 1 } });
  });

  it("does not nest when nesting is off and treats non-array results as empty", () => {
    const model = starterModel();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    connector.cfg.q.nest = false;
    const flatResult = trace(model).steps.find((s) => s.title === "Connector returns the result");
    expect(flatResult?.meta.notes).toEqual([]);
    expect(Array.isArray(flatResult?.payload)).toBe(true);
    connector.cfg.q.tables = ["ghost"];
    connector.cfg.q.where = [];
    const empty = trace(model).steps.find((s) => s.title === "Connector returns the result");
    expect(empty?.payload).toEqual([]);
    const dbStep = trace(model).steps.find((s) => s.title.startsWith("Rows returned"));
    expect(dbStep?.title).toBe("Rows returned (0)");
    expect(trace(model).steps.find((s) => s.title === "Database executes the query")?.meta.notes).toEqual([
      "No table selected",
    ]);
  });

  it("falls back to the first table name when nesting an empty table list", () => {
    const model = starterModel();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    connector.cfg.q.tables = [];
    const note = trace(model).steps.find((s) => s.title === "Connector returns the result")?.meta.notes;
    expect(note).toEqual(["Nested rows under each row"]);
  });

  it("treats a non-database connector target as an empty result", () => {
    const model = starterModel();
    const connector = byName(model, "userWithOrders");
    removeEdgeBetween(model, connector, byName(model, "app_db"));
    link(model, connector, addNode<InfraNode>(model, "other", "not-a-db"));
    const step = trace(model).steps.find((s) => s.title === "Connector returns the result");
    expect(step?.payload).toEqual([]);
  });

  it("runs the connector with empty parameters when the request payload is falsy", () => {
    const model = starterModel();
    byName<FunctionNode>(model, "fetchUser").cfg.output = "0";
    const result = trace(model);
    expect(result.steps.find((s) => s.title === "Connector builds the query")?.meta.sql).toContain("WHERE users.id = $1");
    expect(result.steps.at(-1)?.title).toBe("Client receives the response and renders");
  });

  it("reports a database reached without a connector", () => {
    const model = starterModel();
    const api = byName(model, "Get user");
    removeEdgeBetween(model, api, byName(model, "userWithOrders"));
    link(model, api, byName(model, "app_db"));
    const result = trace(model);
    const dbRequest = result.steps.find((s) => s.title === "Database executes the query");
    expect(dbRequest?.meta.notes).toEqual(["Reached directly, not through a connector"]);
    const dbResponse = result.steps.find((s) => s.title === "Rows returned");
    expect(dbResponse?.payload).toEqual({ ok: true });
  });
});

describe("infrastructure behaviour", () => {
  it("shows a cache miss, then a hit on a warm second run, and never hits in simulation", () => {
    const model = starterModel();
    const cache = addNode<InfraNode>(model, "redis", "cache");
    insertBetween(model, byName(model, "fetchUser"), byName(model, "Get user"), cache);
    const session = createTraceSession();
    const cold = trace(model, {}, session);
    const miss = cold.steps.find((s) => s.node === cache.id && s.dir === "req");
    expect(miss?.title).toBe("cache: cache lookup");
    expect(miss?.meta.cache).toBe("MISS");
    expect(cold.steps.find((s) => s.node === cache.id && s.dir === "res")?.title).toBe("cache: stores the response");
    expect(cold.steps.some((s) => s.title === "Connector builds the query")).toBe(true);
    const warm = trace(model, { warm: true }, session);
    const hit = warm.steps.find((s) => s.node === cache.id && s.dir === "req");
    expect(hit?.meta.cache).toBe("HIT");
    expect(hit?.meta.notes.at(-1)).toBe("Served from cache, nothing downstream runs");
    expect(warm.steps.find((s) => s.node === cache.id && s.dir === "res")?.title).toBe("cache: served from cache");
    expect(warm.steps.some((s) => s.title === "Connector builds the query")).toBe(false);
    expect(warm.steps.at(-1)?.payload).toEqual(cold.steps.at(-1)?.payload);
    const coldAgain = trace(model, {}, session);
    expect(coldAgain.steps.find((s) => s.node === cache.id)?.meta.cache).toBe("MISS");
    const simulated = trace(model, { sim: true, warm: true }, session);
    expect(simulated.steps.find((s) => s.node === cache.id)?.meta.cache).toBe("MISS");
  });

  it("honours forced cache modes", () => {
    const model = starterModel();
    const cache = addNode<InfraNode>(model, "tanstack", "tq");
    insertBetween(model, byName(model, "fetchUser"), byName(model, "Get user"), cache);
    cache.cfg.behavior = "always hit";
    const forced = trace(model);
    expect(forced.steps.find((s) => s.node === cache.id)?.meta.cache).toBe("HIT");
    expect(forced.steps.some((s) => s.title === "Connector builds the query")).toBe(false);
    expect(forced.steps.at(-1)?.payload).toMatchObject({ user: { id: 1 } });
    cache.cfg.behavior = "always miss";
    expect(trace(model, { warm: true }).steps.find((s) => s.node === cache.id)?.meta.cache).toBe("MISS");
    cache.cfg.behavior = "";
    expect(trace(model).steps.find((s) => s.node === cache.id)?.meta.cache).toBe("MISS");
  });

  it("fills in a handled-by response for caches with nothing downstream", () => {
    const model = starterModel();
    const cache = addNode<InfraNode>(model, "cdn", "edge");
    link(model, byName(model, "fetchUser"), cache);
    const result = trace(model);
    expect(result.steps.find((s) => s.node === cache.id && s.dir === "res")?.payload).toEqual({
      ok: true,
      handledBy: "edge",
    });
  });

  it("balances load round robin across runs and picks randomly on request", () => {
    const model = starterModel();
    const balancer = addNode<InfraNode>(model, "lb", "lb");
    const api = byName(model, "Get user");
    const twin = addNode<ApiNode>(model, "api", "Twin");
    insertBetween(model, byName(model, "fetchUser"), api, balancer);
    link(model, balancer, twin);
    const session = createTraceSession();
    const first = trace(model, {}, session);
    expect(first.steps.find((s) => s.node === balancer.id)?.meta.notes).toEqual([
      "Chose Get user (round robin, 2 targets)",
    ]);
    const second = trace(model, { warm: true }, session);
    expect(second.steps.find((s) => s.node === balancer.id)?.meta.notes).toEqual([
      "Chose Twin (round robin, 2 targets)",
    ]);
    expect(second.steps.find((s) => s.node === balancer.id && s.dir === "req")?.title).toBe("lb: choose a backend");
    balancer.cfg.algorithm = "random";
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(trace(model).steps.find((s) => s.node === balancer.id)?.meta.notes[0]).toBe(
      "Chose Twin (random, 2 targets)",
    );
  });

  it("answers directly from a load balancer without targets", () => {
    const model = starterModel();
    const balancer = addNode<InfraNode>(model, "lb", "lonely-lb");
    link(model, byName(model, "fetchUser"), balancer);
    const response = trace(model).steps.find((s) => s.node === balancer.id && s.dir === "res");
    expect(response?.payload).toEqual({ ok: true, handledBy: "lonely-lb" });
  });

  it("describes gateway checks with and without added headers", () => {
    const model = starterModel();
    const gateway = addNode<InfraNode>(model, "gateway", "gw");
    insertBetween(model, byName(model, "fetchUser"), byName(model, "Get user"), gateway);
    const note = () => trace(model).steps.find((s) => s.node === gateway.id && s.dir === "req");
    expect(note()?.meta.notes[0]).toBe("Authentication: JWT, limit 600 req/min, adds X-Request-Id");
    expect(note()?.title).toBe("gw: auth and rate limit");
    gateway.cfg.headers = "";
    expect(note()?.meta.notes[0]).toBe("Authentication: JWT, limit 600 req/min");
    const dead = addNode<InfraNode>(model, "gateway", "dead-end");
    link(model, byName(model, "fetchUser"), dead);
    expect(trace(model).steps.find((s) => s.node === dead.id && s.dir === "res")?.payload).toEqual({
      ok: true,
      handledBy: "dead-end",
    });
  });

  it("passes through queues, buses and plain infrastructure", () => {
    const model = starterModel();
    const queue = addNode<InfraNode>(model, "queue", "jobs");
    const bus = addNode<InfraNode>(model, "bus", "events");
    insertBetween(model, byName(model, "fetchUser"), byName(model, "Get user"), queue);
    link(model, queue, bus);
    const result = trace(model);
    const queueStep = result.steps.find((s) => s.node === queue.id && s.dir === "req");
    expect(queueStep?.title).toBe("Request passes through jobs");
    expect(queueStep?.meta.notes).toEqual([
      "Asynchronous hop, the sender does not wait for consumers in a real system",
    ]);
    const busResponse = result.steps.find((s) => s.node === bus.id && s.dir === "res");
    expect(busResponse?.title).toBe("events: response passes back");
    expect(busResponse?.payload).toEqual({ ok: true, handledBy: "events" });
  });

  it("routes through containers into the services inside them", () => {
    const model = starterModel();
    const api = byName<ApiNode>(model, "Get user");
    const docker = addNode<InfraNode>(model, "docker", "box", {}, { x: 0, y: 0, w: 900, h: 900 });
    const nested = addNode<InfraNode>(model, "k8s", "cluster");
    const queue = addNode<InfraNode>(model, "queue", "unrelated");
    api.parent = docker.id;
    nested.parent = docker.id;
    queue.parent = docker.id;
    insertBetween(model, byName(model, "fetchUser"), api, docker);
    removeEdgeBetween(model, docker, api);
    const targets = targetsOf(model, docker.id);
    expect(targets.map((t) => t.t.name)).toEqual(["Get user", "cluster"]);
    expect(targets[0].e).toEqual({ id: null, from: docker.id, to: api.id, map: [] });
    const result = trace(model);
    const containerStep = result.steps.find((s) => s.node === docker.id && s.dir === "req");
    expect(containerStep?.meta.notes[0]).toBe("box hosts 3 service(s) inside it");
    expect(containerStep?.edge).not.toBeNull();
    expect(result.steps.some((s) => s.node === api.id)).toBe(true);
  });

  it("stops runaway cycles", () => {
    const model = starterModel();
    const a = addNode<InfraNode>(model, "other", "a");
    const b = addNode<InfraNode>(model, "other", "b");
    link(model, byName(model, "fetchUser"), a);
    link(model, a, b);
    link(model, b, a);
    const result = trace(model);
    expect(result.steps.some((s) => JSON.stringify(s.payload).includes("Trace too deep"))).toBe(true);
    expect(result.steps.length).toBeLessThan(200);
  });

  it("merges direct component targets with function results", () => {
    const model = starterModel();
    const component = byName(model, "UserProfile");
    const extra = addNode<InfraNode>(model, "other", "extra");
    link(model, component, extra);
    const result = trace(model);
    expect(result.steps.at(-1)?.payload).toMatchObject({ user: { id: 1 }, ok: true, handledBy: "extra" });
  });

  it("keeps a non-object response as the merged result", () => {
    const model = starterModel();
    const api = byName<ApiNode>(model, "Get user");
    api.cfg.single = false;
    api.cfg.responseMap = "";
    removeEdgeBetween(model, byName(model, "UserProfile"), byName(model, "fetchUser"));
    const rows = addNode<ApiNode>(model, "api", "rows");
    rows.cfg.responses = [{ status: 200, desc: "OK", body: "[1,2]" }];
    link(model, byName(model, "UserProfile"), rows);
    const result = trace(model);
    expect(result.steps.at(-1)?.payload).toEqual([1, 2]);
    link(model, byName(model, "UserProfile"), api);
    expect(trace(model).steps.at(-1)?.payload).toEqual([1, 2]);
  });
});
