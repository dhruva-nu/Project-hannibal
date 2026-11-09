import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mkNode, starter, type NosqlNode, type SqlNode } from "../../engine";
import { renderSelectedNode } from "../panel/testHarness";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const sqlOf = (view: ReturnType<typeof renderSelectedNode>) => view.nodeNamed("app_db") as SqlNode;

describe("DbPopup for SQL", () => {
  it("opens as a dialog instead of the sidebar", () => {
    renderSelectedNode("app_db");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByLabelText("Inspector")).toBeNull();
  });

  it("adds a table and a stored procedure on separate tabs", () => {
    const view = renderSelectedNode("app_db");
    const tables = sqlOf(view).cfg.tables.length;
    fireEvent.click(screen.getByText("Add table"));
    expect(sqlOf(view).cfg.tables).toHaveLength(tables + 1);
    fireEvent.click(screen.getByRole("tab", { name: "Stored procedures" }));
    fireEvent.click(screen.getByText("Add procedure"));
    expect(sqlOf(view).cfg.sps.length).toBeGreaterThan(0);
  });

  it("renames, changes engine and closes by deselecting", () => {
    const view = renderSelectedNode("app_db");
    change("Database name", "main_db");
    change("Engine", "MySQL");
    expect(view.model().nodes.find((n) => n.type === "sqldb")).toMatchObject({ name: "main_db", cfg: { engine: "MySQL" } });
    fireEvent.click(screen.getByText("Close"));
    expect(view.selection().type).toBeNull();
  });
});

describe("DbPopup for NoSQL", () => {
  it("adds a collection", () => {
    const model = starter();
    const doc = mkNode("nosql", 0, 0);
    doc.name = "docs";
    model.nodes.push(doc);
    const view = renderSelectedNode("docs", model);
    expect(screen.getByLabelText("Engine")).toBeTruthy();
    fireEvent.click(screen.getByText("Add collection"));
    expect((view.nodeNamed("docs") as NosqlNode).cfg.collections).toHaveLength(2);
  });
});
