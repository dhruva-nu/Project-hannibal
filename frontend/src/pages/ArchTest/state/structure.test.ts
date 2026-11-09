import { describe, expect, it } from "vitest";
import { clone, createEdge, starter, type ArchModel, type DerivedEdge, type FunctionNode, type ServiceNode } from "../engine";
import { addNode, byName, link } from "../engine/testFixtures";
import {
  addEdgeToModel,
  linkFunctionToEndpoint,
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
const userService = (model: ArchModel): ServiceNode => byName<ServiceNode>(model, "User service");
const fetchUser = (model: ArchModel): FunctionNode => byName<FunctionNode>(model, "fetchUser");
const endpointDatabases = (model: ArchModel): string[] => userService(model).cfg.endpoints.map((e) => e.dbId);

describe("addNodeToModel", () => {
  it("places the node at the viewport centre in the scoped layer with a unique name", () => {
    const model = fresh();
    const created = addNodeToModel(model, "service", "backend", VIEW, SIZE);
    expect(created.layer).toBe("backend");
    expect(created.name).toBe("Service");
    expect(model.nodes.some((n) => n.id === created.id)).toBe(true);
    expect(addNodeToModel(model, "service", "backend", VIEW, SIZE).name).toBe("Service 2");
  });

  it("falls back to the registry layer outside a scope and to no layer for infrastructure", () => {
    const model = fresh();
    expect(addNodeToModel(model, "service", null, VIEW, SIZE).layer).toBe("backend");
    expect(addNodeToModel(model, "redis", null, VIEW, SIZE).layer).toBeNull();
  });

  it("moves along and wraps to a new row when the centre is crowded", () => {
    const model = fresh();
    const placed = Array.from({ length: 12 }, () => addNodeToModel(model, "service", "backend", VIEW, SIZE));
    const keys = new Set(placed.map((n) => `${n.x},${n.y}`));
    expect(keys.size).toBe(12);
    expect(new Set(placed.map((n) => n.y)).size).toBeGreaterThan(1);
  });

  it("nests the new node inside the container it lands in", () => {
    const model = fresh();
    const docker = addNode(model, "docker", "box", {}, { x: 0, y: 0, w: 1600, h: 1200 });
    docker.layer = "backend";
    const created = addNodeToModel(model, "service", "backend", VIEW, SIZE);
    expect(created.parent).toBe(docker.id);
  });
});

describe("edges", () => {
  it("refuses self and duplicate edges", () => {
    const model = fresh();
    const fn = byName(model, "fetchUser");
    const service = userService(model);
    expect(hasEdge(model, fn.id, service.id)).toBe(true);
    expect(addEdgeToModel(model, fn.id, fn.id)).toBeNull();
    expect(addEdgeToModel(model, fn.id, service.id)).toBeNull();
    const created = addEdgeToModel(model, service.id, fn.id);
    expect(created && hasEdge(model, service.id, fn.id)).toBe(true);
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
    const service = userService(model);
    const second = addNode(model, "function", "second");
    link(model, second, service);
    const ids = model.edges.filter((e) => e.to === service.id).map((e) => e.id);
    const derived: DerivedEdge = { id: "ov", from: "x", to: "y", label: "", map: [], derived: true, ids };
    const inserted = insertInfraOnEdge(model, derived, "lb", { x: 0, y: 0 }, null);
    expect(inserted.layer).toBeNull();
    expect(model.edges.filter((e) => e.from === inserted.id && e.to === service.id)).toHaveLength(1);
    expect(model.edges.filter((e) => e.to === inserted.id)).toHaveLength(2);
  });

  it("keeps endpoint databases when the database is still reachable through another path", () => {
    const model = fresh();
    const service = userService(model);
    const db = byName(model, "app_db");
    const direct = model.edges.find((e) => e.from === service.id && e.to === db.id)!;
    const via = addNode(model, "redis", "via");
    link(model, service, via);
    link(model, via, db);
    removeEdges(model, [direct.id]);
    expect(endpointDatabases(model)).toEqual([db.id, db.id, ""]);
  });

  it("clears endpoint databases after the only service edge is removed and ignores non-service sources", () => {
    const model = fresh();
    removeEdges(model, model.edges.map((e) => e.id));
    expect(model.edges).toEqual([]);
    expect(endpointDatabases(model)).toEqual(["", "", ""]);
  });

  it("keeps endpoint databases when the removed service edge targets something else", () => {
    const model = fresh();
    const service = userService(model);
    const other = addNode(model, "redis", "other");
    const edge = createEdge(service.id, other.id);
    model.edges.push(edge);
    removeEdges(model, [edge.id]);
    expect(endpointDatabases(model)).toEqual([byName(model, "app_db").id, byName(model, "app_db").id, ""]);
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

describe("linkFunctionToEndpoint", () => {
  const unlinkedFunctionAndService = (model: ArchModel) => {
    const service = userService(model);
    const fn = fetchUser(model);
    fn.cfg.endpoint = "";
    return { service, fn };
  };

  it("points the function at the endpoint row it was dropped on", () => {
    const model = fresh();
    const { service, fn } = unlinkedFunctionAndService(model);
    linkFunctionToEndpoint(model, fn.id, service.id, "ep_create_user");
    expect(fn.cfg.endpoint).toBe("ep_create_user");
  });

  it("keeps an endpoint the service already owns when no row was chosen", () => {
    const model = fresh();
    const fn = fetchUser(model);
    linkFunctionToEndpoint(model, fn.id, userService(model).id, "not-on-this-service");
    expect(fn.cfg.endpoint).toBe("ep_get_user");
  });

  it("falls back to the first endpoint, or none when the service has no endpoints", () => {
    const model = fresh();
    const { service, fn } = unlinkedFunctionAndService(model);
    linkFunctionToEndpoint(model, fn.id, service.id);
    expect(fn.cfg.endpoint).toBe("ep_get_user");
    service.cfg.endpoints = [];
    fn.cfg.endpoint = "";
    linkFunctionToEndpoint(model, fn.id, service.id);
    expect(fn.cfg.endpoint).toBe("");
  });

  it("ignores pairs that are not a function and a service", () => {
    const model = fresh();
    const { service, fn } = unlinkedFunctionAndService(model);
    linkFunctionToEndpoint(model, service.id, fn.id, "ep_create_user");
    linkFunctionToEndpoint(model, fn.id, byName(model, "app_db").id, "ep_create_user");
    expect(fn.cfg.endpoint).toBe("");
  });

  it("links the endpoint when a new function-to-service edge is drawn", () => {
    const model = fresh();
    const service = userService(model);
    const second = addNode<FunctionNode>(model, "function", "second");
    addEdgeToModel(model, second.id, service.id, "ep_list_users");
    expect(second.cfg.endpoint).toBe("ep_list_users");
  });
});

describe("nodes and groups", () => {
  it("removes nodes with their edges", () => {
    const model = fresh();
    const service = userService(model);
    removeNodes(model, [service.id]);
    expect(model.nodes.some((n) => n.id === service.id)).toBe(false);
    expect(model.edges.some((e) => e.from === service.id || e.to === service.id)).toBe(false);
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
