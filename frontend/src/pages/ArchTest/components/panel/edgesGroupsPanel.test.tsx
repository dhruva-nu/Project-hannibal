import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { mkNode, starter, type ArchModel, type DerivedEdge, type FunctionNode } from "../../engine";
import { InspectorPanel } from "./Panel";
import { useEditor } from "./panelEditor";
import { idOf, renderSelectedNode, renderWithArch } from "./testHarness";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const edgeBetween = (model: ArchModel, from: string, to: string) =>
  model.edges.find((e) => e.from === idOf(model, from) && e.to === idOf(model, to))!;

const renderEdge = (model: ArchModel, from: string, to: string) => {
  const edge = edgeBetween(model, from, to);
  return { edge, view: renderWithArch(<InspectorPanel />, { model, selection: { type: "edge", ids: [edge.id] } }) };
};

describe("EdgePanel", () => {
  it("shows header actions, label and the insert-infrastructure control", () => {
    const { edge, view } = renderEdge(starter(), "UserProfile", "fetchUser");
    expect(screen.getByText("UserProfile → fetchUser")).toBeTruthy();
    fireEvent.click(screen.getByText("Flip direction"));
    fireEvent.click(screen.getByText("Delete"));
    expect(view.stubs.flipEdge).toHaveBeenCalledWith(edge.id);
    expect(view.stubs.askDeleteEdge).toHaveBeenCalledWith(edge.id);

    change("Label", "loads");
    expect(view.model().edges.find((e) => e.id === edge.id)?.label).toBe("loads");

    fireEvent.click(screen.getByText("Insert"));
    expect(view.stubs.insertOnEdge).toHaveBeenLastCalledWith(edge.id, "redis");
    change("Infrastructure type", "lb");
    fireEvent.click(screen.getByText("Insert"));
    expect(view.stubs.insertOnEdge).toHaveBeenLastCalledWith(edge.id, "lb");
  });

  it("edits field mappings", () => {
    const { edge, view } = renderEdge(starter(), "fetchUser", "Get user");
    const maps = () => view.model().edges.find((e) => e.id === edge.id)!.map;
    expect(maps()).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("From field")[0], { target: { value: "uid" } });
    fireEvent.change(screen.getAllByLabelText("To field")[0], { target: { value: "id" } });
    fireEvent.change(screen.getAllByLabelText("Constant value")[0], { target: { value: "9" } });
    expect(maps()[0]).toEqual({ from: "uid", to: "id", value: "9" });
    fireEvent.click(screen.getByText("Add mapping"));
    expect(maps()).toHaveLength(3);
    fireEvent.click(screen.getAllByLabelText("Remove")[2]);
    expect(maps()).toHaveLength(2);
  });

  it("reports a payload that matches what the target expects", () => {
    const { view } = renderEdge(starter(), "UserProfile", "fetchUser");
    expect(screen.getByText("The payload matches what fetchUser expects.")).toBeTruthy();
    expect(screen.getByText("Request")).toBeTruthy();
    fireEvent.click(screen.getByText("Compare fields"));
    expect(view.stubs.openFlow).toHaveBeenCalled();
  });

  it("lists schema mismatches and the recorded response", () => {
    const model = starter();
    (model.nodes.find((n) => n.name === "fetchUser") as FunctionNode).cfg.input = '{"userId":1,"extra":"x"}';
    renderEdge(model, "UserProfile", "fetchUser");
    expect(screen.getByText("Schema mismatch")).toBeTruthy();
    expect(screen.getByText("extra is expected (string) but not provided")).toBeTruthy();
    expect(screen.getByText("Response")).toBeTruthy();
  });
});

const derivedBetween = (model: ArchModel): DerivedEdge => ({
  id: "ov|client|backend",
  from: idOf(model, "UserProfile"),
  to: idOf(model, "Get user"),
  label: "",
  map: [],
  derived: true,
  ids: [edgeBetween(model, "fetchUser", "Get user").id, "missing-edge"],
});

describe("OverviewEdgePanel", () => {
  it("lists the connections inside and offers delete, payload and insert", () => {
    const model = starter();
    const derived = derivedBetween(model);
    const view = renderWithArch(<InspectorPanel />, {
      model,
      derivedEdges: [derived],
      selection: { type: "edge", ids: [derived.id] },
    });
    expect(screen.getByText("Connection between layers")).toBeTruthy();
    expect(screen.getAllByText("fetchUser → Get user").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Payload fetchUser → Get user"));
    expect(view.stubs.openFlow).toHaveBeenCalledWith(derived.ids[0]);
    fireEvent.click(screen.getByText("Delete"));
    expect(view.stubs.askDeleteEdge).toHaveBeenCalledWith(derived.id);
    fireEvent.click(screen.getByText("Insert"));
    expect(view.stubs.insertOnEdge).toHaveBeenCalledWith(derived.id, "redis");
  });
});

describe("GroupPanel", () => {
  const groupedModel = () => {
    const model = starter();
    model.groups.push({ id: "g1", name: "Group 1" });
    model.nodes.filter((n) => n.name === "UserProfile" || n.name === "fetchUser").forEach((n) => (n.group = "g1"));
    return model;
  };

  it("renames the group, ungroups and deletes", () => {
    const view = renderWithArch(<InspectorPanel />, {
      model: groupedModel(),
      selection: { type: "group", ids: ["g1"] },
    });
    expect(screen.getByText("Group of 2 components")).toBeTruthy();
    change("Name", "Profile group");
    expect(view.model().groups[0].name).toBe("Profile group");
    fireEvent.click(screen.getByText("Ungroup"));
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("fetchUser"));
    expect(view.stubs.ungroup).toHaveBeenCalledWith("g1");
    expect(view.stubs.askDeleteSelection).toHaveBeenCalled();
    expect(view.stubs.reveal).toHaveBeenCalled();
  });
});

describe("InspectorPanel selection", () => {
  it("renders nothing without a selection", () => {
    renderWithArch(<InspectorPanel />);
    expect(screen.queryByLabelText("Inspector")).toBeNull();
  });

  it("shows the multi-select header with group and delete", () => {
    const model = starter();
    const view = renderWithArch(<InspectorPanel />, {
      model,
      selection: { type: "node", ids: [idOf(model, "UserProfile"), idOf(model, "fetchUser")] },
    });
    expect(screen.getByText("2 components selected")).toBeTruthy();
    fireEvent.click(screen.getByText("Group"));
    fireEvent.click(screen.getByText("Delete"));
    expect(view.stubs.groupSelected).toHaveBeenCalled();
    expect(view.stubs.askDeleteSelection).toHaveBeenCalled();
  });

  it("closes itself through the header close button", () => {
    const view = renderSelectedNode("UserProfile");
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(view.selection().type).toBeNull();
    expect(screen.queryByLabelText("Inspector")).toBeNull();
  });

  it("renders no body for layer cards, missing nodes, edges or groups", () => {
    const model = starter();
    const cases = [
      { type: "node" as const, ids: [model.lnodes[0].id] },
      { type: "node" as const, ids: ["ghost"] },
      { type: "edge" as const, ids: ["ghost"] },
      { type: "group" as const, ids: ["ghost"] },
    ];
    cases.forEach((selection) => {
      const view = renderWithArch(<InspectorPanel />, { model, selection });
      expect(screen.queryByText("Close panel", { selector: "button" })).toBeNull();
      expect(screen.queryByLabelText("Close panel")).toBeNull();
      view.unmount();
    });
  });

  it("connects to another box from the node panel", () => {
    const view = renderSelectedNode("Get user");
    const firstTarget = (screen.getByLabelText("Connection target") as HTMLSelectElement).value;
    fireEvent.click(screen.getByText("Connect"));
    expect(view.stubs.connect).toHaveBeenCalledWith(idOf(view.model(), "Get user"), firstTarget, false);
    const other = (screen.getByLabelText("Connection target") as HTMLSelectElement).options[1].value;
    change("Connection target", other);
    fireEvent.click(screen.getByText("Connect"));
    expect(view.stubs.connect).toHaveBeenLastCalledWith(idOf(view.model(), "Get user"), other, false);
  });

  it("hides the connect section when everything is already connected", () => {
    const model = starter();
    model.nodes = model.nodes.filter((n) => n.name === "UserProfile" || n.name === "fetchUser");
    renderSelectedNode("UserProfile", model);
    expect(screen.queryByText("Connect to")).toBeNull();
  });
});

describe("useEditor failure modes", () => {
  const Probe = ({ id, path }: { id: string; path: string }) => {
    const [error, setError] = useState("");
    const editor = useEditor("node", id);
    const attempt = (action: () => void) => {
      try {
        action();
        setError("none");
      } catch (e) {
        setError((e as Error).message);
      }
    };
    return (
      <>
        <button onClick={() => attempt(() => editor.set("name", "x"))}>set</button>
        <button onClick={() => attempt(() => editor.push(path, 1))}>push</button>
        <output>{error}</output>
      </>
    );
  };

  it("throws loudly when the target no longer exists", () => {
    renderWithArch(<Probe id="ghost" path="cfg.reads" />);
    fireEvent.click(screen.getByText("set"));
    expect(screen.getByRole("status").textContent).toBe('Cannot edit missing node "ghost"');
  });

  it("throws loudly when a list path is not an array", () => {
    const model = starter();
    renderWithArch(<Probe id={idOf(model, "UserProfile")} path="cfg.desc" />, { model });
    fireEvent.click(screen.getByText("push"));
    expect(screen.getByRole("status").textContent).toBe('Expected an array at "cfg.desc"');
  });

  it("succeeds for an existing node and list", () => {
    const model = starter();
    const added = mkNode("component", 0, 0, { name: "extra" });
    model.nodes.push(added);
    renderWithArch(<Probe id={added.id} path="cfg.reads" />, { model });
    fireEvent.click(screen.getByText("push"));
    expect(screen.getByRole("status").textContent).toBe("none");
  });
});
