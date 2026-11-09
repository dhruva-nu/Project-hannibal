import { describe, expect, it } from "vitest";
import {
  allEndpoints,
  columnRefs,
  allVars,
  assertKnownNodeTypes,
  attachedFunctions,
  callersOf,
  columnNames,
  defaultLayerNodes,
  descendants,
  endpointById,
  endpointLabel,
  findGroup,
  incomingEdges,
  initQuerySource,
  isDbNode,
  createEdge,
  createNode,
  findNode,
  requireNode,
  normalize,
  outgoingEdges,
  reachableNodes,
  readersOf,
  readsOf,
  reparent,
  sourceDb,
  switchEndpointDatabase,
  findTable,
  tableNames,
  tableRows,
  uniqueName,
  varById,
  visibleVarsFor,
  writersOf,
  writesOf,
} from "./model";
import {
  CREATE_USER_ENDPOINT,
  GET_USER_ENDPOINT,
  LIST_USERS_ENDPOINT,
  addNode,
  byName,
  endpointOf,
  link,
  starterModel,
  starterService,
} from "./testFixtures";
import type { ArchModel, ComponentNode, FunctionNode, NosqlNode, ServiceNode, SqlNode } from "./types";

const userProfile = (model: ArchModel) => byName<ComponentNode>(model, "UserProfile");
const fetchUser = (model: ArchModel) => byName<FunctionNode>(model, "fetchUser");
const appDb = (model: ArchModel) => byName<SqlNode>(model, "app_db");

describe("lookups", () => {
  it("finds layer nodes and placed nodes", () => {
    const model = starterModel();
    expect(findNode(model, "L_client")?.type).toBe("layer");
    expect(findNode(model, starterService(model).id)?.name).toBe("User service");
    expect(findNode(model, "nope")).toBeUndefined();
    expect(requireNode(model, "L_client").type).toBe("layer");
    expect(() => requireNode(model, "nope")).toThrow('Node "nope" is not in the diagram');
  });

  it("finds edges and groups", () => {
    const model = starterModel();
    const component = userProfile(model);
    expect(outgoingEdges(model, component.id)).toHaveLength(1);
    expect(incomingEdges(model, component.id)).toHaveLength(0);
    model.groups.push({ id: "g1", name: "G" });
    expect(findGroup(model, "g1")?.name).toBe("G");
    expect(findGroup(model, "g2")).toBeUndefined();
  });

  it("collects nested descendants", () => {
    const model = starterModel();
    const outer = addNode(model, "k8s", "outer");
    const inner = addNode(model, "docker", "inner");
    const leaf = addNode(model, "service", "leaf");
    inner.parent = outer.id;
    leaf.parent = inner.id;
    expect(descendants(model, outer.id)).toEqual([inner.id, leaf.id]);
    expect(descendants(model, leaf.id)).toEqual([]);
  });
});

describe("node factories", () => {
  it("creates the three default layer nodes", () => {
    expect(defaultLayerNodes().map((l) => l.lid)).toEqual(["client", "backend", "db"]);
  });

  it("applies defaults and overrides", () => {
    const plain = createNode("service", 1, 2) as ServiceNode;
    expect(plain.layer).toBe("backend");
    expect(plain.name).toBe("Service");
    expect(plain.cfg.endpoints).toHaveLength(1);
    const custom = createNode("service", 1, 2, {
      id: "x",
      w: 5,
      h: 6,
      name: "N",
      layer: null,
      cfg: { framework: "Express" },
    }) as ServiceNode;
    expect([custom.id, custom.w, custom.h, custom.name, custom.layer, custom.cfg.framework]).toEqual([
      "x",
      5,
      6,
      "N",
      null,
      "Express",
    ]);
    expect(createNode("redis", 0, 0).layer).toBeNull();
  });

  it("creates edges", () => {
    const edge = createEdge("a", "b");
    expect(edge).toMatchObject({ from: "a", to: "b", label: "", map: [] });
  });

  it("makes unique names", () => {
    const model = starterModel();
    expect(uniqueName(model, "Fresh")).toBe("Fresh");
    expect(uniqueName(model, "User service")).toBe("User service 2");
    addNode(model, "service", "User service 2");
    expect(uniqueName(model, "User service")).toBe("User service 3");
  });

  it("rejects node types this version no longer understands", () => {
    expect(() => assertKnownNodeTypes(starterModel().nodes)).not.toThrow();
    expect(() => assertKnownNodeTypes([{ type: "component" }, { type: "api" }])).toThrow('unknown node type "api"');
    expect(() => assertKnownNodeTypes([{ type: "connector" }])).toThrow('unknown node type "connector"');
    expect(() => assertKnownNodeTypes([{ type: "layer" }])).toThrow('unknown node type "layer"');
  });
});

describe("state relationships", () => {
  it("lists store and component variables with their owners", () => {
    const model = starterModel();
    const component = userProfile(model);
    expect(allVars(model).map((v) => [v.name, v.owner])).toEqual([
      ["currentUser", null],
      ["orders", null],
      ["isLoading", component.id],
    ]);
    expect(varById(model, "v_loading")?.owner).toBe(component.id);
    expect(varById(model, "v_user")?.owner).toBeNull();
    expect(varById(model, "ghost")).toBeUndefined();
  });

  it("lists who reads or writes a variable", () => {
    const model = starterModel();
    const service = starterService(model);
    expect(readersOf(model, "v_user").map((n) => n.name)).toEqual(["UserProfile"]);
    expect(writersOf(model, "v_orders").map((n) => n.name)).toEqual(["fetchUser"]);
    expect(readsOf(service)).toEqual([]);
    expect(writesOf(service)).toEqual([]);
    expect(readsOf(model.lnodes[0])).toEqual([]);
  });

  it("shows the store plus the owning component's state to components and their functions", () => {
    const model = starterModel();
    const visibleNames = (n: Parameters<typeof visibleVarsFor>[1]) => visibleVarsFor(model, n).map((v) => v.name);
    const everything = ["currentUser", "orders", "isLoading"];
    const storeOnly = ["currentUser", "orders"];
    expect(visibleNames(userProfile(model))).toEqual(everything);
    expect(visibleNames(fetchUser(model))).toEqual(everything);
    expect(visibleNames(addNode(model, "function", "detached"))).toEqual(storeOnly);
    expect(visibleNames(addNode(model, "component", "Other"))).toEqual(storeOnly);
    expect(visibleNames(starterService(model))).toEqual(storeOnly);
  });

  it("sorts attached functions by trigger then position", () => {
    const model = starterModel();
    const component = userProfile(model);
    const poll = addNode<FunctionNode>(model, "function", "poll", { trigger: "Polling" }, { x: 0, y: 0 });
    const lateLoad = addNode<FunctionNode>(model, "function", "late", { trigger: "On Load" }, { x: 5, y: 500 });
    const rightLoad = addNode<FunctionNode>(model, "function", "right", { trigger: "On Load" }, { x: 900, y: 320 });
    [poll, lateLoad, rightLoad].forEach((f) => link(model, component, f));
    link(model, component, starterService(model));
    const sameRow = fetchUser(model);
    sameRow.y = 320;
    expect(attachedFunctions(model, component.id).map((f) => f.name)).toEqual(["fetchUser", "right", "late", "poll"]);
    rightLoad.y = 320;
    rightLoad.x = 100;
    sameRow.x = 480;
    expect(attachedFunctions(model, component.id)[0].name).toBe("right");
  });

  it("reaches nodes in both directions", () => {
    const model = starterModel();
    const component = userProfile(model);
    expect(reachableNodes(model, component.id, "fwd", ["sqldb"]).map((n) => n.name)).toEqual(["app_db"]);
    expect(reachableNodes(model, appDb(model).id, "bwd", ["component"]).map((n) => n.name)).toEqual(["UserProfile"]);
    link(model, component, starterService(model));
    model.edges.push(createEdge(component.id, "ghost"));
    expect(reachableNodes(model, component.id, "fwd", ["service"])).toHaveLength(1);
  });
});

describe("endpoints", () => {
  it("lists every endpoint with the service that owns it", () => {
    const model = starterModel();
    const service = starterService(model);
    expect(allEndpoints(model).map((ref) => [ref.service.id, ref.endpoint.id])).toEqual([
      [service.id, GET_USER_ENDPOINT],
      [service.id, LIST_USERS_ENDPOINT],
      [service.id, CREATE_USER_ENDPOINT],
    ]);
    expect(endpointById(model, LIST_USERS_ENDPOINT)?.service.name).toBe("User service");
    expect(endpointById(model, "ghost")).toBeUndefined();
  });

  it("labels endpoints and finds the functions that call them", () => {
    const model = starterModel();
    expect(endpointLabel(endpointOf(model))).toBe("GET /users/:id");
    expect(endpointLabel(endpointOf(model, CREATE_USER_ENDPOINT))).toBe("POST /users");
    expect(callersOf(model, GET_USER_ENDPOINT).map((f) => f.name)).toEqual(["fetchUser"]);
    expect(callersOf(model, CREATE_USER_ENDPOINT)).toEqual([]);
  });
});

describe("database helpers", () => {
  it("reads tables of sql and nosql databases", () => {
    const model = starterModel();
    const sql = appDb(model);
    const nosql = addNode<NosqlNode>(model, "nosql", "docs");
    expect(tableNames(sql)).toEqual(["users", "orders"]);
    expect(tableNames(undefined)).toEqual([]);
    expect(findTable(sql, "users")?.name).toBe("users");
    expect(findTable(undefined, "users")).toBeUndefined();
    expect(tableRows(sql, "users")).toHaveLength(3);
    expect(tableRows(sql, "ghost")).toEqual([]);
    sql.cfg.tables[0].data = '{"not":"array"}';
    expect(tableRows(sql, "users")).toEqual([]);
    expect(columnNames(sql, "orders")).toEqual(["id", "user_id", "total", "status"]);
    expect(columnNames(sql, "ghost")).toEqual([]);
    expect(columnNames(nosql, "documents")).toEqual(["_id", "name"]);
    nosql.cfg.collections[0].fields = [];
    expect(columnNames(nosql, "documents")).toEqual(["_id", "name"]);
    nosql.cfg.collections[0].data = "[]";
    expect(columnNames(nosql, "documents")).toEqual([]);
    expect(columnRefs(sql, ["orders"])).toEqual(["orders.id", "orders.user_id", "orders.total", "orders.status"]);
    expect(columnRefs(nosql, ["documents"])).toEqual([]);
  });

  it("identifies database nodes and the database an endpoint queries", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    expect(isDbNode(undefined)).toBe(false);
    expect(isDbNode(starterService(model))).toBe(false);
    expect(sourceDb(model, endpoint)?.name).toBe("app_db");
    endpoint.dbId = starterService(model).id;
    expect(sourceDb(model, endpoint)).toBeUndefined();
  });

  it("initialises endpoint query tables", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.tables = ["ghost"];
    endpoint.q.joins = [{ type: "LEFT", table: "orders", left: "", right: "" }];
    initQuerySource(model, endpoint);
    expect(endpoint.q.tables).toEqual(["users"]);
    expect(endpoint.q.joins).toEqual([]);
    endpoint.q.tables = ["orders"];
    initQuerySource(model, endpoint);
    expect(endpoint.q.tables).toEqual(["orders"]);
    endpoint.dbId = "";
    endpoint.q.tables = ["x"];
    initQuerySource(model, endpoint);
    expect(endpoint.q.tables).toEqual(["x"]);
    endpoint.dbId = appDb(model).id;
    appDb(model).cfg.tables = [];
    endpoint.q.tables = [];
    initQuerySource(model, endpoint);
    expect(endpoint.q.tables).toEqual([]);
  });

  it("switches an endpoint to another database, keeps its limit and wires an edge once", () => {
    const model = starterModel();
    const service = starterService(model);
    const endpoint = endpointOf(model);
    const other = addNode<SqlNode>(model, "sqldb", "other_db");
    endpoint.dbId = other.id;
    endpoint.q.limit = 20;
    switchEndpointDatabase(model, service, endpoint);
    expect(endpoint.q).toEqual({
      tables: ["items"],
      joins: [],
      where: [],
      select: [],
      group: [],
      aggs: [],
      nest: false,
      limit: 20,
    });
    expect(model.edges.some((e) => e.from === service.id && e.to === other.id)).toBe(true);
    const edgeCount = model.edges.length;
    switchEndpointDatabase(model, service, endpoint);
    expect(model.edges).toHaveLength(edgeCount);
    endpoint.dbId = "";
    switchEndpointDatabase(model, service, endpoint);
    expect(model.edges).toHaveLength(edgeCount);
  });
});

describe("normalize", () => {
  it("restores layer nodes and fills missing fields", () => {
    const model = starterModel();
    model.lnodes = undefined as unknown as typeof model.lnodes;
    const service = starterService(model);
    (service as { layer?: unknown }).layer = undefined;
    (service as { parent?: unknown }).parent = undefined;
    normalize(model);
    expect(model.lnodes).toHaveLength(3);
    expect(service.layer).toBe("backend");
    expect(service.parent).toBeNull();
    const redis = addNode(model, "redis", "r");
    (redis as { layer?: unknown }).layer = undefined;
    normalize(model);
    expect(redis.layer).toBeNull();
    model.lnodes = [];
    normalize(model);
    expect(model.lnodes).toHaveLength(3);
  });

  it("backfills the store and component state saved before they existed", () => {
    const model = starterModel();
    const component = userProfile(model);
    model.store = undefined as unknown as typeof model.store;
    (component.cfg as { state?: unknown }).state = undefined;
    normalize(model);
    expect(model.store).toEqual([]);
    expect(component.cfg.state).toEqual([]);
    expect(component.cfg.reads).toEqual([]);
    expect(fetchUser(model).cfg.writes).toEqual([]);
  });

  it("drops dangling parents, edges and state references", () => {
    const model = starterModel();
    const service = starterService(model);
    const database = appDb(model);
    service.parent = "ghost";
    database.parent = database.id;
    model.edges.push(createEdge(service.id, "ghost"), createEdge(service.id, service.id));
    const component = userProfile(model);
    component.cfg.reads.push("v_gone", "v_loading");
    fetchUser(model).cfg.writes.push({ varId: "v_gone", from: "" });
    normalize(model);
    expect(service.parent).toBeNull();
    expect(database.parent).toBeNull();
    expect(model.edges).toHaveLength(3);
    expect(component.cfg.reads).toEqual(["v_user", "v_orders", "v_loading"]);
    expect(fetchUser(model).cfg.writes).toHaveLength(2);
  });

  it("clears function endpoint choices that no longer exist", () => {
    const model = starterModel();
    const missing = addNode<FunctionNode>(model, "function", "missing", { endpoint: "ep_gone" });
    const unset = addNode<FunctionNode>(model, "function", "unset");
    (unset.cfg as { endpoint?: unknown }).endpoint = undefined;
    normalize(model);
    expect(fetchUser(model).cfg.endpoint).toBe(GET_USER_ENDPOINT);
    expect(missing.cfg.endpoint).toBe("");
    expect(unset.cfg.endpoint).toBe("");
  });

  it("clears endpoint links to missing databases and repairs queries on existing ones", () => {
    const model = starterModel();
    const getUser = endpointOf(model);
    const listUsers = endpointOf(model, LIST_USERS_ENDPOINT);
    getUser.dbId = "ghost";
    listUsers.q.tables = ["ghost"];
    normalize(model);
    expect(getUser.dbId).toBe("");
    expect(listUsers.q.tables).toEqual(["users"]);
  });

  it("fits card heights to their content but leaves containers alone", () => {
    const model = starterModel();
    const service = starterService(model);
    const container = addNode(model, "docker", "box", {}, { h: 777 });
    service.h = 999;
    normalize(model);
    expect(service.h).toBe(130);
    expect(container.h).toBe(777);
  });

  it("prunes empty groups and orphan group references", () => {
    const model = starterModel();
    model.groups.push({ id: "g_empty", name: "Empty" }, { id: "g_used", name: "Used" });
    starterService(model).group = "g_used";
    appDb(model).group = "g_missing";
    normalize(model);
    expect(model.groups.map((g) => g.id)).toEqual(["g_used"]);
    expect(appDb(model).group).toBeNull();
    expect(starterService(model).group).toBe("g_used");
  });
});

describe("reparent", () => {
  it("assigns the smallest enclosing container on the same layer", () => {
    const model = starterModel();
    const outer = addNode(model, "k8s", "outer", {}, { x: 0, y: 0, w: 600, h: 400 });
    const inner = addNode(model, "docker", "inner", {}, { x: 50, y: 50, w: 300, h: 200 });
    const child = addNode<ServiceNode>(model, "service", "child", {}, { x: 100, y: 100, w: 100, h: 50 });
    outer.layer = "backend";
    inner.layer = "backend";
    reparent(model, child);
    expect(child.parent).toBe(inner.id);
    reparent(model, inner);
    expect(inner.parent).toBe(outer.id);
    child.x = 5000;
    reparent(model, child);
    expect(child.parent).toBeNull();
    child.x = 100;
    inner.layer = "client";
    outer.layer = "client";
    reparent(model, child);
    expect(child.parent).toBeNull();
    outer.layer = "backend";
    inner.layer = "backend";
    inner.parent = outer.id;
    reparent(model, outer);
    expect(outer.parent).toBeNull();
    reparent(model, undefined);
    reparent(model, model.lnodes[0]);
  });
});
