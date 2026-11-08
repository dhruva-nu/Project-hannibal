import { describe, expect, it } from "vitest";
import {
  allRefs,
  allVars,
  attachedFns,
  colNames,
  connectorDb,
  defaultLayerNodes,
  descendants,
  grp,
  inE,
  initConnector,
  isDbNode,
  mkEdge,
  mkNode,
  node,
  normalize,
  outE,
  reach,
  readersOf,
  readsOf,
  reparent,
  switchConnectorDatabase,
  tbl,
  tblNames,
  tblRows,
  uniqueName,
  writersOf,
  writesOf,
} from "./model";
import { addNode, byName, link, starterModel } from "./testFixtures";
import type { ApiNode, ComponentNode, ConnectorNode, FunctionNode, NosqlNode, SqlNode, StateNode } from "./types";

describe("lookups", () => {
  it("finds layer nodes and placed nodes", () => {
    const model = starterModel();
    expect(node(model, "L_client")?.type).toBe("layer");
    expect(node(model, byName(model, "Get user").id)?.name).toBe("Get user");
    expect(node(model, "nope")).toBeUndefined();
  });

  it("finds edges and groups", () => {
    const model = starterModel();
    const component = byName(model, "UserProfile");
    expect(outE(model, component.id)).toHaveLength(1);
    expect(inE(model, component.id)).toHaveLength(0);
    model.groups.push({ id: "g1", name: "G" });
    expect(grp(model, "g1")?.name).toBe("G");
    expect(grp(model, "g2")).toBeUndefined();
  });

  it("collects nested descendants", () => {
    const model = starterModel();
    const outer = addNode(model, "k8s", "outer");
    const inner = addNode(model, "docker", "inner");
    const leaf = addNode(model, "api", "leaf");
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
    const plain = mkNode("api", 1, 2);
    expect(plain.layer).toBe("backend");
    expect(plain.name).toBe("REST API");
    const custom = mkNode("api", 1, 2, { id: "x", w: 5, h: 6, name: "N", layer: null, cfg: { path: "/p" } }) as ApiNode;
    expect([custom.id, custom.w, custom.h, custom.name, custom.layer, custom.cfg.path]).toEqual(["x", 5, 6, "N", null, "/p"]);
    expect(mkNode("redis", 0, 0).layer).toBeNull();
  });

  it("creates edges", () => {
    const edge = mkEdge("a", "b");
    expect(edge).toMatchObject({ from: "a", to: "b", label: "", map: [] });
  });

  it("makes unique names", () => {
    const model = starterModel();
    expect(uniqueName(model, "Fresh")).toBe("Fresh");
    expect(uniqueName(model, "Get user")).toBe("Get user 2");
    addNode(model, "api", "Get user 2");
    expect(uniqueName(model, "Get user")).toBe("Get user 3");
  });
});

describe("state relationships", () => {
  it("lists variables and who reads or writes them", () => {
    const model = starterModel();
    expect(allVars(model).map((v) => v.name)).toEqual(["currentUser", "orders", "isLoading"]);
    expect(allVars(model)[0].node).toBe(byName(model, "App state").id);
    expect(readersOf(model, "v_user").map((n) => n.name)).toEqual(["UserProfile"]);
    expect(writersOf(model, "v_orders").map((n) => n.name)).toEqual(["fetchUser"]);
    expect(readsOf(byName(model, "Get user"))).toEqual([]);
    expect(writesOf(byName(model, "Get user"))).toEqual([]);
  });

  it("sorts attached functions by trigger then position", () => {
    const model = starterModel();
    const component = byName<ComponentNode>(model, "UserProfile");
    const poll = addNode<FunctionNode>(model, "function", "poll", { trigger: "Polling" }, { x: 0, y: 0 });
    const lateLoad = addNode<FunctionNode>(model, "function", "late", { trigger: "On Load" }, { x: 5, y: 500 });
    const rightLoad = addNode<FunctionNode>(model, "function", "right", { trigger: "On Load" }, { x: 900, y: 320 });
    [poll, lateLoad, rightLoad].forEach((f) => link(model, component, f));
    const sameRow = byName<FunctionNode>(model, "fetchUser");
    sameRow.y = 320;
    expect(attachedFns(model, component.id).map((f) => f.name)).toEqual(["fetchUser", "right", "late", "poll"]);
    rightLoad.y = 320;
    rightLoad.x = 100;
    sameRow.x = 480;
    expect(attachedFns(model, component.id)[0].name).toBe("right");
  });

  it("reaches nodes in both directions", () => {
    const model = starterModel();
    const component = byName(model, "UserProfile");
    const forward = reach(model, component.id, "fwd", ["sqldb"]);
    expect(forward.map((n) => n.name)).toEqual(["app_db"]);
    const backward = reach(model, byName(model, "app_db").id, "bwd", ["component"]);
    expect(backward.map((n) => n.name)).toEqual(["UserProfile"]);
    link(model, component, byName(model, "Get user"));
    model.edges.push(mkEdge(component.id, "ghost"));
    expect(reach(model, component.id, "fwd", ["api"])).toHaveLength(1);
  });
});

describe("database helpers", () => {
  it("reads tables of sql and nosql databases", () => {
    const model = starterModel();
    const sql = byName<SqlNode>(model, "app_db");
    const nosql = addNode<NosqlNode>(model, "nosql", "docs");
    expect(tblNames(sql)).toEqual(["users", "orders"]);
    expect(tblNames(undefined)).toEqual([]);
    expect(tbl(sql, "users")?.name).toBe("users");
    expect(tbl(undefined, "users")).toBeUndefined();
    expect(tblRows(sql, "users")).toHaveLength(3);
    expect(tblRows(sql, "ghost")).toEqual([]);
    sql.cfg.tables[0].data = '{"not":"array"}';
    expect(tblRows(sql, "users")).toEqual([]);
    expect(colNames(sql, "orders")).toEqual(["id", "user_id", "total", "status"]);
    expect(colNames(sql, "ghost")).toEqual([]);
    expect(colNames(nosql, "documents")).toEqual(["_id", "name"]);
    nosql.cfg.collections[0].fields = [];
    expect(colNames(nosql, "documents")).toEqual(["_id", "name"]);
    nosql.cfg.collections[0].data = "[]";
    expect(colNames(nosql, "documents")).toEqual([]);
    expect(allRefs(sql, ["orders"])).toEqual(["orders.id", "orders.user_id", "orders.total", "orders.status"]);
    expect(allRefs(nosql, ["documents"])).toEqual([]);
  });

  it("identifies database nodes and connector targets", () => {
    const model = starterModel();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    expect(isDbNode(undefined)).toBe(false);
    expect(isDbNode(byName(model, "Get user"))).toBe(false);
    expect(connectorDb(model, connector)?.name).toBe("app_db");
    connector.cfg.dbId = byName(model, "Get user").id;
    expect(connectorDb(model, connector)).toBeUndefined();
  });

  it("initialises connector tables", () => {
    const model = starterModel();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    connector.cfg.q.tables = ["ghost"];
    connector.cfg.q.joins = [{ type: "LEFT", table: "orders", left: "", right: "" }];
    initConnector(model, connector);
    expect(connector.cfg.q.tables).toEqual(["users"]);
    expect(connector.cfg.q.joins).toEqual([]);
    connector.cfg.q.tables = ["orders"];
    initConnector(model, connector);
    expect(connector.cfg.q.tables).toEqual(["orders"]);
    connector.cfg.dbId = "";
    connector.cfg.q.tables = ["x"];
    initConnector(model, connector);
    expect(connector.cfg.q.tables).toEqual(["x"]);
    const db = byName<SqlNode>(model, "app_db");
    connector.cfg.dbId = db.id;
    db.cfg.tables = [];
    connector.cfg.q.tables = [];
    initConnector(model, connector);
    expect(connector.cfg.q.tables).toEqual([]);
  });

  it("switches a connector to another database and wires an edge once", () => {
    const model = starterModel();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    const other = addNode<SqlNode>(model, "sqldb", "other_db");
    connector.cfg.dbId = other.id;
    switchConnectorDatabase(model, connector);
    expect(connector.cfg.q.tables).toEqual(["items"]);
    expect(model.edges.some((e) => e.from === connector.id && e.to === other.id)).toBe(true);
    const edgeCount = model.edges.length;
    switchConnectorDatabase(model, connector);
    expect(model.edges).toHaveLength(edgeCount);
    connector.cfg.dbId = "";
    switchConnectorDatabase(model, connector);
    expect(model.edges).toHaveLength(edgeCount);
  });
});

describe("normalize", () => {
  it("restores layer nodes and fills missing fields", () => {
    const model = starterModel();
    model.lnodes = undefined as unknown as typeof model.lnodes;
    const api = byName(model, "Get user");
    (api as { layer?: unknown }).layer = undefined;
    (api as { parent?: unknown }).parent = undefined;
    normalize(model);
    expect(model.lnodes).toHaveLength(3);
    expect(api.layer).toBe("backend");
    expect(api.parent).toBeNull();
    const redis = addNode(model, "redis", "r");
    (redis as { layer?: unknown }).layer = undefined;
    normalize(model);
    expect(redis.layer).toBeNull();
    model.lnodes = [];
    normalize(model);
    expect(model.lnodes).toHaveLength(3);
  });

  it("drops dangling parents, edges and state references", () => {
    const model = starterModel();
    const api = byName(model, "Get user");
    api.parent = "ghost";
    byName(model, "userWithOrders").parent = byName(model, "userWithOrders").id;
    model.edges.push(mkEdge(api.id, "ghost"), mkEdge(api.id, api.id));
    const component = byName<ComponentNode>(model, "UserProfile");
    component.cfg.reads.push("v_gone");
    byName<FunctionNode>(model, "fetchUser").cfg.writes.push({ varId: "v_gone", from: "" });
    normalize(model);
    expect(api.parent).toBeNull();
    expect(byName(model, "userWithOrders").parent).toBeNull();
    expect(model.edges).toHaveLength(4);
    expect(component.cfg.reads).toEqual(["v_user", "v_orders"]);
    expect(byName<FunctionNode>(model, "fetchUser").cfg.writes).toHaveLength(2);
  });

  it("repairs connector database links", () => {
    const model = starterModel();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    const dbId = connector.cfg.dbId;
    connector.cfg.dbId = "ghost";
    normalize(model);
    expect(connector.cfg.dbId).toBe(dbId);
    connector.cfg.dbId = "";
    model.edges = model.edges.filter((e) => e.from !== connector.id);
    normalize(model);
    expect(connector.cfg.dbId).toBe("");
  });

  it("prunes empty groups and orphan group references", () => {
    const model = starterModel();
    model.groups.push({ id: "g_empty", name: "Empty" }, { id: "g_used", name: "Used" });
    byName(model, "Get user").group = "g_used";
    byName(model, "app_db").group = "g_missing";
    normalize(model);
    expect(model.groups.map((g) => g.id)).toEqual(["g_used"]);
    expect(byName(model, "app_db").group).toBeNull();
    expect(byName(model, "Get user").group).toBe("g_used");
  });
});

describe("reparent", () => {
  it("assigns the smallest enclosing container on the same layer", () => {
    const model = starterModel();
    const outer = addNode(model, "k8s", "outer", {}, { x: 0, y: 0, w: 600, h: 400 });
    const inner = addNode(model, "docker", "inner", {}, { x: 50, y: 50, w: 300, h: 200 });
    const api = addNode<StateNode | ApiNode>(model, "api", "child", {}, { x: 100, y: 100, w: 100, h: 50 });
    outer.layer = "backend";
    inner.layer = "backend";
    reparent(model, api);
    expect(api.parent).toBe(inner.id);
    reparent(model, inner);
    expect(inner.parent).toBe(outer.id);
    api.x = 5000;
    reparent(model, api);
    expect(api.parent).toBeNull();
    api.x = 100;
    inner.layer = "client";
    outer.layer = "client";
    reparent(model, api);
    expect(api.parent).toBeNull();
    outer.layer = "backend";
    inner.layer = "backend";
    inner.parent = outer.id;
    reparent(model, outer);
    expect(outer.parent).toBeNull();
    reparent(model, undefined);
    reparent(model, model.lnodes[0]);
  });
});
