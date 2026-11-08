import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  mkNode,
  starter,
  type ComponentNode,
  type FunctionNode,
  type StateNode,
} from "../../engine";
import { idOf, renderSelectedNode } from "./testHarness";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ComponentPanel", () => {
  it("commits edits to the description and JSON contract", () => {
    const view = renderSelectedNode("UserProfile");
    change("Short description of the data it expects", "New description");
    change("Expected input, JSON", '{"a":1}');
    change("Output sent when the user interacts, JSON", '{"b":2}');
    const node = view.nodeNamed("UserProfile") as ComponentNode;
    expect(node.cfg.desc).toBe("New description");
    expect(node.cfg.input).toBe('{"a":1}');
    expect(node.cfg.output).toBe('{"b":2}');
  });

  it("renames the node, assigns a group and shows header actions", () => {
    const model = starter();
    model.groups.push({ id: "g1", name: "Group 1" });
    model.nodes.find((n) => n.name === "fetchUser")!.group = "g1";
    const view = renderSelectedNode("UserProfile", model);
    change("Name", "Profile");
    change("Group", "g1");
    expect(view.nodeNamed("Profile").group).toBe("g1");
    fireEvent.click(screen.getByText("Trace request"));
    fireEvent.click(screen.getByText("Detail view"));
    fireEvent.click(screen.getByText("Delete"));
    expect(view.stubs.startTrace).toHaveBeenCalledWith(idOf(view.model(), "Profile"));
    expect(view.stubs.openDetail).toHaveBeenCalled();
    expect(view.stubs.askDeleteSelection).toHaveBeenCalled();
  });

  it("adds, detaches and attaches functions", () => {
    const model = starter();
    const orphan = mkNode("function", 0, 0, { name: "orphan" });
    model.nodes.push(orphan);
    const view = renderSelectedNode("UserProfile", model);
    const componentId = idOf(model, "UserProfile");

    change("New function trigger", "Polling");
    fireEvent.click(screen.getByText("Add function"));
    expect(view.stubs.addFunctionTo).toHaveBeenCalledWith(componentId, "Polling");

    fireEvent.click(screen.getByText("Attach existing"));
    expect(view.stubs.connect).toHaveBeenCalledWith(componentId, orphan.id, false);

    fireEvent.change(screen.getByLabelText("Existing function"), { target: { value: orphan.id } });
    fireEvent.click(screen.getByLabelText("Detach fetchUser"));
    expect(view.model().edges.some((e) => e.from === componentId && e.to === idOf(model, "fetchUser"))).toBe(false);
  });

  it("shows an empty-state note when no function is attached and none are free", () => {
    const model = starter();
    model.edges = model.edges.filter((e) => e.from !== idOf(model, "UserProfile"));
    model.nodes = model.nodes.filter((n) => n.name !== "fetchUser");
    renderSelectedNode("UserProfile", model);
    expect(screen.getByText("No functions attached.")).toBeTruthy();
    expect(screen.queryByText("Attach existing")).toBeNull();
  });

  it("toggles state reads and edits modified state rows", () => {
    const view = renderSelectedNode("UserProfile");
    fireEvent.click(screen.getByLabelText("currentUser"));
    fireEvent.click(screen.getByLabelText("isLoading"));
    expect((view.nodeNamed("UserProfile") as ComponentNode).cfg.reads.sort()).toEqual(["v_loading", "v_orders"]);

    fireEvent.click(screen.getByText("Add modified state"));
    expect((view.nodeNamed("UserProfile") as ComponentNode).cfg.writes).toEqual([{ varId: "v_user", from: "" }]);
    change("Value path", "user");
    change("Modified state variable", "v_orders");
    expect((view.nodeNamed("UserProfile") as ComponentNode).cfg.writes).toEqual([{ varId: "v_orders", from: "user" }]);
    fireEvent.click(screen.getByLabelText("Remove"));
    expect((view.nodeNamed("UserProfile") as ComponentNode).cfg.writes).toEqual([]);
  });

  it("explains how to link state when there are no variables", () => {
    const model = starter();
    model.nodes = model.nodes.filter((n) => n.type !== "state");
    renderSelectedNode("UserProfile", model);
    expect(screen.getByText("Add a State viewer and define variables to link them here.")).toBeTruthy();
  });

  it("lists the APIs the component can reach and reveals them on click", () => {
    const view = renderSelectedNode("UserProfile");
    fireEvent.click(screen.getByText("Get user"));
    expect(view.stubs.reveal).toHaveBeenCalledWith(idOf(view.model(), "Get user"));
  });
});

describe("FunctionPanel", () => {
  it("shows trigger specific fields", () => {
    const view = renderSelectedNode("fetchUser");
    expect(screen.queryByLabelText("Interval (ms)")).toBeNull();

    change("Runs on", "Polling");
    change("Interval (ms)", "250");
    expect((view.nodeNamed("fetchUser") as FunctionNode).cfg.interval).toBe(250);

    change("Runs on", "On Component Change");
    change("Watches (comma separated state or props)", "a, b");
    expect((view.nodeNamed("fetchUser") as FunctionNode).cfg.deps).toBe("a, b");

    change("Runs on", "WebSocket");
    change("Socket URL", "wss://x");
    expect((view.nodeNamed("fetchUser") as FunctionNode).cfg.url).toBe("wss://x");
  });

  it("edits the data contract and modified state, and links neighbours", () => {
    const view = renderSelectedNode("fetchUser");
    change("Expects from the component, JSON", '{"userId":2}');
    change("Sends onward, JSON (blank = pass the input through)", '{"userId":3}');
    const fn = view.nodeNamed("fetchUser") as FunctionNode;
    expect(fn.cfg.input).toBe('{"userId":2}');
    expect(fn.cfg.output).toBe('{"userId":3}');
    fireEvent.click(screen.getByText("UserProfile"));
    expect(view.stubs.reveal).toHaveBeenCalled();
    expect(screen.getAllByLabelText("Value path")).toHaveLength(2);
  });
});

describe("StatePanel", () => {
  it("adds, edits and removes variables", () => {
    const view = renderSelectedNode("App state");
    fireEvent.click(screen.getByText("Add variable"));
    const vars = () => (view.nodeNamed("App state") as StateNode).cfg.vars;
    expect(vars()).toHaveLength(4);
    expect(vars()[3].name).toBe("variable4");

    fireEvent.change(screen.getAllByLabelText("Variable name")[3], { target: { value: "cart" } });
    fireEvent.change(screen.getAllByLabelText("Variable type")[3], { target: { value: "array" } });
    fireEvent.change(screen.getAllByLabelText("Initial value")[3], { target: { value: "[]" } });
    expect(vars()[3]).toMatchObject({ name: "cart", type: "array", init: "[]" });

    fireEvent.click(screen.getAllByLabelText("Remove")[3]);
    expect(vars()).toHaveLength(3);
  });

  it("opens the dependency graph and shows an empty state", () => {
    const model = starter();
    (model.nodes.find((n) => n.type === "state") as StateNode).cfg.vars = [];
    const view = renderSelectedNode("App state", model);
    expect(screen.getByText("No variables yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("Open dependency graph"));
    expect(view.stubs.openDetail).toHaveBeenCalled();
  });
});
