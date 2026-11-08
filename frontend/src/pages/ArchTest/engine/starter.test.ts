import { describe, expect, it } from "vitest";
import { blank, genSampleRows, inferFields, pathParamKeys, sampleVal, starter } from "./starter";
import { byName } from "./testFixtures";
import type { ConnectorNode, SqlColumn, SqlNode } from "./types";

describe("starter and blank diagrams", () => {
  it("builds a normalised user profile diagram", () => {
    const model = starter();
    expect(model.name).toBe("User profile example");
    expect(model.nodes.map((n) => n.name)).toEqual(["App state", "UserProfile", "fetchUser", "Get user", "userWithOrders", "app_db"]);
    expect(model.edges).toHaveLength(4);
    expect(model.lnodes).toHaveLength(3);
    expect(byName<ConnectorNode>(model, "userWithOrders").cfg.dbId).toBe(byName(model, "app_db").id);
    expect(model.views.overview).toBe(model.view);
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
    expect(sampleVal(column("int", true), 2)).toBe(2);
    expect(sampleVal(column("bigint"), 2)).toBe(20);
    expect(sampleVal(column("numeric"), 2)).toBe(21);
    expect(sampleVal(column("boolean"), 1)).toBe(true);
    expect(sampleVal(column("boolean"), 2)).toBe(false);
    expect(sampleVal(column("timestamp"), 2)).toBe("2024-02-01T10:00:00Z");
    expect(sampleVal(column("date"), 2)).toBe("2024-02-01");
    expect(sampleVal(column("uuid"), 2)).toBe("00000000-0000-4000-8000-000000000002");
    expect(sampleVal(column("json"), 2)).toEqual({});
    expect(sampleVal(column("text"), 2)).toBe("c_2");
  });

  it("generates rows following foreign keys", () => {
    const model = starter();
    const db = byName<SqlNode>(model, "app_db");
    const rows = JSON.parse(genSampleRows(db, db.cfg.tables[1]));
    expect(rows.map((r: { user_id: number }) => r.user_id)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ id: 1, total: 10.5, status: "status_1" });
    db.cfg.tables[0].data = "[]";
    const orphan = JSON.parse(genSampleRows(db, db.cfg.tables[1]));
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
