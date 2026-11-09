import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createNode, newCollection, starter } from "@/pages/ArchTest/engine";
import { DetailModal } from "./details/DetailModal";
import { StateDetail } from "./details/StateDetail";
import { nodeOfType, renderWithArch } from "@/pages/ArchTest/testing/overlayHarness";

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
      if (column === "orders.user_id") return rect(10, 100);
      if (column === "users.id") return rect(300, 40);
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
    const mongo = createNode("nosql", 0, 0, { layer: "db" });
    if (mongo.type !== "nosql") throw new Error("type");
    const events = newCollection("events");
    events.indexes.push({ name: "name_unique", columns: "name", unique: true });
    mongo.cfg.collections = [events, { ...newCollection("empty"), indexes: [], data: "{}" }];
    model.nodes.push(mongo);
    renderWithArch(detail(mongo.id), model);
    expect(screen.getByText("events")).toBeTruthy();
    expect(screen.getByText("Indexes: name_1 (name), name_unique (name) unique")).toBeTruthy();
    expect(screen.getByText(/Indexes: none/)).toBeTruthy();
    expect(screen.getAllByText("Example document")).toHaveLength(2);
  });

  it("says when a NoSQL database has no collections", () => {
    const model = starter();
    const mongo = createNode("nosql", 0, 0, { layer: "db" });
    if (mongo.type !== "nosql") throw new Error("type");
    mongo.cfg.collections = [];
    model.nodes.push(mongo);
    renderWithArch(detail(mongo.id), model);
    expect(screen.getByText("No collections.")).toBeTruthy();
  });

});

describe("DetailModal for state and services", () => {
  it("draws the state dependency graph over app and component state and flags unused variables", () => {
    const model = starter();
    renderWithArch(<StateDetail onClose={vi.fn()} />, model);
    expect(screen.getByRole("img", { name: "State dependencies" })).toBeTruthy();
    expect(screen.getAllByText("UserProfile").length).toBeGreaterThan(0);
    expect(screen.getByText("currentUser")).toBeTruthy();
    expect(screen.getByText("isLoading is not read or modified by anything yet.")).toBeTruthy();
    expect(document.querySelectorAll('path[marker-end="url(#sdm)"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('path[marker-end="url(#sdm2)"]').length).toBeGreaterThan(0);
  });

  it("asks for variables when neither the store nor any component has state", () => {
    const model = starter();
    model.store = [];
    nodeOfType(model, "component").cfg.state = [];
    renderWithArch(<StateDetail onClose={vi.fn()} />, model);
    expect(screen.getByText("Add app state or component state first.")).toBeTruthy();
  });

  it("shows each endpoint's query, bound sample, result structure and rows", () => {
    const model = starter();
    renderWithArch(detail(nodeOfType(model, "service").id), model);
    expect(screen.getByRole("dialog", { name: "User service (FastAPI)" })).toBeTruthy();
    const getUser = within(screen.getByRole("region", { name: "GET /users/:id" }));
    expect(getUser.getByText(/SELECT users.id/)).toBeTruthy();
    expect(getUser.getByText(/Bound: id = 1/)).toBeTruthy();
    expect(getUser.getByText("orders")).toBeTruthy();
    expect(getUser.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("shows an empty query result and tolerates a non-object sample", () => {
    const model = starter();
    const service = nodeOfType(model, "service");
    const getUser = service.cfg.endpoints[0];
    getUser.sample = "[1]";
    getUser.q.where = [];
    nodeOfType(model, "sqldb").cfg.tables.forEach((table) => (table.data = "[]"));
    renderWithArch(detail(service.id), model);
    const section = within(screen.getByRole("region", { name: "GET /users/:id" }));
    expect(section.getByText("No rows.")).toBeTruthy();
    expect(section.queryByText(/Bound:/)).toBeNull();
  });

  it("shows the curl example, declared responses and callers of endpoints without a database query", () => {
    const model = starter();
    const { api } = renderWithArch(detail(nodeOfType(model, "service").id), model);
    const createUser = within(screen.getByRole("region", { name: "POST /users" }));
    expect(createUser.getByText(/curl -X POST https:\/\/api.example.com\/users/)).toBeTruthy();
    expect(createUser.getByText("Response 201 Created")).toBeTruthy();
    expect(createUser.getByText("none yet")).toBeTruthy();
    const getUser = within(screen.getByRole("region", { name: "GET /users/:id" }));
    expect(getUser.getByText(/curl -X GET https:\/\/api.example.com\/users\/123/)).toBeTruthy();
    fireEvent.click(getUser.getByRole("button", { name: "fetchUser" }));
    expect(api.reveal).toHaveBeenCalledWith(nodeOfType(model, "function").id);
  });

  it("says when a service has no endpoints", () => {
    const model = starter();
    const service = nodeOfType(model, "service");
    service.cfg.endpoints = [];
    renderWithArch(detail(service.id), model);
    expect(screen.getByText("This service has no endpoints yet.")).toBeTruthy();
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
