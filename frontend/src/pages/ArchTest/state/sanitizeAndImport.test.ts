import { describe, expect, it } from "vitest";
import { starter } from "../engine";
import { NO_SELECTION } from "./archApi";
import { modelFromImport } from "./importModel";
import { sanitizeSelection } from "./sanitizeSelection";

describe("sanitizeSelection", () => {
  const model = starter();
  const nodeId = model.nodes[0].id;
  const edgeId = model.edges[0].id;
  model.groups.push({ id: "g", name: "G" });
  const edgeExists = (id: string) => id === edgeId;

  it("returns an empty selection untouched", () => {
    expect(sanitizeSelection(NO_SELECTION, model, edgeExists)).toBe(NO_SELECTION);
  });

  it("keeps the same selection object when every id still exists", () => {
    const selection = { type: "node", ids: [nodeId] } as const;
    expect(sanitizeSelection(selection, model, edgeExists)).toBe(selection);
  });

  it("drops missing ids but keeps the rest", () => {
    const result = sanitizeSelection({ type: "node", ids: [nodeId, "gone"] }, model, edgeExists);
    expect(result).toEqual({ type: "node", ids: [nodeId] });
  });

  it("clears the selection when nothing is left, for nodes, edges and groups", () => {
    expect(sanitizeSelection({ type: "node", ids: ["gone"] }, model, edgeExists)).toBe(NO_SELECTION);
    expect(sanitizeSelection({ type: "edge", ids: ["gone"] }, model, edgeExists)).toBe(NO_SELECTION);
    expect(sanitizeSelection({ type: "edge", ids: [edgeId] }, model, edgeExists).type).toBe("edge");
    expect(sanitizeSelection({ type: "group", ids: ["gone"] }, model, edgeExists)).toBe(NO_SELECTION);
    expect(sanitizeSelection({ type: "group", ids: ["g"] }, model, edgeExists).type).toBe("group");
  });
});

describe("modelFromImport", () => {
  it("fills defaults for missing parts and the fallback name", () => {
    const model = modelFromImport({ nodes: [] }, "Keep me");
    expect(model).toMatchObject({ name: "Keep me", edges: [], groups: [], lnodes: [] });
    expect(model.views.overview).toEqual(model.view);
  });

  it("keeps imported parts", () => {
    const source = starter();
    const model = modelFromImport({ name: "Imported", nodes: source.nodes, edges: source.edges, groups: [], lnodes: source.lnodes }, "x");
    expect(model.name).toBe("Imported");
    expect(model.edges).toBe(source.edges);
    expect(model.lnodes).toBe(source.lnodes);
  });
});
