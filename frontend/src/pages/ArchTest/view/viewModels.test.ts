import { describe, expect, it } from "vitest";
import { clone, simulate, starter, type ApiNode, type ArchModel, type FunctionNode } from "../engine";
import { addNode, byName, link } from "../engine/testFixtures";
import { traceViewFor } from "../components/overlays/testHarness";
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
    expect(isVisible(byName(model, "Get user"), null)).toBe(false);
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
    link(model, second, byName(model, "Get user"));
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
    expect(vis.edges).toHaveLength(3);
    expect(Object.keys(vis.derivedById)).toEqual([]);
  });

  it("ignores edges that do not touch the scope, edges with missing nodes and repeated external neighbours", () => {
    const model = starter();
    const api = byName<ApiNode>(model, "Get user");
    const extra = addNode<FunctionNode>(model, "function", "extra");
    link(model, extra, api);
    link(model, byName(model, "fetchUser"), api);
    model.edges.push({ id: "dangling", from: "nope", to: api.id, label: "", map: [] });
    const vis = computeVisibility(model, "db");
    expect(vis.edges).toHaveLength(1);
    expect(Object.keys(vis.ghosts)).toHaveLength(1);
    const backend = computeVisibility(model, "backend");
    expect(Object.keys(backend.ghosts).length).toBe(3);
  });

  it("offsets ghosts that would collide and handles unlayered neighbours by edge direction", () => {
    const model = starter();
    const api = byName(model, "Get user");
    const sameColumn = addNode<FunctionNode>(model, "function", "sameColumn");
    link(model, sameColumn, api);
    const redisIn = addNode(model, "redis", "cacheIn");
    const redisOut = addNode(model, "redis", "cacheOut");
    redisIn.layer = null;
    redisOut.layer = null;
    link(model, redisIn, api);
    link(model, api, redisOut);
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
    expect(boxOf(byName(model, "Get user").id)?.w).toBeGreaterThan(0);
    expect(boxOf("missing")).toBeUndefined();
  });
});

describe("buildEdgeScene", () => {
  it("draws overview edges with a connection-count chip in flow mode", () => {
    const model = starter();
    const second = addNode<FunctionNode>(model, "function", "second");
    link(model, second, byName(model, "Get user"));
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
    expect(labelled.chips).toHaveLength(1);
    expect(labelled.chips[0].kind).toBe("label");
    edge.label = "";
    expect(buildEdgeScene(sceneInput(model, { scope: "client" })).chips).toHaveLength(0);
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

  it("draws state read and write links with chips only in the client layer", () => {
    const model = starter();
    const scene = buildEdgeScene(sceneInput(model, { scope: "client", showStateLinks: true }));
    expect(scene.stateLinks.length).toBeGreaterThan(0);
    const texts = scene.chips.filter((c) => c.kind === "state").map((c) => c.text);
    expect(texts.some((t) => t.startsWith("reads "))).toBe(true);
    expect(texts.some((t) => t.startsWith("writes "))).toBe(true);
    expect(buildEdgeScene(sceneInput(model, { scope: "backend", showStateLinks: true })).stateLinks).toEqual([]);
  });

  it("omits state links whose endpoint is not visible", () => {
    const model = starter();
    const state = byName(model, "App state");
    state.layer = "backend";
    const scene = buildEdgeScene(sceneInput(model, { scope: "client", showStateLinks: true }));
    expect(scene.stateLinks).toEqual([]);
  });
});

describe("trace highlighting", () => {
  const model = starter();
  const trace = traceViewFor(model);
  const at = (index: number): TraceView => ({ ...trace, index });

  it("marks nothing without a trace", () => {
    expect(traceMark(model, null, byName(model, "Get user").id)).toBe("none");
  });

  it("marks the active node, visited nodes and untouched nodes", () => {
    const api = byName(model, "Get user").id;
    const apiStep = trace.result.steps.findIndex((s) => s.node === api && s.dir === "req");
    expect(traceMark(model, at(apiStep), api)).toBe("active");
    expect(traceMark(model, at(trace.result.steps.length - 1), api)).toBe("visited");
    expect(traceMark(model, at(0), api)).toBe("dim");
  });

  it("marks response steps distinctly", () => {
    const api = byName(model, "Get user").id;
    const resStep = trace.result.steps.findIndex((s) => s.node === api && s.dir === "res");
    expect(traceMark(model, at(resStep), api)).toBe("activeResponse");
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
    expect(next.nodes.find((n) => n.id === byName(model, "Get user").id)).toBe(model.nodes.find((n) => n.name === "Get user"));
    expect(fn.x).not.toBe(1);
  });
});
