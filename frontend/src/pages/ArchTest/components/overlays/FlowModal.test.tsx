import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { starter, type DerivedEdge } from "../../engine";
import { FlowModal } from "./FlowModal";
import { nodeOfType, renderWithArch } from "./testHarness";

describe("FlowModal", () => {
  it("renders nothing for unknown edges or endpoints", () => {
    expect(renderWithArch(<FlowModal edgeId="nope" onClose={vi.fn()} />).container.innerHTML).toBe("");
    const model = starter();
    const edge = model.edges[0];
    const { container } = renderWithArch(<FlowModal edgeId={edge.id} onClose={vi.fn()} />, model, {
      edgeById: () => ({ ...edge, from: "ghost" }),
    });
    expect(container.innerHTML).toBe("");
  });

  it("compares fields with mapping for a real connection", () => {
    const model = starter();
    const fn = nodeOfType(model, "function");
    const api = nodeOfType(model, "api");
    const edge = model.edges.find((e) => e.from === fn.id && e.to === api.id);
    if (!edge) throw new Error("edge");
    renderWithArch(<FlowModal edgeId={edge.id} onClose={vi.fn()} />, model);
    expect(screen.getByRole("dialog", { name: "fetchUser → Get user" })).toBeTruthy();
    expect(screen.getByText("Target expects")).toBeTruthy();
    expect(screen.getByText("mapped")).toBeTruthy();
    expect(screen.getByText("Full request payload")).toBeTruthy();
    expect(screen.getByText("Full response payload")).toBeTruthy();
  });

  it("links to the originating components and reveals them", () => {
    const model = starter();
    const comp = nodeOfType(model, "component");
    const fn = nodeOfType(model, "function");
    const edge = model.edges.find((e) => e.from === comp.id && e.to === fn.id);
    if (!edge) throw new Error("edge");
    const { api } = renderWithArch(<FlowModal edgeId={edge.id} onClose={vi.fn()} />, model);
    expect(screen.getAllByRole("button", { name: "UserProfile" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "UserProfile" })[0]);
    expect(api.closeModal).toHaveBeenCalled();
    expect(api.reveal).toHaveBeenCalledWith(comp.id);
  });

  it("shows the match box and the missing-response note", () => {
    const model = starter();
    const fn = nodeOfType(model, "function");
    const comp = nodeOfType(model, "component");
    const edge = model.edges.find((e) => e.from === comp.id && e.to === fn.id);
    if (!edge) throw new Error("edge");
    renderWithArch(<FlowModal edgeId={edge.id} onClose={vi.fn()} />, model, {
      flow: { edges: {}, nodes: {}, nodeWarn: {} },
    });
    expect(screen.getByText(/The payload matches what fetchUser expects/)).toBeTruthy();
    expect(screen.getByText("No response recorded for this connection yet.")).toBeTruthy();
  });

  it("lists schema mismatches", () => {
    const model = starter();
    const fn = nodeOfType(model, "function");
    const comp = nodeOfType(model, "component");
    fn.cfg.input = '{"needed": 1}';
    const edge = model.edges.find((e) => e.from === comp.id && e.to === fn.id);
    if (!edge) throw new Error("edge");
    renderWithArch(<FlowModal edgeId={edge.id} onClose={vi.fn()} />, model);
    expect(screen.getByText("Schema mismatch")).toBeTruthy();
    expect(screen.getByText("needed is expected (number) but not provided")).toBeTruthy();
  });

  it("lists the connections behind an overview edge and opens one", () => {
    const model = starter();
    const [real] = model.edges;
    const derived: DerivedEdge = {
      id: "ov|a|b",
      from: model.edges[1].from,
      to: model.edges[1].to,
      label: "",
      map: [],
      derived: true,
      ids: [real.id, "stale-id"],
    };
    const { api } = renderWithArch(<FlowModal edgeId={derived.id} onClose={vi.fn()} />, model, {
      edgeById: () => derived,
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Payload" })[0]);
    expect(api.openFlow).toHaveBeenCalledWith(real.id);
  });
});
