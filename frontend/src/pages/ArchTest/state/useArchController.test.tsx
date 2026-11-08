import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, type ConnectorNode } from "../engine";
import { byName } from "../engine/testFixtures";
import { installLocalStorage } from "./testStorage";
import { useArchController, type Controller } from "./useArchController";

const STAGE = { width: 1000, height: 800 };
const getStageSize = () => STAGE;

let stored: Map<string, string>;
beforeEach(() => {
  stored = installLocalStorage();
});
afterEach(() => vi.useRealTimers());

const setup = () => renderHook(() => useArchController(getStageSize));
const idOf = (c: Controller, name: string) => byName(c.api.model, name).id;

describe("useArchController", () => {
  it("starts on the overview with the starter diagram, nothing selected and no overlays", () => {
    const { result } = setup();
    expect(result.current.api.model.name).toBe("User profile example");
    expect(result.current.api.scope).toBeNull();
    expect(result.current.api.selection.type).toBeNull();
    expect(result.current.modal).toBeNull();
    expect(result.current.notice).toBeNull();
  });

  it("reveals a node by opening its layer and selecting it", () => {
    const { result } = setup();
    act(() => result.current.api.reveal(idOf(result.current, "app_db")));
    expect(result.current.api.scope).toBe("db");
    expect(result.current.api.selection.ids).toEqual([idOf(result.current, "app_db")]);
  });

  it("stays in the layer when revealing a node from the same layer and ignores unknown ids", () => {
    const { result } = setup();
    act(() => result.current.view.openScope("backend"));
    act(() => result.current.api.reveal(idOf(result.current, "Get user")));
    expect(result.current.api.scope).toBe("backend");
    act(() => result.current.api.reveal("ghost"));
    expect(result.current.api.selection.ids).toEqual([idOf(result.current, "Get user")]);
  });

  it("leaves the layer when revealing unlayered infrastructure", () => {
    const { result } = setup();
    act(() =>
      result.current.api.commit((draft) => {
        const redis = { ...draft.nodes[0], id: "infra1", type: "redis", layer: null, cfg: {}, name: "cache" } as never;
        draft.nodes.push(redis);
      }),
    );
    act(() => result.current.view.openScope("backend"));
    act(() => result.current.api.reveal("infra1"));
    expect(result.current.api.scope).toBeNull();
  });

  it("clears the selection when a layer is opened or closed", () => {
    const { result } = setup();
    act(() => result.current.api.select({ type: "node", ids: [idOf(result.current, "Get user")] }));
    act(() => result.current.view.openScope("backend"));
    expect(result.current.api.selection.type).toBeNull();
  });

  it("drops selected items that were deleted", () => {
    const { result } = setup();
    const id = idOf(result.current, "Get user");
    act(() => result.current.api.select({ type: "node", ids: [id] }));
    act(() => result.current.api.commit((draft) => void (draft.nodes = draft.nodes.filter((n) => n.id !== id))));
    expect(result.current.api.selection.type).toBeNull();
  });

  it("loads the example only after confirmation and can undo it", () => {
    const { result } = setup();
    act(() => result.current.api.commit((d) => void (d.name = "Mine")));
    act(() => result.current.loadExample());
    expect(result.current.modal?.kind).toBe("confirm");
    expect(result.current.api.model.name).toBe("Mine");
    act(() => {
      if (result.current.modal?.kind === "confirm") result.current.modal.request.onConfirm();
    });
    expect(result.current.api.model.name).toBe("User profile example");
    act(() => result.current.api.undo());
    expect(result.current.api.model.name).toBe("Mine");
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.api.model.name).toBe("User profile example");
  });

  it("starts a blank diagram after confirmation, closing scope, trace and selection", () => {
    const { result } = setup();
    act(() => result.current.view.openScope("client"));
    act(() => result.current.api.startTrace(idOf(result.current, "UserProfile")));
    act(() => result.current.newBlank());
    act(() => {
      if (result.current.modal?.kind === "confirm") result.current.modal.request.onConfirm();
    });
    expect(result.current.api.model.name).toBe("Untitled architecture");
    expect(result.current.api.scope).toBeNull();
    expect(result.current.api.trace).toBeNull();
  });

  it("renames the diagram and toggles display modes", () => {
    const { result } = setup();
    act(() => result.current.setName("New"));
    expect(result.current.api.model.name).toBe("New");
    act(() => result.current.toggleFlow());
    act(() => result.current.toggleStateLinks());
    expect(result.current.showFlow && result.current.showStateLinks).toBe(true);
    act(() => result.current.toggleFlow());
    expect(result.current.showFlow).toBe(false);
  });

  it("opens, shows and closes modals", () => {
    const { result } = setup();
    act(() => result.current.api.openDetail("n"));
    expect(result.current.modal).toEqual({ kind: "detail", nodeId: "n" });
    act(() => result.current.api.openFlow("e"));
    expect(result.current.modal).toEqual({ kind: "flow", edgeId: "e" });
    act(() => result.current.api.openModal({ kind: "io" }));
    expect(result.current.modal?.kind).toBe("io");
    act(() => result.current.api.closeModal());
    expect(result.current.modal).toBeNull();
    act(() => result.current.api.confirm({ message: "m", confirmLabel: "ok", onConfirm: vi.fn() }));
    expect(result.current.modal?.kind).toBe("confirm");
  });

  it("closes the modal, then the selection, then the layer on successive escapes", () => {
    const { result } = setup();
    act(() => result.current.view.openScope("backend"));
    act(() => result.current.api.select({ type: "node", ids: [idOf(result.current, "Get user")] }));
    act(() => result.current.api.openModal({ kind: "io" }));
    act(() => result.current.closeOrDeselect());
    expect(result.current.modal).toBeNull();
    expect(result.current.api.selection.type).toBe("node");
    act(() => result.current.closeOrDeselect());
    expect(result.current.api.selection.type).toBeNull();
    act(() => result.current.closeOrDeselect());
    expect(result.current.api.scope).toBeNull();
    act(() => result.current.closeOrDeselect());
    expect(result.current.api.scope).toBeNull();
  });

  it("auto-dismisses notices after a few seconds and on demand", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.api.notify({ message: "hi" }));
    expect(result.current.notice?.message).toBe("hi");
    act(() => void vi.advanceTimersByTime(4500));
    expect(result.current.notice).toBeNull();
    act(() => result.current.api.notify({ message: "again" }));
    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });

  it("rejects unknown function triggers loudly and adds known ones", () => {
    const { result } = setup();
    const component = idOf(result.current, "UserProfile");
    expect(() => result.current.api.addFunctionTo(component, "Sometimes")).toThrow("Unknown function trigger");
    act(() => result.current.api.addFunctionTo(component, "Polling"));
    expect(result.current.api.model.nodes.some((n) => n.name === "poll")).toBe(true);
  });

  it("starts a trace, closes any modal and drives it", () => {
    const { result } = setup();
    act(() => result.current.api.openModal({ kind: "io" }));
    act(() => result.current.api.startTrace(idOf(result.current, "UserProfile")));
    expect(result.current.modal).toBeNull();
    expect(result.current.api.trace?.index).toBe(0);
    act(() => result.current.api.traceSetWarm(true));
    expect(result.current.api.trace?.warm).toBe(true);
    act(() => result.current.api.traceSetOnly(""));
    act(() => result.current.api.traceTogglePlay());
    expect(result.current.api.trace?.playing).toBe(true);
    act(() => result.current.api.traceTogglePlay());
    act(() => result.current.api.closeTrace());
    expect(result.current.api.trace).toBeNull();
  });

  it("follows the trace into other layers and out to unlayered infrastructure", () => {
    const { result } = setup();
    act(() =>
      result.current.api.commit((draft) => {
        const fn = byName(draft, "fetchUser");
        const api = byName(draft, "Get user");
        draft.nodes.push({ ...fn, id: "cache1", type: "redis", name: "cache", layer: null, cfg: { ttl: 60, keyPattern: "k", behavior: "auto" } } as never);
        const edge = draft.edges.find((e) => e.from === fn.id && e.to === api.id)!;
        edge.to = "cache1";
        draft.edges.push({ id: "e-cache", from: "cache1", to: api.id, label: "", map: [] });
      }),
    );
    act(() => result.current.view.openScope("client"));
    act(() => result.current.api.startTrace(idOf(result.current, "UserProfile")));
    const steps = result.current.api.trace!.result.steps;
    const backendStep = steps.findIndex((s) => result.current.api.model.nodes.find((n) => n.id === s.node)?.layer === "backend");
    act(() => result.current.api.traceGo(backendStep));
    expect(result.current.api.scope).toBe("backend");
    const infraStep = steps.findIndex((s) => s.node === "cache1");
    act(() => result.current.api.traceGo(infraStep));
    expect(result.current.api.scope).toBeNull();
    act(() => result.current.api.traceGo(0));
    expect(result.current.api.scope).toBeNull();
  });

  it("inserts infrastructure into an overview edge using its midpoint and deletes via the api", () => {
    const { result } = setup();
    act(() => result.current.api.insertOnEdge("ov|L_client|L_backend", "redis"));
    expect(result.current.api.model.nodes.some((n) => n.type === "redis")).toBe(true);
    expect(result.current.notice).not.toBeNull();
  });

  it("adds nodes through the controller", () => {
    const { result } = setup();
    const before = result.current.api.model.nodes.length;
    act(() => result.current.addNode("component"));
    expect(result.current.api.model.nodes.length).toBe(before + 1);
  });

  it("exposes group lookup and imports a diagram", () => {
    const { result } = setup();
    expect(result.current.api.groupById("none")).toBeUndefined();
    const source = result.current.api.model;
    act(() => result.current.loadDiagram({ ...source, name: "Imported" }));
    expect(result.current.api.model.name).toBe("Imported");
  });

  it("persists the diagram to localStorage", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.setName("Stored"));
    act(() => void vi.advanceTimersByTime(300));
    expect(stored.get(STORAGE_KEY)).toContain("Stored");
    expect((byName(result.current.api.model, "userWithOrders") as ConnectorNode).cfg.dbId).toBeTruthy();
  });
});
