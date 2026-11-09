import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createNode, starter, type ArchModel, type ComponentNode, type FunctionNode } from "@/pages/ArchTest/engine";
import { USER_SERVICE, changeField, idOf, renderSelectedNode, serviceIn, type PanelRender } from "@/pages/ArchTest/testing/panelHarness";

const profileOf = (view: PanelRender) => view.nodeNamed("UserProfile") as ComponentNode;
const fetchUserOf = (view: PanelRender) => view.nodeNamed("fetchUser") as FunctionNode;
const fetchUserIn = (model: ArchModel) => model.nodes.find((n) => n.name === "fetchUser") as FunctionNode;
const profileIn = (model: ArchModel) => model.nodes.find((n) => n.name === "UserProfile") as ComponentNode;

describe("ComponentPanel", () => {
  it("commits edits to the description and JSON contract", () => {
    const view = renderSelectedNode("UserProfile");
    changeField("Short description of the data it expects", "New description");
    changeField("Expected input, JSON", '{"a":1}');
    changeField("Output sent when the user interacts, JSON", '{"b":2}');
    expect(profileOf(view).cfg).toMatchObject({ desc: "New description", input: '{"a":1}', output: '{"b":2}' });
  });

  it("renames the node, assigns a group and shows header actions", () => {
    const model = starter();
    model.groups.push({ id: "g1", name: "Group 1" });
    fetchUserIn(model).group = "g1";
    const view = renderSelectedNode("UserProfile", model);
    changeField("Name", "Profile");
    changeField("Group", "g1");
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
    const orphan = createNode("function", 0, 0, { name: "orphan" });
    model.nodes.push(orphan);
    const view = renderSelectedNode("UserProfile", model);
    const componentId = idOf(model, "UserProfile");

    changeField("New function trigger", "Polling");
    fireEvent.click(screen.getByText("Add function"));
    expect(view.stubs.addFunctionTo).toHaveBeenCalledWith(componentId, "Polling");

    fireEvent.click(screen.getByText("Attach existing"));
    expect(view.stubs.connect).toHaveBeenCalledWith(componentId, orphan.id, false);

    fireEvent.click(screen.getByText("fetchUser"));
    expect(view.stubs.reveal).toHaveBeenCalledWith(idOf(model, "fetchUser"));

    changeField("Existing function", orphan.id);
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

  it("toggles app and local state reads and edits modified state rows", () => {
    const view = renderSelectedNode("UserProfile");
    fireEvent.click(screen.getByLabelText("currentUser"));
    fireEvent.click(screen.getByLabelText("isLoading (local)"));
    expect([...profileOf(view).cfg.reads].sort()).toEqual(["v_loading", "v_orders"]);

    fireEvent.click(screen.getByText("Add modified state"));
    expect(profileOf(view).cfg.writes).toEqual([{ varId: "v_user", from: "" }]);
    changeField("Value path", "user");
    changeField("Modified state variable", "v_loading");
    expect(profileOf(view).cfg.writes).toEqual([{ varId: "v_loading", from: "user" }]);
    fireEvent.click(screen.getByLabelText("Remove"));
    expect(profileOf(view).cfg.writes).toEqual([]);
  });

  it("adds, edits and removes local state variables", () => {
    const view = renderSelectedNode("UserProfile");
    fireEvent.click(screen.getByText("Add variable"));
    const localState = () => profileOf(view).cfg.state;
    expect(localState().map((v) => v.name)).toEqual(["isLoading", "variable2"]);

    fireEvent.change(screen.getAllByLabelText("Variable name")[1], { target: { value: "draft" } });
    fireEvent.change(screen.getAllByLabelText("Variable type")[1], { target: { value: "object" } });
    fireEvent.change(screen.getAllByLabelText("Initial value")[1], { target: { value: "{}" } });
    expect(localState()[1]).toMatchObject({ name: "draft", type: "object", init: "{}" });

    fireEvent.click(screen.getByLabelText("Remove isLoading"));
    expect(localState().map((v) => v.name)).toEqual(["draft"]);
  });

  it("explains where state comes from when there are no variables", () => {
    const model = starter();
    model.store = [];
    profileIn(model).cfg.state = [];
    renderSelectedNode("UserProfile", model);
    expect(screen.getByText("No local state. Values only this component uses go here.")).toBeTruthy();
    expect(
      screen.getByText("Add variables to the App state panel, or local state to the component, to link them here."),
    ).toBeTruthy();
  });

  it("lists the endpoints its functions call and reveals the owning service on click", () => {
    const view = renderSelectedNode("UserProfile");
    expect(screen.getByText(USER_SERVICE)).toBeTruthy();
    fireEvent.click(screen.getByText("GET /users/:id"));
    expect(view.stubs.reveal).toHaveBeenCalledWith(idOf(view.model(), USER_SERVICE));
  });

  it("notes when no function calls an endpoint yet", () => {
    const model = starter();
    fetchUserIn(model).cfg.endpoint = "";
    renderSelectedNode("UserProfile", model);
    expect(screen.getByText("None of this component's functions call an endpoint yet.")).toBeTruthy();
  });
});

describe("FunctionPanel", () => {
  it("shows trigger specific fields", () => {
    const view = renderSelectedNode("fetchUser");
    expect(screen.queryByLabelText("Interval (ms)")).toBeNull();

    changeField("Runs on", "Polling");
    changeField("Interval (ms)", "250");
    expect(fetchUserOf(view).cfg.interval).toBe(250);

    changeField("Runs on", "On Component Change");
    changeField("Watches (comma separated state or props)", "a, b");
    expect(fetchUserOf(view).cfg.deps).toBe("a, b");

    changeField("Runs on", "WebSocket");
    changeField("Socket URL", "wss://x");
    expect(fetchUserOf(view).cfg.url).toBe("wss://x");
  });

  it("edits the data contract and modified state, and links neighbours", () => {
    const view = renderSelectedNode("fetchUser");
    changeField("Expects from the component, JSON", '{"userId":2}');
    changeField("Sends onward, JSON (blank = pass the input through)", '{"userId":3}');
    expect(fetchUserOf(view).cfg).toMatchObject({ input: '{"userId":2}', output: '{"userId":3}' });
    fireEvent.click(screen.getByText("UserProfile"));
    expect(view.stubs.reveal).toHaveBeenCalledWith(idOf(view.model(), "UserProfile"));
    expect(screen.getAllByLabelText("Value path")).toHaveLength(2);
  });

  it("reads the owning component's local state", () => {
    renderSelectedNode("fetchUser");
    expect(screen.getByLabelText("isLoading (local)")).toBeTruthy();
  });

  it("chooses an endpoint without duplicating an existing service connection", () => {
    const view = renderSelectedNode("fetchUser");
    const edgesBefore = view.model().edges.length;
    changeField("Endpoint", "ep_create_user");
    expect(fetchUserOf(view).cfg.endpoint).toBe("ep_create_user");
    expect(view.model().edges).toHaveLength(edgesBefore);
    changeField("Endpoint", "");
    expect(fetchUserOf(view).cfg.endpoint).toBe("");
  });

  it("draws the connection to the endpoint's service when none exists", () => {
    const model = starter();
    const serviceId = serviceIn(model).id;
    const functionId = idOf(model, "fetchUser");
    model.edges = model.edges.filter((e) => !(e.from === functionId && e.to === serviceId));
    const view = renderSelectedNode("fetchUser", model);
    changeField("Endpoint", "ep_list_users");
    expect(view.model().edges.some((e) => e.from === functionId && e.to === serviceId)).toBe(true);
  });
});
