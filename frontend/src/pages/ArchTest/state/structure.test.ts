import { describe, expect, it } from "vitest";
import { clone, mkEdge, node as nodeOf, starter, type ArchModel, type ConnectorNode, type DerivedEdge } from "../engine";
import { addNode, byName, link } from "../engine/testFixtures";
import {
  addEdgeToModel,
  addFunctionToComponent,
  addNodeToModel,
  flipEdgeDirection,
  groupNodes,
  hasEdge,
  insertInfraOnEdge,
  moveNodesTo,
  realEdgesOf,
  removeEdges,
  removeNodes,
  reparentAll,
  ungroupNodes,
} from "./structure";

const VIEW = { x: 0, y: 0, k: 1 };
const SIZE = { width: 800, height: 600 };

const fresh = (): ArchModel => clone(starter());

describe("addNodeToModel", () => {
  it("places the node at the viewport centre in the scoped layer with a unique name", () => {
    const model = fresh();
    const created = addNodeToModel(model, "api", "backend", VIEW, SIZE);
    expect(created.layer).toBe("backend");
    expect(created.name).toBe("REST API");
    expect(model.nodes.some((n) => n.id === created.id)).toBe(true);
    expect(addNodeToModel(model, "api", "backend", VIEW, SIZE).name).toBe("REST API 2");
  });

  it("falls back to the registry layer outside a scope and to no layer for infrastructure", () => {
    const model = fresh();
    expect(addNodeToModel(model, "api", null, VIEW, SIZE).layer).toBe("backend");
    expect(addNodeToModel(model, "redis", null, VIEW, SIZE).layer).toBeNull();
  });

  it("moves along and wraps to a new row when the centre is crowded", () => {
    const model = fresh();
    const placed = Array.from({ length: 12 }, () => addNodeToModel(model, "api", "backend", VIEW, SIZE));
    const keys = new Set(placed.map((n) => `${n.x},${n.y}`));
    expect(keys.size).toBe(12);
    expect(new Set(placed.map((n) => n.y)).size).toBeGreaterThan(1);
  });

  it("nests the new node inside the container it lands in", () => {
    const model = fresh();
    const docker = addNode(model, "docker", "box", {}, { x: 0, y: 0, w: 1600, h: 1200 });
    docker.layer = "backend";
    const created = addNodeToModel(model, "api", "backend", VIEW, SIZE);
    expect(created.parent).toBe(docker.id);
  });
});

describe("edges", () => {
  it("refuses self and duplicate edges", () => {
    const model = fresh();
    const fn = byName(model, "fetchUser");
    const api = byName(model, "Get user");
    expect(hasEdge(model, fn.id, api.id)).toBe(true);
    expect(addEdgeToModel(model, fn.id, fn.id)).toBeNull();
    expect(addEdgeToModel(model, fn.id, api.id)).toBeNull();
    const created = addEdgeToModel(model, api.id, fn.id);
    expect(created && hasEdge(model, api.id, fn.id)).toBe(true);
  });

  it("resolves real and derived edges to stored edges, dropping unknown ids", () => {
    const model = fresh();
    const real = model.edges[0];
    expect(realEdgesOf(model, real)).toEqual([real]);
    const derived: DerivedEdge = { id: "ov", from: "a", to: "b", label: "", map: [], derived: true, ids: [real.id, "gone"] };
    expect(realEdgesOf(model, derived)).toEqual([real]);
  });

  it("splices infrastructure into a real edge", () => {
    const model = fresh();
    const edge = model.edges.find((e) => e.from === byName(model, "fetchUser").id)!;
    const target = edge.to;
    const inserted = insertInfraOnEdge(model, edge, "redis", { x: 103, y: 207 }, "backend");
    expect(inserted).toMatchObject({ x: 10, y: 170 });
    expect(inserted.layer).toBe("backend");
    expect(model.edges.find((e) => e.id === edge.id)!.to).toBe(inserted.id);
    expect(hasEdge(model, inserted.id, target)).toBe(true);
  });

  it("splices into every edge of a derived edge and removes duplicate onward edges", () => {
    const model = fresh();
    const api = byName(model, "Get user");
    const second = addNode(model, "function", "second");
    link(model, second, api);
    const ids = model.edges.filter((e) => e.to === api.id).map((e) => e.id);
    const derived: DerivedEdge = { id: "ov", from: "x", to: "y", label: "", map: [], derived: true, ids };
    const inserted = insertInfraOnEdge(model, derived, "lb", { x: 0, y: 0 }, null);
    expect(inserted.layer).toBeNull();
    expect(model.edges.filter((e) => e.from === inserted.id && e.to === api.id)).toHaveLength(1);
    expect(model.edges.filter((e) => e.to === inserted.id)).toHaveLength(2);
  });

  it("keeps the connector database when it is still reachable through another path", () => {
    const model = fresh();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    const db = byName(model, "app_db");
    const direct = model.edges.find((e) => e.from === connector.id && e.to === db.id)!;
    const via = addNode(model, "redis", "via");
    link(model, connector, via);
    link(model, via, db);
    removeEdges(model, [direct.id]);
    expect(connector.cfg.dbId).toBe(db.id);
  });

  it("clears a connector database after its only edge is removed and ignores non-connector sources", () => {
    const model = fresh();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    const ids = model.edges.map((e) => e.id);
    removeEdges(model, ids);
    expect(model.edges).toEqual([]);
    expect((nodeOf(model, connector.id) as ConnectorNode).cfg.dbId).toBe("");
  });

  it("keeps the database when the removed edge targets something else", () => {
    const model = fresh();
    const connector = byName<ConnectorNode>(model, "userWithOrders");
    const other = addNode(model, "redis", "other");
    const edge = mkEdge(connector.id, other.id);
    model.edges.push(edge);
    removeEdges(model, [edge.id]);
    expect(connector.cfg.dbId).not.toBe("");
  });

  it("flips an edge and reports a missing one", () => {
    const model = fresh();
    const edge = model.edges[0];
    const { from, to } = edge;
    expect(flipEdgeDirection(model, edge.id)).toBe(true);
    expect(model.edges.find((e) => e.id === edge.id)).toMatchObject({ from: to, to: from });
    expect(flipEdgeDirection(model, "nope")).toBe(false);
  });
});

describe("nodes and groups", () => {
  it("removes nodes with their edges", () => {
    const model = fresh();
    const api = byName(model, "Get user");
    removeNodes(model, [api.id]);
    expect(model.nodes.some((n) => n.id === api.id)).toBe(false);
    expect(model.edges.some((e) => e.from === api.id || e.to === api.id)).toBe(false);
  });

  it("groups and ungroups nodes", () => {
    const model = fresh();
    const fn = byName(model, "fetchUser");
    const group = groupNodes(model, [fn.id]);
    expect(group.name).toBe("Group 1");
    expect(byName(model, "fetchUser").group).toBe(group.id);
    ungroupNodes(model, group.id);
    expect(byName(model, "fetchUser").group).toBeNull();
    expect(model.groups).toEqual([]);
  });

  it.each([
    ["Polling", "poll"],
    ["WebSocket", "subscribe"],
    ["On Load", "fetchData"],
  ] as const)("adds a %s function named %s under its component and links it", (trigger, name) => {
    const model = fresh();
    const component = byName(model, "UserProfile");
    const created = addFunctionToComponent(model, component.id, trigger)!;
    expect(created.name).toBe(name);
    expect(created.type === "function" && created.cfg.trigger).toBe(trigger);
    expect(hasEdge(model, component.id, created.id)).toBe(true);
  });

  it("returns null when the component is missing", () => {
    expect(addFunctionToComponent(fresh(), "nope", "On Load")).toBeNull();
  });

  it("moves nodes and layer cards, ignoring unknown ids, then reparents", () => {
    const model = fresh();
    const fn = byName(model, "fetchUser");
    const layer = model.lnodes[0];
    moveNodesTo(model, { [fn.id]: { x: 5, y: 6 }, [layer.id]: { x: 7, y: 8 }, nope: { x: 1, y: 1 } });
    expect(byName(model, "fetchUser")).toMatchObject({ x: 5, y: 6 });
    expect(model.lnodes[0]).toMatchObject({ x: 7, y: 8 });
    const docker = addNode(model, "docker", "box", {}, { x: 0, y: 0, w: 400, h: 400 });
    docker.layer = "client";
    reparentAll(model, [fn.id, "nope"]);
    expect(byName(model, "fetchUser").parent).toBe(docker.id);
  });
});
