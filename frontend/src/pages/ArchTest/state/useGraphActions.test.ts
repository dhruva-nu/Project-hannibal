import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { clone, starter, type AnyEdge, type ArchModel, type DerivedEdge } from "../engine";
import { addNode, byName, link } from "../engine/testFixtures";
import { NO_SELECTION, type ModelMutator, type SelectionState } from "./archApi";
import { useGraphActions, type GraphDeps } from "./useGraphActions";

interface Setup {
  deps: GraphDeps;
  drafts: ArchModel[];
  run: <T>(fn: (actions: ReturnType<typeof useGraphActions>) => T) => T;
}

const setup = (options: { model?: ArchModel; selection?: SelectionState; commitRuns?: boolean; edges?: AnyEdge[] } = {}): Setup => {
  const model = options.model ?? starter();
  const drafts: ArchModel[] = [];
  const runs = options.commitRuns ?? true;
  const deps: GraphDeps = {
    model,
    scope: "backend",
    view: { x: 0, y: 0, k: 1 },
    selection: options.selection ?? NO_SELECTION,
    commit: vi.fn((mutator: ModelMutator) => {
      if (!runs) return;
      const draft = clone(model);
      mutator(draft);
      drafts.push(draft);
    }),
    select: vi.fn(),
    notify: vi.fn(),
    confirm: vi.fn(),
    undo: vi.fn(),
    edgeById: (id) => (options.edges ?? model.edges).find((e) => e.id === id),
    midpointOf: () => ({ x: 100, y: 100 }),
    viewportSize: () => ({ width: 800, height: 600 }),
    ensureVisible: vi.fn(),
  };
  const hook = renderHook(() => useGraphActions(deps));
  return { deps, drafts, run: (fn) => fn(hook.result.current) };
};

describe("addNode", () => {
  it("adds, selects and reveals the new node", () => {
    const { deps, run } = setup();
    run((a) => a.addNode("api"));
    expect(deps.select).toHaveBeenCalledWith({ type: "node", ids: [expect.any(String)] });
    expect(deps.ensureVisible).toHaveBeenCalled();
  });

  it("does nothing further when the commit produced no node", () => {
    const { deps, run } = setup({ commitRuns: false });
    run((a) => a.addNode("api"));
    expect(deps.select).not.toHaveBeenCalled();
  });
});

describe("connect", () => {
  it("ignores a connection to itself", () => {
    const { deps, run } = setup();
    run((a) => a.connect("x", "x", true));
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it("tells the user when the pair is already connected", () => {
    const model = starter();
    const edge = model.edges[0];
    const { deps, run } = setup({ model });
    run((a) => a.connect(edge.from, edge.to, true));
    expect(deps.notify).toHaveBeenCalledWith({ message: "Those two are already connected in that direction" });
  });

  it("creates the edge and selects it when asked", () => {
    const model = starter();
    const { deps, drafts, run } = setup({ model });
    const from = byName(model, "Get user").id;
    const to = byName(model, "fetchUser").id;
    run((a) => a.connect(from, to, true));
    expect(drafts[0].edges.some((e) => e.from === from && e.to === to)).toBe(true);
    expect(deps.select).toHaveBeenCalledWith({ type: "edge", ids: [expect.any(String)] });
  });

  it("does not select the new edge when not asked, or when nothing was created", () => {
    const model = starter();
    const from = byName(model, "Get user").id;
    const to = byName(model, "fetchUser").id;
    const quiet = setup({ model });
    quiet.run((a) => a.connect(from, to, false));
    expect(quiet.deps.select).not.toHaveBeenCalled();
    const none = setup({ model, commitRuns: false });
    none.run((a) => a.connect(from, to, true));
    expect(none.deps.select).not.toHaveBeenCalled();
  });
});

describe("insertOnEdge", () => {
  it("ignores unknown edges", () => {
    const { deps, run } = setup();
    run((a) => a.insertOnEdge("nope", "redis"));
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it("inserts infrastructure into a derived edge, selects it and notifies", () => {
    const model = starter();
    const derived: DerivedEdge = {
      id: "ov",
      from: "a",
      to: "b",
      label: "",
      map: [],
      derived: true,
      ids: model.edges.filter((e) => e.from === byName(model, "fetchUser").id).map((e) => e.id),
    };
    const { deps, drafts, run } = setup({ model, edges: [derived] });
    run((a) => a.insertOnEdge("ov", "redis"));
    expect(drafts[0].nodes.some((n) => n.type === "redis")).toBe(true);
    expect(deps.select).toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith({ message: "Inserted into the connection. Drag it to reposition." });
  });

  it("still notifies when no node was created", () => {
    const { deps, run } = setup({ commitRuns: false });
    run((a) => a.insertOnEdge(deps.model.edges[0].id, "redis"));
    expect(deps.select).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalled();
  });
});

describe("deleting edges", () => {
  it("ignores unknown edges", () => {
    const { deps, run } = setup();
    run((a) => a.askDeleteEdge("nope"));
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("deletes a real edge immediately with an undo notice", () => {
    const model = starter();
    const edge = model.edges[0];
    const { deps, drafts, run } = setup({ model });
    run((a) => a.askDeleteEdge(edge.id));
    expect(drafts[0].edges.some((e) => e.id === edge.id)).toBe(false);
    expect(deps.select).toHaveBeenCalledWith(NO_SELECTION);
    const notice = vi.mocked(deps.notify).mock.calls[0][0];
    expect(notice.message).toBe("Connection deleted");
    notice.onAction?.();
    expect(deps.undo).toHaveBeenCalled();
  });

  it("asks before deleting a derived edge and reports the plural count", () => {
    const model = starter();
    const second = addNode(model, "function", "second");
    link(model, second, byName(model, "Get user"));
    const ids = model.edges.filter((e) => e.to === byName(model, "Get user").id).map((e) => e.id);
    const derived: DerivedEdge = { id: "ov", from: "a", to: "b", label: "", map: [], derived: true, ids };
    const { deps, run } = setup({ model, edges: [derived] });
    run((a) => a.askDeleteEdge("ov"));
    const request = vi.mocked(deps.confirm).mock.calls[0][0];
    expect(request.message).toContain("Delete all 2 connection(s)");
    request.onConfirm();
    expect(vi.mocked(deps.notify).mock.calls[0][0].message).toBe("2 connections deleted");
  });
});

describe("askDeleteSelection", () => {
  it("does nothing without a selection", () => {
    const { deps, run } = setup();
    run((a) => a.askDeleteSelection());
    expect(deps.confirm).not.toHaveBeenCalled();
    const empty = setup({ selection: { type: "node", ids: [] } });
    empty.run((a) => a.askDeleteSelection());
    expect(empty.deps.confirm).not.toHaveBeenCalled();
  });

  it("deletes the selected edge directly", () => {
    const model = starter();
    const { deps, run } = setup({ model, selection: { type: "edge", ids: [model.edges[0].id] } });
    run((a) => a.askDeleteSelection());
    expect(deps.commit).toHaveBeenCalled();
  });

  it("confirms deleting a single named node and removes it", () => {
    const model = starter();
    const id = byName(model, "Get user").id;
    const { deps, drafts, run } = setup({ model, selection: { type: "node", ids: [id] } });
    run((a) => a.askDeleteSelection());
    const request = vi.mocked(deps.confirm).mock.calls[0][0];
    expect(request.message).toBe("Delete Get user? Connections to it are removed too.");
    request.onConfirm();
    expect(drafts[0].nodes.some((n) => n.id === id)).toBe(false);
    expect(deps.select).toHaveBeenCalledWith(NO_SELECTION);
  });

  it("words multi-selection and unknown items accordingly", () => {
    const model = starter();
    const ids = [byName(model, "Get user").id, byName(model, "fetchUser").id];
    const many = setup({ model, selection: { type: "node", ids } });
    many.run((a) => a.askDeleteSelection());
    expect(vi.mocked(many.deps.confirm).mock.calls[0][0].message).toBe("Delete 2 components? Connections to them are removed too.");
    const unknown = setup({ model, selection: { type: "node", ids: ["ghost"] } });
    unknown.run((a) => a.askDeleteSelection());
    expect(vi.mocked(unknown.deps.confirm).mock.calls[0][0].message).toContain("this item");
  });

  it("confirms deleting a group with its members and ignores a missing group", () => {
    const model = starter();
    const fn = byName(model, "fetchUser");
    fn.group = "g";
    model.groups.push({ id: "g", name: "Team" });
    const { deps, drafts, run } = setup({ model, selection: { type: "group", ids: ["g"] } });
    run((a) => a.askDeleteSelection());
    const request = vi.mocked(deps.confirm).mock.calls[0][0];
    expect(request.message).toBe('Delete the group "Team" and the 1 components inside it?');
    request.onConfirm();
    expect(drafts[0].nodes.some((n) => n.id === fn.id)).toBe(false);
    const missing = setup({ model, selection: { type: "group", ids: ["nope"] } });
    missing.run((a) => a.askDeleteSelection());
    expect(missing.deps.confirm).not.toHaveBeenCalled();
  });
});

describe("grouping and small edits", () => {
  it("explains how to select before grouping", () => {
    const { deps, run } = setup();
    run((a) => a.groupSelected());
    expect(vi.mocked(deps.notify).mock.calls[0][0].message).toContain("Select components first");
    const wrongType = setup({ selection: { type: "edge", ids: ["e"] } });
    wrongType.run((a) => a.groupSelected());
    expect(wrongType.deps.notify).toHaveBeenCalled();
  });

  it("groups the selected nodes and selects the group", () => {
    const model = starter();
    const id = byName(model, "fetchUser").id;
    const { deps, drafts, run } = setup({ model, selection: { type: "node", ids: [id] } });
    run((a) => a.groupSelected());
    expect(drafts[0].groups).toHaveLength(1);
    expect(deps.select).toHaveBeenCalledWith({ type: "group", ids: [expect.any(String)] });
  });

  it("does not select a group when none was created", () => {
    const { deps, run } = setup({ selection: { type: "node", ids: ["x"] }, commitRuns: false });
    run((a) => a.groupSelected());
    expect(deps.select).not.toHaveBeenCalled();
  });

  it("flips, ungroups and adds functions through commits", () => {
    const model = starter();
    const edge = model.edges[0];
    const { deps, drafts, run } = setup({ model });
    run((a) => a.flipEdge(edge.id));
    expect(drafts[0].edges.find((e) => e.id === edge.id)?.from).toBe(edge.to);
    run((a) => a.ungroup("g"));
    expect(deps.select).toHaveBeenCalledWith(NO_SELECTION);
    run((a) => a.addFunctionTo(byName(model, "UserProfile").id, "Polling"));
    expect(drafts[2].nodes.some((n) => n.name === "poll")).toBe(true);
  });
});
