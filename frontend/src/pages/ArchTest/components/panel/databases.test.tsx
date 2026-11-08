import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mkNode, starter, type NosqlNode, type SqlNode } from "../../engine";
import { renderSelectedNode, type PanelRender } from "./testHarness";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const sql = (view: PanelRender) => view.nodeNamed("app_db") as SqlNode;
const mongo = (view: PanelRender) => view.nodeNamed("mongo") as NosqlNode;

const withMongo = () => {
  const model = starter();
  model.nodes.push(mkNode("nosql", 0, 0, { name: "mongo" }));
  return model;
};

const detailsStartingWith = (summaryText: string) => {
  const summary = Array.from(document.querySelectorAll("summary")).find((s) => s.textContent?.startsWith(summaryText));
  if (!summary) throw new Error(`No <details> summary starting with ${summaryText}`);
  return summary.closest("details") as HTMLDetailsElement;
};

const toggleDetails = (summaryText: string, open: boolean) => {
  const details = detailsStartingWith(summaryText);
  details.open = open;
  fireEvent(details, new Event("toggle"));
  return details;
};

describe("SqlPanel", () => {
  it("edits engine, table name and shows connections and relationships", () => {
    const view = renderSelectedNode("app_db");
    change("Engine", "MySQL");
    fireEvent.change(screen.getAllByLabelText("Table name")[0], { target: { value: "people" } });
    expect(sql(view).cfg.engine).toBe("MySQL");
    expect(sql(view).cfg.tables[0].name).toBe("people");
    expect(screen.getByText("orders.user_id → users.id")).toBeTruthy();
    fireEvent.click(screen.getByText("userWithOrders"));
    expect(view.stubs.reveal).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Schema diagram"));
    expect(view.stubs.openDetail).toHaveBeenCalled();
  });

  it("remembers expanded tables", () => {
    renderSelectedNode("app_db");
    expect(toggleDetails("users", true).open).toBe(true);
    expect(toggleDetails("users", true).open).toBe(true);
    expect(toggleDetails("users", false).open).toBe(false);
  });

  it("edits columns", () => {
    const view = renderSelectedNode("app_db");
    fireEvent.click(screen.getAllByText("Add column")[0]);
    const columns = () => sql(view).cfg.tables[0].columns;
    const last = columns().length - 1;
    fireEvent.change(screen.getAllByLabelText("Column name")[last], { target: { value: "age" } });
    fireEvent.change(screen.getAllByLabelText("Column type")[last], { target: { value: "bigint" } });
    fireEvent.click(screen.getAllByLabelText("PK")[last]);
    fireEvent.change(screen.getAllByLabelText("Foreign key")[last], { target: { value: "orders.id" } });
    expect(columns()[last]).toEqual({ name: "age", type: "bigint", pk: true, fk: "orders.id" });
    fireEvent.click(screen.getAllByLabelText("Remove")[last]);
    expect(columns()).toHaveLength(last);
  });

  it("edits indexes and sample rows, generates rows and deletes a table", () => {
    const view = renderSelectedNode("app_db");
    fireEvent.click(screen.getAllByText("Add index")[0]);
    const indexes = () => sql(view).cfg.tables[0].indexes;
    expect(indexes().at(-1)).toEqual({ name: "idx_users_col", columns: "", unique: false });
    const last = indexes().length - 1;
    fireEvent.change(screen.getAllByLabelText("Index name")[last], { target: { value: "ix" } });
    fireEvent.change(screen.getAllByLabelText("Index columns")[last], { target: { value: "name" } });
    fireEvent.click(screen.getAllByLabelText("unique")[last]);
    expect(indexes()[last]).toEqual({ name: "ix", columns: "name", unique: true });

    fireEvent.change(screen.getAllByLabelText("Sample rows")[0], { target: { value: "[]" } });
    expect(sql(view).cfg.tables[0].data).toBe("[]");
    fireEvent.click(screen.getAllByText("Generate sample rows")[0]);
    expect(JSON.parse(sql(view).cfg.tables[0].data)).toHaveLength(3);

    fireEvent.click(screen.getAllByText("Delete table")[0]);
    expect(sql(view).cfg.tables.map((t) => t.name)).toEqual(["orders"]);
  });

  it("adds a table that starts expanded", () => {
    const view = renderSelectedNode("app_db");
    fireEvent.click(screen.getByText("Add table"));
    expect(sql(view).cfg.tables.map((t) => t.name)).toEqual(["users", "orders", "table_3"]);
    expect(detailsStartingWith("table_3").open).toBe(true);
  });

  it("adds, edits and deletes stored procedures", () => {
    const view = renderSelectedNode("app_db");
    fireEvent.click(screen.getByText("Add procedure"));
    const procedures = () => sql(view).cfg.sps;
    expect(procedures()[1].name).toBe("procedure_2");
    const last = screen.getAllByLabelText("Name").length - 1;
    fireEvent.change(screen.getAllByLabelText("Name")[last], { target: { value: "p2" } });
    fireEvent.change(screen.getAllByLabelText("Parameters")[1], { target: { value: "id int" } });
    fireEvent.change(screen.getAllByLabelText("Body")[1], { target: { value: "SELECT 2;" } });
    fireEvent.change(screen.getAllByLabelText("Sample result, JSON")[1], { target: { value: "[1]" } });
    expect(procedures()[1]).toEqual({ name: "p2", params: "id int", body: "SELECT 2;", sample: "[1]" });
    fireEvent.click(screen.getAllByText("Delete procedure")[1]);
    expect(procedures()).toHaveLength(1);
    toggleDetails("get_user_with_orders", true);
  });

  it("shows empty states", () => {
    const model = starter();
    const db = model.nodes.find((n) => n.type === "sqldb") as SqlNode;
    db.cfg.tables = [];
    db.cfg.sps = [];
    renderSelectedNode("app_db", model);
    expect(screen.getByText("No tables yet.")).toBeTruthy();
    expect(screen.getByText("None.")).toBeTruthy();
    expect(screen.getByText("Choose a foreign key on a column to define a relationship.")).toBeTruthy();
  });
});

describe("NosqlPanel", () => {
  it("edits engine, collection name and fields", () => {
    const view = renderSelectedNode("mongo", withMongo());
    change("Engine", "DynamoDB");
    change("Collection name", "docs");
    fireEvent.click(screen.getByText("Add field"));
    const fields = () => mongo(view).cfg.collections[0].fields;
    const last = fields().length - 1;
    fireEvent.change(screen.getAllByLabelText("Field name")[last], { target: { value: "tags" } });
    fireEvent.change(screen.getAllByLabelText("Field type")[last], { target: { value: "array" } });
    expect(mongo(view).cfg).toMatchObject({ engine: "DynamoDB" });
    expect(mongo(view).cfg.collections[0].name).toBe("docs");
    expect(fields()[last]).toEqual({ name: "tags", type: "array" });
    fireEvent.click(screen.getAllByLabelText("Remove")[last]);
    expect(fields()).toHaveLength(last);
  });

  it("infers fields from the first document and ignores unusable data", () => {
    const view = renderSelectedNode("mongo", withMongo());
    const doc = { _id: "1", n: 1, ok: true, at: "2024-01-01T00:00:00Z", tags: [], meta: {}, s: "x" };
    change("Documents", JSON.stringify([doc]));
    fireEvent.click(screen.getByText("Infer from first document"));
    expect(mongo(view).cfg.collections[0].fields.map((f) => f.type)).toEqual([
      "objectId",
      "number",
      "boolean",
      "date",
      "array",
      "object",
      "string",
    ]);
    change("Documents", "not json");
    fireEvent.click(screen.getByText("Infer from first document"));
    expect(mongo(view).cfg.collections[0].fields).toHaveLength(7);
  });

  it("edits indexes, adds and deletes collections, opens the structure view", () => {
    const view = renderSelectedNode("mongo", withMongo());
    fireEvent.click(screen.getByText("Add index"));
    const index = mongo(view).cfg.collections[0].indexes.length - 1;
    expect(mongo(view).cfg.collections[0].indexes[index].name).toBe("field_1");

    fireEvent.click(screen.getByText("Add collection"));
    expect(mongo(view).cfg.collections.map((c) => c.name)).toEqual(["documents", "collection_2"]);
    fireEvent.click(screen.getByText("Structure view"));
    expect(view.stubs.openDetail).toHaveBeenCalled();
    toggleDetails("collection_2", true);
    fireEvent.click(screen.getAllByText("Delete collection")[1]);
    expect(mongo(view).cfg.collections).toHaveLength(1);
  });

  it("shows an empty state", () => {
    const model = withMongo();
    (model.nodes.find((n) => n.name === "mongo") as NosqlNode).cfg.collections = [];
    renderSelectedNode("mongo", model);
    expect(screen.getByText("No collections yet.")).toBeTruthy();
  });
});
