import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  mkNode,
  newCollection,
  starter,
  type ConnectorNode,
  type NosqlNode,
  type SqlNode,
} from "../../engine";
import { renderSelectedNode, type PanelRender } from "./testHarness";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const connector = (view: PanelRender) => view.nodeNamed("userWithOrders") as ConnectorNode;

describe("ConnectorPanel tables and joins", () => {
  it("unticking a table prunes joins and projections, re-ticking auto-joins", () => {
    const view = renderSelectedNode("userWithOrders");
    fireEvent.click(screen.getByLabelText("orders"));
    expect(connector(view).cfg.q.tables).toEqual(["users"]);
    expect(connector(view).cfg.q.joins).toEqual([]);
    expect(connector(view).cfg.q.select.every((s) => s.field.startsWith("users."))).toBe(true);
    expect(screen.queryByText("Joins")).toBeNull();

    fireEvent.click(screen.getByLabelText("orders"));
    expect(connector(view).cfg.q.tables).toEqual(["users", "orders"]);
    expect(connector(view).cfg.q.joins).toEqual([
      { type: "LEFT", table: "orders", left: "users.id", right: "orders.user_id" },
    ]);
  });

  it("removes, auto-joins, adds and edits joins", () => {
    const view = renderSelectedNode("userWithOrders");
    fireEvent.click(screen.getAllByLabelText("Remove")[0]);
    expect(connector(view).cfg.q.joins).toEqual([]);
    expect(screen.getByText("No joins yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("Auto-join from foreign keys"));
    expect(connector(view).cfg.q.joins).toHaveLength(1);
    fireEvent.click(screen.getByText("Add join"));
    expect(connector(view).cfg.q.joins).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("Join type")[1], { target: { value: "INNER" } });
    fireEvent.change(screen.getAllByLabelText("Join table")[1], { target: { value: "orders" } });
    fireEvent.change(screen.getAllByLabelText("Join left field")[1], { target: { value: "users.id" } });
    fireEvent.change(screen.getAllByLabelText("Join right field")[1], { target: { value: "orders.user_id" } });
    expect(connector(view).cfg.q.joins[1]).toEqual({ type: "INNER", table: "orders", left: "users.id", right: "orders.user_id" });
  });
});

describe("ConnectorPanel filters, projection and aggregation", () => {
  it("adds and edits filters", () => {
    const view = renderSelectedNode("userWithOrders");
    fireEvent.click(screen.getAllByText("Add")[0]);
    expect(connector(view).cfg.q.where[1]).toEqual({ field: "users.id", op: "=", value: "" });
    fireEvent.change(screen.getAllByLabelText("Filter field")[1], { target: { value: "orders.total" } });
    fireEvent.change(screen.getAllByLabelText("Filter operator")[1], { target: { value: ">" } });
    fireEvent.change(screen.getAllByLabelText("Filter value")[1], { target: { value: "10" } });
    expect(connector(view).cfg.q.where[1]).toEqual({ field: "orders.total", op: ">", value: "10" });
    fireEvent.click(screen.getAllByLabelText("Remove")[screen.getAllByLabelText("Remove").length - 1]);
    expect(connector(view).cfg.q.where).toHaveLength(2 - 1);
  });

  it("toggles projections and renames them", () => {
    const view = renderSelectedNode("userWithOrders");
    fireEvent.click(screen.getByLabelText("users.created_at"));
    expect(connector(view).cfg.q.select.at(-1)).toEqual({ field: "users.created_at", as: "" });
    change("Rename users.created_at", "created");
    expect(connector(view).cfg.q.select.at(-1)?.as).toBe("created");
    fireEvent.click(screen.getByLabelText("users.created_at"));
    expect(connector(view).cfg.q.select.some((s) => s.field === "users.created_at")).toBe(false);
  });

  it("builds aggregations and group-bys", () => {
    const view = renderSelectedNode("userWithOrders");
    fireEvent.click(screen.getByText("Aggregate"));
    fireEvent.change(screen.getByLabelText("Aggregate function"), { target: { value: "sum" } });
    fireEvent.change(screen.getByLabelText("Aggregate field"), { target: { value: "orders.total" } });
    fireEvent.change(screen.getByLabelText("Aggregate alias"), { target: { value: "revenue" } });
    expect(connector(view).cfg.q.aggs).toEqual([{ fn: "sum", field: "orders.total", as: "revenue" }]);

    fireEvent.click(screen.getByText("Group by"));
    expect(connector(view).cfg.q.group).toEqual(["users.id"]);
    fireEvent.change(screen.getByLabelText("Group by field"), { target: { value: "users.name" } });
    expect(connector(view).cfg.q.group).toEqual(["users.name"]);
    fireEvent.click(screen.getByLabelText("Remove group by"));
    expect(connector(view).cfg.q.group).toEqual([]);
  });

  it("edits result options and shows the preview", () => {
    const view = renderSelectedNode("userWithOrders");
    fireEvent.click(screen.getByLabelText("Nest joined tables under the base rows"));
    change("Limit", "2");
    change("Sample request parameters", '{"id":2}');
    expect(connector(view).cfg.q).toMatchObject({ nest: false, limit: 2 });
    expect(connector(view).cfg.sample).toBe('{"id":2}');
    expect(screen.getByText(/SELECT/)).toBeTruthy();
    expect(screen.getByText(/Sample result \(/)).toBeTruthy();
  });

  it("shows the runner error when the database has no tables", () => {
    const model = starter();
    (model.nodes.find((n) => n.type === "sqldb") as SqlNode).cfg.tables = [];
    renderSelectedNode("userWithOrders", model);
    expect(screen.getByText("The database has no tables yet.")).toBeTruthy();
    expect(screen.getByText("No table selected")).toBeTruthy();
  });
});

describe("ConnectorPanel database choice", () => {
  const withNosql = () => {
    const model = starter();
    const mongo = mkNode("nosql", 0, 0, { name: "mongo" }) as NosqlNode;
    mongo.cfg.collections.push(newCollection("events"));
    model.nodes.push(mongo);
    return { model, mongo };
  };

  it("switching database resets the query and wires a connection", () => {
    const { model, mongo } = withNosql();
    const view = renderSelectedNode("userWithOrders", model);
    change("Connected to", mongo.id);
    expect(connector(view).cfg.dbId).toBe(mongo.id);
    expect(connector(view).cfg.q).toMatchObject({ tables: ["documents"], joins: [], where: [], select: [], nest: false });
    expect(view.model().edges.some((e) => e.from === connector(view).id && e.to === mongo.id)).toBe(true);
    expect(screen.getByText("Collection")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("events"));
    expect(connector(view).cfg.q.tables).toEqual(["events"]);
    expect(screen.queryByText("Joins")).toBeNull();
  });

  it("prompts for a database when none is connected", () => {
    const model = starter();
    model.edges = model.edges.filter((e) => model.nodes.find((n) => n.id === e.to)?.type !== "sqldb");
    (model.nodes.find((n) => n.name === "userWithOrders") as ConnectorNode).cfg.dbId = "";
    const view = renderSelectedNode("userWithOrders", model);
    expect(screen.getByText("Pick a database, or draw a connection from this connector to one.")).toBeTruthy();
    const sqlId = model.nodes.find((n) => n.type === "sqldb")!.id;
    change("Connected to", sqlId);
    expect(connector(view).cfg.dbId).toBe(sqlId);
  });
});
