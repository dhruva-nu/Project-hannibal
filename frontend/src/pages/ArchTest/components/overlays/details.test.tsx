import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mkNode, newCollection, starter } from "../../engine";
import { DetailModal } from "./details/DetailModal";
import { nodeOfType, renderWithArch } from "./testHarness";

const detail = (nodeId: string) => <DetailModal nodeId={nodeId} onClose={vi.fn()} />;

describe("DetailModal", () => {
  it("renders nothing for an unknown node", () => {
    expect(renderWithArch(detail("nope")).container.innerHTML).toBe("");
  });

  it("shows the SQL schema with indexes, stored procedures and measured foreign keys", () => {
    const model = starter();
    const db = nodeOfType(model, "sqldb");
    const rect = (left: number, top: number, width = 100, height = 20) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const column = (this as HTMLElement).dataset?.column;
      if (column === "orders.user_id") return rect(300, 100);
      if (column === "users.id") return rect(10, 40);
      return rect(0, 0, 600, 300);
    });
    renderWithArch(detail(db.id), model);
    expect(screen.getByRole("dialog", { name: "app_db schema" })).toBeTruthy();
    expect(screen.getByText("users_email_key")).toBeTruthy();
    expect(screen.getByText("unique")).toBeTruthy();
    expect(screen.getByText("Stored procedures")).toBeTruthy();
    expect(document.querySelectorAll("svg path[marker-end]").length).toBe(1);
    spy.mockRestore();
  });

  it("measures foreign keys pointing left, and ignores dangling ones", () => {
    const model = starter();
    const db = nodeOfType(model, "sqldb");
    db.cfg.tables[0].columns.push({ name: "ref", type: "int", pk: false, fk: "nope.id" });
    db.cfg.sps = [];
    db.cfg.tables[1].indexes = [];
    const rect = (left: number) =>
      ({ left, top: 0, width: 50, height: 10, right: left + 50, bottom: 10, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const column = (this as HTMLElement).dataset?.column;
      if (column === "orders.user_id") return rect(500);
      if (column === "users.id") return rect(10);
      if (column === "users.ref") return rect(10);
      return { ...rect(0), width: 800 } as DOMRect;
    });
    renderWithArch(detail(db.id), model);
    expect(document.querySelectorAll("svg path[marker-end]").length).toBe(1);
    expect(screen.queryByText("Stored procedures")).toBeNull();
    spy.mockRestore();
  });

  it("draws no relationships when layout has no width", () => {
    const model = starter();
    renderWithArch(detail(nodeOfType(model, "sqldb").id), model);
    expect(document.querySelectorAll("svg path[marker-end]").length).toBe(0);
  });

  it("shows NoSQL collections, indexes and the example document", () => {
    const model = starter();
    const mongo = mkNode("nosql", 0, 0, { layer: "db" });
    if (mongo.type !== "nosql") throw new Error("type");
    mongo.cfg.collections = [newCollection("events"), { ...newCollection("empty"), indexes: [], data: "{}" }];
    model.nodes.push(mongo);
    renderWithArch(detail(mongo.id), model);
    expect(screen.getByText("events")).toBeTruthy();
    expect(screen.getByText(/name_1 \(name\)/)).toBeTruthy();
    expect(screen.getByText(/Indexes: none/)).toBeTruthy();
    expect(screen.getAllByText("Example document")).toHaveLength(2);
  });

  it("says when a NoSQL database has no collections", () => {
    const model = starter();
    const mongo = mkNode("nosql", 0, 0, { layer: "db" });
    if (mongo.type !== "nosql") throw new Error("type");
    mongo.cfg.collections = [];
    model.nodes.push(mongo);
    renderWithArch(detail(mongo.id), model);
    expect(screen.getByText("No collections.")).toBeTruthy();
  });

  it("draws the state dependency graph and flags unused variables", () => {
    const model = starter();
    const state = nodeOfType(model, "state");
    renderWithArch(detail(state.id), model);
    expect(screen.getByRole("img", { name: "State dependencies" })).toBeTruthy();
    expect(screen.getAllByText("UserProfile").length).toBeGreaterThan(0);
    expect(screen.getByText("isLoading is not read or modified by anything yet.")).toBeTruthy();
    expect(document.querySelectorAll('path[marker-end="url(#sdm)"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('path[marker-end="url(#sdm2)"]').length).toBeGreaterThan(0);
  });

  it("asks for variables when the state viewer is empty", () => {
    const model = starter();
    nodeOfType(model, "state").cfg.vars = [];
    renderWithArch(detail(nodeOfType(model, "state").id), model);
    expect(screen.getByText("Add variables first.")).toBeTruthy();
  });

  it("shows the connector query, structure and result rows", () => {
    const model = starter();
    renderWithArch(detail(nodeOfType(model, "connector").id), model);
    expect(screen.getByText(/SELECT users.id/)).toBeTruthy();
    expect(screen.getByText(/Bound: id = 1/)).toBeTruthy();
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("shows an empty connector result and tolerates a non-object sample", () => {
    const model = starter();
    const connector = nodeOfType(model, "connector");
    connector.cfg.sample = "[1]";
    connector.cfg.q.where = [];
    connector.cfg.q.tables = [];
    renderWithArch(detail(connector.id), model);
    expect(screen.getByText("No rows.")).toBeTruthy();
  });

  it("shows the curl example, responses and relationships for an API", () => {
    const model = starter();
    const { api } = renderWithArch(detail(nodeOfType(model, "api").id), model);
    expect(screen.getByText(/curl -X GET https:\/\/api.example.com\/users\/123/)).toBeTruthy();
    expect(screen.getByText("Response 404 User not found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "UserProfile" }));
    expect(api.reveal).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "userWithOrders" })).toBeTruthy();
  });

  it("shows component contract and traces from the generic detail", () => {
    const model = starter();
    const comp = nodeOfType(model, "component");
    const { api } = renderWithArch(detail(comp.id), model);
    expect(screen.getByText("Expected input")).toBeTruthy();
    expect(screen.getByRole("button", { name: "fetchUser" })).toBeTruthy();
    expect(screen.getByText("none yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trace this component" }));
    expect(api.closeModal).toHaveBeenCalled();
    expect(api.startTrace).toHaveBeenCalledWith(comp.id);
  });

  it("shows configuration for other nodes and layer cards", () => {
    const model = starter();
    const fn = nodeOfType(model, "function");
    renderWithArch(detail(fn.id), model);
    expect(screen.getByText("Configuration")).toBeTruthy();
    expect(screen.getByText("Function")).toBeTruthy();
  });

  it("looks up layer card nodes too", () => {
    const model = starter();
    renderWithArch(detail(model.lnodes[0].id), model);
    expect(screen.getByRole("dialog", { name: "Client layer" })).toBeTruthy();
  });
});
