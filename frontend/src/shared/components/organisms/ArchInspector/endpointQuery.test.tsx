import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { clone, createNode, newCollection, starter, type ArchModel, type Endpoint, type NosqlNode, type SqlNode } from "@/pages/ArchTest/engine";
import {
  USER_SERVICE,
  changeField,
  endpointOf,
  recordingEditor,
  renderSelectedNode,
  renderWithArch,
  serviceIn,
  type PanelRender,
} from "@/pages/ArchTest/testing/panelHarness";
import { EndpointQueryPanel } from "./EndpointQueryPanel";

const GET_USER = "ep_get_user";
const query = (view: PanelRender) => endpointOf(view, GET_USER).q;

const openQueryBuilder = (model: ArchModel = starter()) => {
  const view = renderSelectedNode(USER_SERVICE, model);
  fireEvent.click(screen.getByRole("tab", { name: "Service layer" }));
  return view;
};

const toggleSource = (pickerLabel: string, option: string) => {
  if (!screen.queryByRole("listbox")) fireEvent.click(screen.getByLabelText(pickerLabel));
  fireEvent.click(screen.getByLabelText(option));
};

describe("Endpoint query tables and joins", () => {
  it("unticking a table prunes joins and projections, re-ticking auto-joins", () => {
    const view = openQueryBuilder();
    toggleSource("Tables", "orders");
    expect(query(view).tables).toEqual(["users"]);
    expect(query(view).joins).toEqual([]);
    expect(query(view).select.every((s) => s.field.startsWith("users."))).toBe(true);
    expect(screen.queryByText("Joins")).toBeNull();

    toggleSource("Tables", "orders");
    expect(query(view).tables).toEqual(["users", "orders"]);
    expect(query(view).joins).toEqual([{ type: "LEFT", table: "orders", left: "users.id", right: "orders.user_id" }]);
  });

  it("removes, auto-joins, adds and edits joins", () => {
    const view = openQueryBuilder();
    fireEvent.click(screen.getAllByLabelText("Remove")[0]);
    expect(query(view).joins).toEqual([]);
    expect(screen.getByText("No joins yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("Auto-join from foreign keys"));
    expect(query(view).joins).toHaveLength(1);
    fireEvent.click(screen.getByText("Add join"));
    expect(query(view).joins).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("Join type")[1], { target: { value: "INNER" } });
    fireEvent.change(screen.getAllByLabelText("Join table")[1], { target: { value: "orders" } });
    fireEvent.change(screen.getAllByLabelText("Join left field")[1], { target: { value: "users.id" } });
    fireEvent.change(screen.getAllByLabelText("Join right field")[1], { target: { value: "orders.user_id" } });
    expect(query(view).joins[1]).toEqual({ type: "INNER", table: "orders", left: "users.id", right: "orders.user_id" });
  });
});

describe("Endpoint query filters, projection and aggregation", () => {
  it("adds, edits and removes filters", () => {
    const view = openQueryBuilder();
    fireEvent.click(screen.getAllByText("Add")[0]);
    expect(query(view).where[1]).toEqual({ field: "users.id", op: "=", value: "" });
    fireEvent.change(screen.getAllByLabelText("Filter field")[1], { target: { value: "orders.total" } });
    fireEvent.change(screen.getAllByLabelText("Filter operator")[1], { target: { value: ">" } });
    fireEvent.change(screen.getAllByLabelText("Filter value")[1], { target: { value: "10" } });
    expect(query(view).where[1]).toEqual({ field: "orders.total", op: ">", value: "10" });
    fireEvent.click(screen.getAllByLabelText("Remove").at(-1)!);
    expect(query(view).where).toHaveLength(1);
  });

  it("toggles projections and renames them", () => {
    const view = openQueryBuilder();
    fireEvent.click(screen.getByLabelText("users.created_at"));
    expect(query(view).select.at(-1)).toEqual({ field: "users.created_at", as: "" });
    changeField("Rename users.created_at", "created");
    expect(query(view).select.at(-1)?.as).toBe("created");
    fireEvent.click(screen.getByLabelText("users.created_at"));
    expect(query(view).select.some((s) => s.field === "users.created_at")).toBe(false);
  });

  it("builds aggregations and group-bys", () => {
    const view = openQueryBuilder();
    fireEvent.click(screen.getByText("Aggregate"));
    changeField("Aggregate function", "sum");
    changeField("Aggregate field", "orders.total");
    changeField("Aggregate alias", "revenue");
    expect(query(view).aggs).toEqual([{ fn: "sum", field: "orders.total", as: "revenue" }]);

    fireEvent.click(screen.getByText("Group by"));
    expect(query(view).group).toEqual(["users.id"]);
    changeField("Group by field", "users.name");
    expect(query(view).group).toEqual(["users.name"]);
    fireEvent.click(screen.getByLabelText("Remove group by"));
    expect(query(view).group).toEqual([]);
  });

  it("edits result options and shows the preview", () => {
    const view = openQueryBuilder();
    fireEvent.click(screen.getByLabelText("Nest joined tables under the base rows"));
    changeField("Limit", "2");
    changeField("Sample request parameters", '{"id":2}');
    expect(query(view)).toMatchObject({ nest: false, limit: 2 });
    expect(endpointOf(view, GET_USER).sample).toBe('{"id":2}');
    expect(screen.getByText(/SELECT/)).toBeTruthy();
    expect(screen.getByText("Sample result (single object)")).toBeTruthy();
  });

  it("previews a single endpoint that finds nothing as null", () => {
    openQueryBuilder();
    changeField("Sample request parameters", '{"id":999}');
    expect(screen.getByText("Sample result (single object)").nextElementSibling?.textContent).toBe("null");
  });

  it("previews list endpoints as rows", () => {
    renderSelectedNode(USER_SERVICE);
    fireEvent.click(screen.getByRole("tab", { name: "Service layer" }));
    fireEvent.click(screen.getAllByText("/users")[0]);
    expect(screen.getByText(/Sample result \(3 rows\)/)).toBeTruthy();
  });

  it("shows the runner error when the database has no tables", () => {
    const model = starter();
    (model.nodes.find((n) => n.type === "sqldb") as SqlNode).cfg.tables = [];
    openQueryBuilder(model);
    expect(screen.getByText("The database has no tables yet.")).toBeTruthy();
    expect(screen.getByText("No table selected")).toBeTruthy();
  });
});

describe("Endpoint query database choice", () => {
  const withMongo = () => {
    const model = starter();
    const mongo = createNode("nosql", 0, 0, { name: "mongo" }) as NosqlNode;
    mongo.cfg.collections.push(newCollection("events"));
    model.nodes.push(mongo);
    return { model, mongo };
  };

  it("switching database resets the query and wires a connection from the service", () => {
    const { model, mongo } = withMongo();
    const view = openQueryBuilder(model);
    changeField("Queries database", mongo.id);
    expect(endpointOf(view, GET_USER).dbId).toBe(mongo.id);
    expect(query(view)).toMatchObject({ tables: ["documents"], joins: [], where: [], select: [], nest: false });
    const serviceId = serviceIn(view.model()).id;
    expect(view.model().edges.some((e) => e.from === serviceId && e.to === mongo.id)).toBe(true);
    toggleSource("Collection", "events");
    expect(query(view).tables).toEqual(["events"]);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("Joins")).toBeNull();
  });

  it("fails loudly when the endpoint's service is gone by the time the database switch applies", () => {
    const model = starter();
    const endpoint = serviceIn(model).cfg.endpoints[0];
    const { editor, lastMutation } = recordingEditor();
    renderWithArch(<EndpointQueryPanel endpoint={endpoint} editor={editor} serviceId="gone" />, { model });
    changeField("Queries database", "");
    const draftWithoutServices = { ...clone(model), nodes: [] };
    expect(() => lastMutation<Endpoint>()(clone(endpoint), draftWithoutServices)).toThrow('Service "gone" no longer exists');
  });

  it("prompts for a database when none is chosen and adds no duplicate edge once wired", () => {
    const model = starter();
    serviceIn(model).cfg.endpoints[0].dbId = "";
    const view = openQueryBuilder(model);
    expect(screen.getByText("Pick a database to build this endpoint's query.")).toBeTruthy();
    const sqlId = model.nodes.find((n) => n.type === "sqldb")!.id;
    const edgesBefore = view.model().edges.length;
    changeField("Queries database", sqlId);
    expect(endpointOf(view, GET_USER).dbId).toBe(sqlId);
    expect(view.model().edges).toHaveLength(edgesBefore);
  });
});
