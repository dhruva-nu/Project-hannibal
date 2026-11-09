import { describe, expect, it } from "vitest";
import { clone, simulate, starter, type ArchModel, type ComponentNode, type FunctionNode, type ServiceNode } from "../engine";
import { addNode, byName, link } from "../engine/testFixtures";
import { traceViewFor } from "../testing/overlayHarness";
import { NO_SELECTION, type TraceView } from "../state/archApi";
import { buildEdgeScene, type SceneInput } from "./edgeScene";
import { groupBoxes } from "./groupBoxes";
import { applyOverrides, NO_OVERRIDES } from "./overrides";
import { edgeVisits, traceMark } from "./traceHighlight";
import {
  boxOfNodeOrGhost,
  computeVisibility,
  isVisible,
  visibleCards,
  visibleContainers,
  visibleNodes,
} from "./visibility";

const sceneInput = (model: ArchModel, overrides: Partial<SceneInput> = {}): SceneInput => {
  const scope = overrides.scope ?? null;
  return {
    model,
    flow: simulate(model),
    visibility: computeVisibility(model, scope),
    scope,
    selection: NO_SELECTION,
    trace: null,
    showFlow: false,
    showStateLinks: false,
    ...overrides,
  };
};

describe("visibility", () => {
  it("shows layer cards and unlayered infrastructure in the overview, only layer members when scoped", () => {
    const model = starter();
    const redis = addNode(model, "redis", "cache");
    redis.layer = null;
    expect(visibleNodes(model, null).map((n) => n.id)).toEqual([...model.lnodes.map((n) => n.id), redis.id]);
    expect(isVisible(redis, null)).toBe(true);
    expect(isVisible(byName(model, "User service"), null)).toBe(false);
    expect(visibleNodes(model, "backend").every((n) => n.layer === "backend")).toBe(true);
  });

  it("splits visible nodes into containers and cards", () => {
    const model = starter();
    const docker = addNode(model, "docker", "box");
    docker.layer = "backend";
    expect(visibleContainers(model, "backend").map((n) => n.id)).toEqual([docker.id]);
    expect(visibleCards(model, "backend").some((n) => n.id === docker.id)).toBe(false);
  });

  it("derives one overview edge per pair of layers and lists the real edge ids", () => {
    const model = starter();
    const second = addNode<FunctionNode>(model, "function", "second");
    link(model, second, byName(model, "User service"));
    const { edges, derivedById, ghosts } = computeVisibility(model, null);
    expect(ghosts).toEqual({});
    const clientToBackend = edges.find((e) => e.id === "ov|L_client|L_backend");
    expect(clientToBackend?.derived && clientToBackend.ids.length).toBe(2);
    expect(derivedById["ov|L_backend|L_db"]).toBeTruthy();
  });

  it("keeps unlayered infrastructure as its own overview endpoint and skips same-layer and dangling edges", () => {
    const model = starter();
    const redis = addNode(model, "redis", "cache");
    redis.layer = null;
    link(model, byName(model, "fetchUser"), redis);
    link(model, byName(model, "UserProfile"), byName(model, "fetchUser"));
    model.edges.push({ id: "dangling", from: "nope", to: "gone", label: "", map: [] });
    const ids = computeVisibility(model, null).edges.map((e) => e.id);
    expect(ids).toContain(`ov|L_client|${redis.id}`);
    expect(ids.some((id) => id === "ov|L_client|L_client")).toBe(false);
  });

  it("scopes edges to a layer and places ghosts for outside neighbours above and below", () => {
    const model = starter();
    const vis = computeVisibility(model, "backend");
    const fetchUser = byName(model, "fetchUser");
    const db = byName(model, "app_db");
    expect(vis.ghosts[fetchUser.id].up).toBe(true);
    expect(vis.ghosts[db.id].up).toBe(false);
    expect(vis.edges).toHaveLength(2);
    expect(Object.keys(vis.derivedById)).toEqual([]);
  });

  it("ignores edges that do not touch the scope, edges with missing nodes and repeated external neighbours", () => {
    const model = starter();
    const service = byName<ServiceNode>(model, "User service");
    const extra = addNode<FunctionNode>(model, "function", "extra");
    link(model, extra, service);
    link(model, byName(model, "fetchUser"), service);
    model.edges.push({ id: "dangling", from: "nope", to: service.id, label: "", map: [] });
    const vis = computeVisibility(model, "db");
    expect(vis.edges).toHaveLength(1);
    expect(Object.keys(vis.ghosts)).toHaveLength(1);
    const backend = computeVisibility(model, "backend");
    expect(Object.keys(backend.ghosts).length).toBe(3);
  });

  it("offsets ghosts that would collide and handles unlayered neighbours by edge direction", () => {
    const model = starter();
    const service = byName(model, "User service");
    const sameColumn = addNode<FunctionNode>(model, "function", "sameColumn");
    link(model, sameColumn, service);
    const redisIn = addNode(model, "redis", "cacheIn");
    const redisOut = addNode(model, "redis", "cacheOut");
    redisIn.layer = null;
    redisOut.layer = null;
    link(model, redisIn, service);
    link(model, service, redisOut);
    const { ghosts } = computeVisibility(model, "backend");
    expect(ghosts[redisIn.id].up).toBe(true);
    expect(ghosts[redisOut.id].up).toBe(false);
    const upXs = Object.values(ghosts).filter((g) => g.up).map((g) => g.x);
    expect(new Set(upXs).size).toBe(upXs.length);
  });

  it("resolves boxes from ghosts before real nodes", () => {
    const model = starter();
    const { ghosts } = computeVisibility(model, "backend");
    const fetchUser = byName(model, "fetchUser");
    const boxOf = boxOfNodeOrGhost(model, ghosts);
    expect(boxOf(fetchUser.id)).toBe(ghosts[fetchUser.id]);
    expect(boxOf(byName(model, "User service").id)?.w).toBeGreaterThan(0);
    expect(boxOf("missing")).toBeUndefined();
  });
});

describe("buildEdgeScene", () => {
  it("draws overview edges with a connection-count chip in flow mode", () => {
    const model = starter();
    const second = addNode<FunctionNode>(model, "function", "second");
    link(model, second, byName(model, "User service"));
    const scene = buildEdgeScene(sceneInput(model, { showFlow: true }));
    const texts = scene.chips.map((c) => c.text.replace(/^! /, ""));
    expect(texts).toContain("2 connections");
    expect(texts).toContain("1 connection");
    expect(scene.shapes.length).toBe(2);
    expect(Object.keys(scene.midpoints).length).toBe(2);
  });

  it("shows payload arrows in flow mode, prefixed by labels, and plain labels otherwise", () => {
    const model = starter();
    const edge = model.edges.find((e) => e.from === byName(model, "fetchUser").id)!;
    edge.label = "call";
    const flowed = buildEdgeScene(sceneInput(model, { scope: "client", showFlow: true }));
    expect(flowed.chips.find((c) => c.edgeId === edge.id)?.text.startsWith("call: ")).toBe(true);
    const labelled = buildEdgeScene(sceneInput(model, { scope: "client" }));
    expect(labelled.chips).toEqual([expect.objectContaining({ key: edge.id, kind: "label", text: "call" })]);
  });

  it("labels a function-to-service connection with the endpoint the function calls", () => {
    const model = starter();
    const edge = model.edges.find((e) => e.from === byName(model, "fetchUser").id)!;
    const chipTexts = () => buildEdgeScene(sceneInput(model, { scope: "client" })).chips.map((c) => c.text);
    expect(chipTexts()).toEqual(["GET /users/:id"]);
    byName<FunctionNode>(model, "fetchUser").cfg.endpoint = "";
    expect(chipTexts()).toEqual([]);
    const otherService = addNode<ServiceNode>(model, "service", "Other service");
    byName<FunctionNode>(model, "fetchUser").cfg.endpoint = otherService.cfg.endpoints[0].id;
    expect(chipTexts()).toEqual([]);
    expect(edge.label).toBe("");
  });

  it("leaves unlabelled overview and non-function connections without a chip", () => {
    const model = starter();
    expect(buildEdgeScene(sceneInput(model)).chips).toEqual([]);
    expect(buildEdgeScene(sceneInput(model, { scope: "db" })).chips).toEqual([]);
  });

  it("shows only the request arrow on a connection with no simulated response", () => {
    const model = starter();
    const cache = addNode(model, "redis", "cache");
    cache.layer = "db";
    const idle = link(model, byName(model, "app_db"), cache);
    const scene = buildEdgeScene(sceneInput(model, { scope: "db", showFlow: true }));
    expect(scene.chips.find((c) => c.edgeId === idle.id)?.text).toBe("→ {  }");
  });

  it("flags schema mismatches with a warn marker and a bang in flow mode", () => {
    const model = starter();
    const fetchUser = byName(model, "fetchUser");
    const edge = model.edges.find((e) => e.from === fetchUser.id)!;
    edge.map = [];
    const scene = buildEdgeScene(sceneInput(model, { scope: "backend", showFlow: true }));
    const shape = scene.shapes.find((s) => s.id === edge.id)!;
    expect(shape.warn).toBe(true);
    expect(shape.marker).toBe("warn");
    expect(scene.chips.find((c) => c.edgeId === edge.id)?.text.startsWith("! ")).toBe(true);
  });

  it("marks the selected edge", () => {
    const model = starter();
    const id = model.edges.find((e) => e.from === byName(model, "fetchUser").id)!.id;
    const scene = buildEdgeScene(sceneInput(model, { scope: "backend", selection: { type: "edge", ids: [id] } }));
    const shape = scene.shapes.find((s) => s.id === id)!;
    expect(shape.selected).toBe(true);
    expect(shape.marker).toBe("selected");
  });

  it("highlights traversed edges, dims the rest and animates the active request and response", () => {
    const model = starter();
    const trace = traceViewFor(model);
    const forward = buildEdgeScene(sceneInput(model, { scope: "backend", trace: { ...trace, index: 2 } }));
    expect(forward.shapes.some((s) => s.traversed)).toBe(true);
    expect(forward.shapes.some((s) => s.dimmed)).toBe(true);
    expect(forward.overlays.map((o) => o.direction)).toEqual(["request"]);
    const responseIndex = trace.result.steps.findIndex((s) => s.dir === "res" && s.edge);
    const back = buildEdgeScene(sceneInput(model, { scope: "backend", trace: { ...trace, index: responseIndex } }));
    expect(back.overlays.map((o) => o.direction)).toEqual(["response"]);
    const overview = buildEdgeScene(sceneInput(model, { trace: { ...trace, index: 2 } }));
    expect(overview.shapes.some((s) => s.traversed)).toBe(true);
    expect(overview.overlays.length).toBe(1);
  });

  it("shows no animation on a step without an edge", () => {
    const model = starter();
    const trace = traceViewFor(model);
    const scene = buildEdgeScene(sceneInput(model, { scope: "client", trace: { ...trace, index: 0 } }));
    expect(scene.overlays).toEqual([]);
  });

  it("skips edges whose endpoints cannot be placed", () => {
    const model = starter();
    const visibility = computeVisibility(model, "backend");
    visibility.edges.push({ id: "ghostly", from: "x", to: "y", label: "", map: [] });
    const scene = buildEdgeScene(sceneInput(model, { scope: "backend", visibility }));
    expect(scene.shapes.some((s) => s.id === "ghostly")).toBe(false);
  });

  it("draws state links from writer to reader with the shared variables, only in the client layer", () => {
    const model = starter();
    const fetchUser = byName(model, "fetchUser");
    const profile = byName(model, "UserProfile");
    const scene = buildEdgeScene(sceneInput(model, { scope: "client", showStateLinks: true }));
    expect(scene.stateLinks.map((l) => l.key)).toEqual([`${fetchUser.id}|${profile.id}`]);
    expect(scene.chips.filter((c) => c.kind === "state").map((c) => c.text)).toEqual(["state: currentUser, orders"]);
    expect(buildEdgeScene(sceneInput(model, { scope: "backend", showStateLinks: true })).stateLinks).toEqual([]);
    expect(buildEdgeScene(sceneInput(model, { scope: "client" })).stateLinks).toEqual([]);
  });

  it("omits state links whose endpoint is not visible or that loop back to the same node", () => {
    const model = starter();
    const profile = byName<ComponentNode>(model, "UserProfile");
    profile.cfg.writes = [{ varId: "v_loading", from: "" }];
    profile.cfg.reads = [...profile.cfg.reads, "v_loading"];
    byName(model, "fetchUser").layer = "backend";
    const scene = buildEdgeScene(sceneInput(model, { scope: "client", showStateLinks: true }));
    expect(scene.stateLinks).toEqual([]);
  });
});

describe("trace highlighting", () => {
  const model = starter();
  const trace = traceViewFor(model);
  const at = (index: number): TraceView => ({ ...trace, index });

  it("marks nothing without a trace", () => {
    expect(traceMark(model, null, byName(model, "User service").id)).toBe("none");
  });

  it("marks the active node, visited nodes and untouched nodes", () => {
    const service = byName(model, "User service").id;
    const apiStep = trace.result.steps.findIndex((s) => s.node === service && s.dir === "req");
    expect(traceMark(model, at(apiStep), service)).toBe("active");
    expect(traceMark(model, at(trace.result.steps.length - 1), service)).toBe("visited");
    expect(traceMark(model, at(0), service)).toBe("dim");
  });

  it("marks response steps distinctly", () => {
    const service = byName(model, "User service").id;
    const resStep = trace.result.steps.findIndex((s) => s.node === service && s.dir === "res");
    expect(traceMark(model, at(resStep), service)).toBe("activeResponse");
  });

  it("treats a layer card as touched when a step lands inside its layer", () => {
    const backend = model.lnodes.find((l) => l.lid === "backend")!;
    const db = model.lnodes.find((l) => l.lid === "db")!;
    expect(traceMark(model, at(2), backend.id)).toBe("active");
    expect(traceMark(model, at(0), db.id)).toBe("dim");
  });

  it("records the direction each edge was last crossed up to the current step", () => {
    const early = edgeVisits(at(0));
    const late = edgeVisits(at(trace.result.steps.length - 1));
    expect(Object.keys(early)).toEqual([]);
    expect(Object.values(late)).toContain("res");
  });
});

describe("group boxes", () => {
  it("pads the bounds of visible members and skips groups with none visible", () => {
    const model = starter();
    model.groups.push({ id: "g1", name: "G" }, { id: "g2", name: "Empty" });
    const fn = byName(model, "fetchUser");
    fn.group = "g1";
    const boxes = groupBoxes(model, "client");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ id: "g1", name: "G", x: fn.x - 24, y: fn.y - 34, w: fn.w + 48, h: fn.h + 58 });
    expect(groupBoxes(model, "backend")).toEqual([]);
  });
});

describe("geometry overrides", () => {
  it("returns the same model when nothing is overridden", () => {
    const model = starter();
    expect(applyOverrides(model, NO_OVERRIDES)).toBe(model);
  });

  it("moves and resizes only the overridden nodes and layer cards", () => {
    const model = clone(starter());
    const fn = byName(model, "fetchUser");
    const layer = model.lnodes[0];
    const next = applyOverrides(model, {
      positions: { [fn.id]: { x: 1, y: 2 }, [layer.id]: { x: 3, y: 4 } },
      sizes: { [fn.id]: { w: 500, h: 400 } },
    });
    const moved = next.nodes.find((n) => n.id === fn.id)!;
    expect(moved).toMatchObject({ x: 1, y: 2, w: 500, h: 400 });
    expect(next.lnodes[0]).toMatchObject({ x: 3, y: 4 });
    expect(next.nodes.find((n) => n.id === byName(model, "User service").id)).toBe(model.nodes.find((n) => n.name === "User service"));
    expect(fn.x).not.toBe(1);
  });
});
