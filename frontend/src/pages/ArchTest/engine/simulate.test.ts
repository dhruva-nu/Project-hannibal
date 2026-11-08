import { afterEach, describe, expect, it, vi } from "vitest";
import { edgeInfo, emptyFlow, simulate } from "./simulate";
import { mkEdge } from "./model";
import { addNode, byName, link, starterModel } from "./testFixtures";
import type { ArchEdge, ComponentNode, DerivedEdge } from "./types";

afterEach(() => vi.restoreAllMocks());

describe("simulate", () => {
  it("records payloads on every connection of the starter diagram", () => {
    const model = starterModel();
    const flow = simulate(model);
    const component = byName(model, "UserProfile");
    const fn = byName(model, "fetchUser");
    const api = byName(model, "Get user");
    const toFn = model.edges.find((e) => e.from === component.id && e.to === fn.id) as ArchEdge;
    const toApi = model.edges.find((e) => e.from === fn.id && e.to === api.id) as ArchEdge;
    expect(flow.edges[toFn.id].req).toEqual({ userId: 1 });
    expect(flow.edges[toApi.id]).toMatchObject({ src: { userId: 1 }, req: { id: 1, includeOrders: true }, warns: [] });
    expect(flow.edges[toApi.id].res).toMatchObject({ user: { id: 1 } });
    expect(flow.nodes[api.id].in).toEqual({ id: 1, includeOrders: true });
    expect(flow.nodes[api.id].out).toMatchObject({ user: { id: 1 } });
    expect(flow.nodes[component.id]).toEqual({});
    expect(flow.nodeWarn).toEqual({});
  });

  it("collects unique warnings and node warnings", () => {
    const model = starterModel();
    byName<ComponentNode>(model, "UserProfile").cfg.input = '{"extra":1}';
    const api = byName(model, "Get user");
    const second = addNode<ComponentNode>(model, "component", "Second", { output: '{"userId":"s"}' });
    const third = addNode<ComponentNode>(model, "component", "Third", { output: '{"userId":"s"}' });
    link(model, second, byName(model, "fetchUser"));
    link(model, third, byName(model, "fetchUser"));
    const flow = simulate(model);
    const toApi = model.edges.find((e) => e.to === api.id) as ArchEdge;
    expect(flow.edges[toApi.id].warns).toHaveLength(1);
    expect(flow.nodeWarn[byName(model, "UserProfile").id]).toEqual([{ path: "extra", kind: "missing", exp: "number" }]);
  });

  it("logs and skips components whose trace fails", () => {
    const model = starterModel();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    (byName<ComponentNode>(model, "UserProfile").cfg as { writes?: unknown }).writes = undefined;
    const flow = simulate(model);
    expect(log).toHaveBeenCalledTimes(1);
    expect(flow).toEqual(emptyFlow());
  });
});

describe("edgeInfo", () => {
  it("summarises derived edges by their member warnings", () => {
    const model = starterModel();
    const real = model.edges[0];
    const derived: DerivedEdge = { id: "ov|a|b", from: "a", to: "b", label: "", map: [], derived: true, ids: [real.id, "gone"] };
    expect(edgeInfo(model, simulate(model), derived)).toEqual({ warns: [], sim: true, count: 2 });
    const warned = simulate(model);
    warned.edges[real.id] = { warns: [{ path: "p", kind: "missing", exp: "number" }], req: {} };
    expect(edgeInfo(model, warned, derived).warns).toHaveLength(1);
  });

  it("prefers simulated data and falls back to static analysis", () => {
    const model = starterModel();
    const toApi = model.edges.find((e) => e.to === byName(model, "Get user").id) as ArchEdge;
    const simulated = edgeInfo(model, simulate(model), toApi);
    expect(simulated.sim).toBe(true);
    expect(simulated.req).toEqual({ id: 1, includeOrders: true });
    const staticInfo = edgeInfo(model, emptyFlow(), toApi);
    expect(staticInfo).toMatchObject({ sim: false, src: { userId: 1 }, req: { id: 1, includeOrders: true }, warns: [] });
    expect(staticInfo.res).toBeUndefined();
    const partial = emptyFlow();
    partial.edges[toApi.id] = { warns: [], res: { r: 1 } };
    expect(edgeInfo(model, partial, toApi).res).toEqual({ r: 1 });
    const unexpected = mkEdge(byName(model, "fetchUser").id, byName(model, "Get user").id);
    expect(edgeInfo(model, emptyFlow(), unexpected).warns).toEqual([{ path: "id", kind: "missing", exp: "number" }]);
  });

  it("copes with edges whose nodes are missing", () => {
    const model = starterModel();
    const dangling = mkEdge("ghost", "ghost2");
    expect(edgeInfo(model, emptyFlow(), dangling)).toMatchObject({ src: {}, req: {}, warns: [] });
  });
});
