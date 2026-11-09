import { describe, expect, it } from "vitest";
import { blank, generateSampleRows, inferFields, pathParamKeys, sampleColumnValue, starter } from "./starter";
import { CREATE_USER_ENDPOINT, GET_USER_ENDPOINT, LIST_USERS_ENDPOINT, byName, endpointOf, starterService } from "./testFixtures";
import type { ComponentNode, FunctionNode, SqlColumn, SqlNode } from "./types";

describe("starter and blank diagrams", () => {
  it("builds a normalised user profile diagram", () => {
    const model = starter();
    expect(model.name).toBe("User profile example");
    expect(model.nodes.map((n) => n.name)).toEqual(["UserProfile", "fetchUser", "User service", "app_db"]);
    expect(model.edges).toHaveLength(3);
    expect(model.lnodes).toHaveLength(3);
    expect(model.views.overview).toBe(model.view);
  });

  it("keeps app-wide variables in the store and loading state on the component", () => {
    const model = starter();
    expect(model.store.map((v) => v.id)).toEqual(["v_user", "v_orders"]);
    expect(byName<ComponentNode>(model, "UserProfile").cfg.state.map((v) => v.name)).toEqual(["isLoading"]);
  });

  it("gives the user service three endpoints, two of them querying app_db", () => {
    const model = starter();
    const dbId = byName(model, "app_db").id;
    expect(starterService(model).cfg.endpoints.map((e) => e.id)).toEqual([
      GET_USER_ENDPOINT,
      LIST_USERS_ENDPOINT,
      CREATE_USER_ENDPOINT,
    ]);
    expect(endpointOf(model).dbId).toBe(dbId);
    expect(endpointOf(model, LIST_USERS_ENDPOINT).dbId).toBe(dbId);
    expect(endpointOf(model, CREATE_USER_ENDPOINT).dbId).toBe("");
    expect(starterService(model).cfg.appServices).toEqual([]);
    expect(byName<FunctionNode>(model, "fetchUser").cfg.endpoint).toBe(GET_USER_ENDPOINT);
  });

  it("builds an independent blank diagram each time", () => {
    const first = blank();
    const second = blank();
    expect(first.name).toBe("Untitled architecture");
    expect(first.nodes).toHaveLength(1);
    first.view.x = 999;
    expect(second.view.x).toBe(60);
  });
});

describe("sample data helpers", () => {
  const column = (type: string, pk = false): SqlColumn => ({ name: "c", type, pk, fk: "" });

  it("makes sample values for each column type", () => {
    expect(sampleColumnValue(column("int", true), 2)).toBe(2);
    expect(sampleColumnValue(column("bigint"), 2)).toBe(20);
    expect(sampleColumnValue(column("numeric"), 2)).toBe(21);
    expect(sampleColumnValue(column("boolean"), 1)).toBe(true);
    expect(sampleColumnValue(column("boolean"), 2)).toBe(false);
    expect(sampleColumnValue(column("timestamp"), 2)).toBe("2024-02-01T10:00:00Z");
    expect(sampleColumnValue(column("date"), 2)).toBe("2024-02-01");
    expect(sampleColumnValue(column("uuid"), 2)).toBe("00000000-0000-4000-8000-000000000002");
    expect(sampleColumnValue(column("json"), 2)).toEqual({});
    expect(sampleColumnValue(column("text"), 2)).toBe("c_2");
  });

  it("generates rows following foreign keys", () => {
    const model = starter();
    const db = byName<SqlNode>(model, "app_db");
    const rows = JSON.parse(generateSampleRows(db, db.cfg.tables[1]));
    expect(rows.map((r: { user_id: number }) => r.user_id)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ id: 1, total: 10.5, status: "status_1" });
    db.cfg.tables[0].data = "[]";
    const orphan = JSON.parse(generateSampleRows(db, db.cfg.tables[1]));
    expect(orphan.map((r: { user_id: number }) => r.user_id)).toEqual([1, 2, 3]);
  });

  it("infers nosql field types from the first document", () => {
    const doc = JSON.stringify([
      { _id: "1", n: 1, b: true, s: "x", d: "2024-01-01T00:00:00Z", a: [1], o: { x: 1 }, z: null },
    ]);
    expect(inferFields(doc)).toEqual([
      { name: "_id", type: "objectId" },
      { name: "n", type: "number" },
      { name: "b", type: "boolean" },
      { name: "s", type: "string" },
      { name: "d", type: "date" },
      { name: "a", type: "array" },
      { name: "o", type: "object" },
      { name: "z", type: "string" },
    ]);
    expect(inferFields("[]")).toBeNull();
    expect(inferFields("[5]")).toBeNull();
    expect(inferFields('{"not":"array"}')).toBeNull();
    expect(inferFields("")).toBeNull();
  });

  it("extracts path parameter names", () => {
    expect(pathParamKeys("/users/:id/orders/{orderId}")).toEqual(["id", "orderId"]);
    expect(pathParamKeys("/plain")).toEqual([]);
  });
});
