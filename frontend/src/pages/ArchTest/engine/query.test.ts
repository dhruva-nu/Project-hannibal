import { describe, expect, it } from "vitest";
import { aggregate, bindParameter, planColumns, readField, runQuery, schemaOf, shapeRows, splitField, testOp } from "./query";
import { autoJoin, pruneQuery } from "./queryEditing";
import { buildQuery, paramsUsed } from "./queryText";
import { addNode, byName, endpointOf, resetQuery, starterModel, starterService } from "./testFixtures";
import type { FilterOp, NosqlNode, SqlNode } from "./types";

describe("row access and operators", () => {
  it("reads fields with and without a table prefix", () => {
    const row = { users: { id: 1, nested: { a: 2 } }, orders: null };
    expect(readField(row, "")).toBeUndefined();
    expect(readField(row, "users.id")).toBe(1);
    expect(readField(row, "users.nested.a")).toBe(2);
    expect(readField(row, "orders.id")).toBeUndefined();
    expect(readField({ users: { id: 1 } }, "id")).toBe(1);
    expect(readField(row, "id")).toBeUndefined();
  });

  it("evaluates every operator", () => {
    const cases: [unknown, FilterOp, unknown, boolean][] = [
      [1, "=", "1", true],
      [1, "!=", 2, true],
      [3, ">", 2, true],
      [3, ">=", 3, true],
      [1, "<", 2, true],
      [2, "<=", 2, true],
      ["Hello", "contains", "ell", true],
      [null, "contains", "x", false],
      [undefined, "contains", "x", false],
      [2, "in", [1, 2], true],
      [2, "in", "nope", false],
    ];
    cases.forEach(([a, op, b, expected]) => expect(testOp(a, op, b)).toBe(expected));
  });

  it("binds parameters and literals", () => {
    expect(bindParameter(":id", { id: 5 })).toBe(5);
    expect(bindParameter("7", {})).toBe(7);
    expect(bindParameter("abc", {})).toBe("abc");
    expect(bindParameter(null, {})).toBe("");
    expect(bindParameter(undefined, {})).toBe("");
  });

  it("splits qualified fields", () => {
    expect(splitField("users.id", ["users", "orders"])).toEqual(["users", "id"]);
    expect(splitField("id", ["users"])).toEqual(["users", "id"]);
    expect(splitField("x.id", ["users"])).toEqual(["users", "x.id"]);
    expect(splitField("users", ["users"])).toEqual(["users", "users"]);
  });

  it("aggregates numbers", () => {
    const values = [1, 2, "3", null, "x"];
    expect(aggregate("count", values)).toBe(4);
    expect(aggregate("sum", values)).toBe(6);
    expect(aggregate("avg", values)).toBe(2);
    expect(aggregate("min", values)).toBe(1);
    expect(aggregate("max", values)).toBe(3);
    ["sum", "avg", "min", "max"].forEach((fn) => expect(aggregate(fn as "sum", [])).toBeNull());
    expect(aggregate("count", [undefined])).toBe(0);
  });
});

describe("planning and running queries", () => {
  it("plans the starter join with disambiguated keys", () => {
    const model = starterModel();
    const plan = planColumns(model, endpointOf(model));
    expect(plan.agg).toBe(false);
    expect(plan.cols.map((c) => c.key)).toEqual(["users_id", "name", "email", "orders_id", "total", "status"]);
  });

  it("plans with no database, renamed columns and default selection", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.select = [{ field: "users.name", as: "who" }];
    expect(planColumns(model, endpoint).cols[0]).toMatchObject({ col: "who", key: "who" });
    endpoint.q.select = [];
    expect(planColumns(model, endpoint).cols).toHaveLength(8);
    endpoint.dbId = "";
    expect(planColumns(model, endpoint)).toEqual({ tabs: [], cols: [], agg: false });
  });

  it("returns nested rows for the starter query", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    const flatRows = runQuery(model, endpoint, { id: 1 }).rows;
    expect(flatRows).toHaveLength(2);
    expect(flatRows[0]).toMatchObject({ users_id: 1, orders_id: 101 });
    const nested = shapeRows(model, endpoint, flatRows) as Record<string, unknown>[];
    expect(nested).toHaveLength(1);
    expect(nested[0].orders).toEqual([
      { id: 101, total: 42.5, status: "paid" },
      { id: 102, total: 19.99, status: "shipped" },
    ]);
    const noOrders = shapeRows(model, endpoint, runQuery(model, endpoint, { id: 3 }).rows) as Record<string, unknown>[];
    expect(noOrders[0].orders).toEqual([]);
    expect(runQuery(model, endpoint, { id: 99 }).rows).toEqual([]);
  });

  it("leaves results flat when nesting does not apply", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    const rows = runQuery(model, endpoint, { id: 1 }).rows;
    endpoint.q.nest = false;
    expect(shapeRows(model, endpoint, rows)).toBe(rows);
    endpoint.q.nest = true;
    endpoint.q.tables = ["users"];
    expect(shapeRows(model, endpoint, rows)).toBe(rows);
    resetQuery(endpoint, { tables: ["orders"], nest: true, group: ["orders.status"] });
    expect(shapeRows(model, endpoint, rows)).toBe(rows);
  });

  it("reports missing database and tables", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.tables = ["ghost"];
    expect(runQuery(model, endpoint, {}).error).toBe("No table selected");
    endpoint.dbId = "";
    expect(runQuery(model, endpoint, {}).error).toBe("No database selected");
  });

  it("skips incomplete joins, honours inner joins and limits", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    resetQuery(endpoint, {
      tables: ["users", "orders"],
      joins: [
        { type: "LEFT", table: "ghost", left: "a", right: "b" },
        { type: "LEFT", table: "orders", left: "", right: "" },
      ],
    });
    expect(runQuery(model, endpoint, {}).rows).toHaveLength(3);
    resetQuery(endpoint, {
      tables: ["users", "orders"],
      joins: [{ type: "INNER", table: "orders", left: "users.id", right: "orders.user_id" }],
      limit: 2,
    });
    expect(runQuery(model, endpoint, {}).rows).toHaveLength(2);
    endpoint.q.limit = "";
    expect(runQuery(model, endpoint, {}).rows).toHaveLength(3);
  });

  it("groups and aggregates", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    resetQuery(endpoint, {
      tables: ["orders"],
      group: ["orders.status"],
      aggs: [
        { fn: "sum", field: "orders.total", as: "" },
        { fn: "count", field: "", as: "n" },
      ],
    });
    const rows = runQuery(model, endpoint, {}).rows;
    expect(rows).toEqual([
      { status: "paid", sum_total: 130.5, n: 2 },
      { status: "shipped", sum_total: 19.99, n: 1 },
    ]);
    resetQuery(endpoint, {
      tables: ["orders"],
      where: [{ field: "orders.id", op: ">", value: "1000" }],
      aggs: [{ fn: "count", field: "", as: "" }],
    });
    expect(runQuery(model, endpoint, {}).rows).toEqual([{ count_all: 0 }]);
    resetQuery(endpoint, {
      tables: ["orders"],
      where: [{ field: "orders.id", op: ">", value: "1000" }],
      group: ["orders.status"],
      aggs: [{ fn: "avg", field: "orders.total", as: "" }],
    });
    expect(runQuery(model, endpoint, {}).rows).toEqual([]);
  });
});

describe("building query text", () => {
  it("builds parameterised sql for the starter query", () => {
    const model = starterModel();
    const built = buildQuery(model, endpointOf(model), { id: 1 });
    expect(built.sql).toBe(
      "SELECT users.id, users.name, users.email, orders.id, orders.total, orders.status\nFROM users\nLEFT JOIN orders ON users.id = orders.user_id\nWHERE users.id = $1;",
    );
    expect(built.binds).toEqual([{ name: "id", value: 1 }]);
  });

  it("builds sql with literals, operators, grouping and limits", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    resetQuery(endpoint, {
      tables: ["users", "orders"],
      joins: [
        { type: "LEFT", table: "orders", left: "", right: "" },
        { type: "INNER", table: "orders", left: "users.id", right: "orders.user_id" },
      ],
      where: [
        { field: "users.name", op: "contains", value: "O'Neil" },
        { field: "users.id", op: "in", value: "[1,2]" },
        { field: "users.id", op: "!=", value: "" },
      ],
      select: [{ field: "users.name", as: "who" }, { field: "users.id", as: "" }],
      limit: 5,
    });
    expect(buildQuery(model, endpoint, {}).sql).toBe(
      "SELECT users.name AS who, users.id\nFROM users\nINNER JOIN orders ON users.id = orders.user_id\nWHERE users.name LIKE '%' || 'O''Neil' || '%'\n  AND users.id IN [1,2]\n  AND users.id <> ''\nLIMIT 5;",
    );
    resetQuery(endpoint, {
      tables: ["orders"],
      group: ["orders.status"],
      aggs: [
        { fn: "count", field: "", as: "" },
        { fn: "sum", field: "orders.total", as: "t" },
      ],
    });
    expect(buildQuery(model, endpoint, {}).sql).toBe(
      "SELECT orders.status, COUNT(*) AS count_all, SUM(orders.total) AS t\nFROM orders\nGROUP BY orders.status;",
    );
    resetQuery(endpoint, { tables: ["orders"] });
    expect(buildQuery(model, endpoint, {}).sql).toBe("SELECT *\nFROM orders;");
    resetQuery(endpoint, { tables: ["orders"], where: [{ field: "orders.id", op: "=", value: null as unknown as string }] });
    expect(buildQuery(model, endpoint, {}).sql).toBe("SELECT *\nFROM orders\nWHERE orders.id = '';");
  });

  it("asks for a database and table first", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.tables = [];
    expect(buildQuery(model, endpoint, {}).sql).toBe("-- choose a database and a table");
    endpoint.dbId = "";
    expect(buildQuery(model, endpoint, {}).binds).toEqual([]);
  });

  it("builds mongo queries", () => {
    const model = starterModel();
    const mongo = addNode<NosqlNode>(model, "nosql", "docs");
    const endpoint = endpointOf(model);
    endpoint.dbId = mongo.id;
    resetQuery(endpoint, { tables: ["documents"] });
    expect(buildQuery(model, endpoint, {}).sql).toBe("db.documents.find({})");
    resetQuery(endpoint, {
      tables: ["documents"],
      where: [
        { field: "name", op: "=", value: ":name" },
        { field: "age", op: ">", value: "3" },
        { field: "tag", op: "contains", value: "x" },
      ],
      select: [{ field: "name", as: "" }],
      limit: 4,
    });
    const built = buildQuery(model, endpoint, { name: "ada" });
    expect(built.sql).toBe(
      'db.documents.find({"name":"ada","age":{"$gt":3},"tag":{"$regex":"x"}}, {"name":1}).limit(4)',
    );
    expect(built.binds).toEqual([{ name: "name", value: "ada" }]);
    resetQuery(endpoint, {
      tables: ["documents"],
      where: [{ field: "name", op: "=", value: "" }],
      group: ["kind"],
      aggs: [
        { fn: "count", field: "", as: "" },
        { fn: "avg", field: "age", as: "mean" },
      ],
    });
    expect(buildQuery(model, endpoint, {}).sql).toBe(
      'db.documents.aggregate([\n  { $match: {"name":""} },\n  { $group: { _id: { kind: "$kind" }, count_all: { $sum: 1 }, mean: { $avg: "$age" } } }\n])',
    );
    resetQuery(endpoint, { tables: ["documents"], aggs: [{ fn: "count", field: "", as: "" }] });
    expect(buildQuery(model, endpoint, {}).sql).toContain("_id: null");
    resetQuery(endpoint, { tables: ["documents"], where: [{ field: "a", op: "in", value: ":ids" }] });
    expect(buildQuery(model, endpoint, {}).sql).toBe('db.documents.find({"a":{"$in":null}})');
  });
});

describe("introspection helpers", () => {
  it("lists distinct bound parameters", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    endpoint.q.where = [
      { field: "a", op: "=", value: ":id" },
      { field: "b", op: "=", value: ":id" },
      { field: "c", op: "=", value: "5" },
      { field: "d", op: "=", value: "" },
    ];
    expect(paramsUsed(endpoint)).toEqual(["id"]);
  });

  it("describes value shapes", () => {
    expect(schemaOf(null)).toBe("null");
    expect(schemaOf([])).toEqual([]);
    expect(schemaOf([{ a: 1 }])).toEqual([{ a: "number" }]);
    expect(schemaOf({ a: "x", b: [true] })).toEqual({ a: "string", b: ["boolean"] });
    expect(schemaOf(undefined)).toBe("undefined");
  });
});

describe("join helpers", () => {
  it("joins from the foreign key in either direction", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    autoJoin(model, endpoint);
    expect(endpoint.q.joins).toEqual([
      { type: "LEFT", table: "orders", left: "users.id", right: "orders.user_id" },
    ]);
    endpoint.q.tables = ["orders", "users"];
    autoJoin(model, endpoint);
    expect(endpoint.q.joins).toEqual([
      { type: "LEFT", table: "users", left: "orders.user_id", right: "users.id" },
    ]);
    endpoint.q.tables = ["users", "ghost"];
    autoJoin(model, endpoint);
    expect(endpoint.q.joins).toEqual([]);
    endpoint.q.tables = ["ghost", "users"];
    autoJoin(model, endpoint);
    expect(endpoint.q.joins).toEqual([]);
  });

  it("ignores foreign keys to the same table, and non-sql databases", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    const orders = byName<SqlNode>(model, "app_db").cfg.tables[1];
    orders.columns[1].fk = "orders.id";
    endpoint.q.tables = ["users", "orders", "users"];
    autoJoin(model, endpoint);
    expect(endpoint.q.joins).toEqual([]);
    endpoint.q.joins = [{ type: "LEFT", table: "x", left: "", right: "" }];
    const mongo = addNode<NosqlNode>(model, "nosql", "docs");
    endpoint.dbId = mongo.id;
    endpoint.q.joins = [{ type: "LEFT", table: "x", left: "", right: "" }];
    autoJoin(model, endpoint);
    expect(endpoint.q.joins).toHaveLength(1);
    endpoint.dbId = "";
    autoJoin(model, endpoint);
  });

  it("prunes references that no longer exist", () => {
    const model = starterModel();
    const endpoint = endpointOf(model);
    resetQuery(endpoint, {
      tables: ["users", "orders"],
      joins: [
        { type: "LEFT", table: "ghost", left: "users.id", right: "gone.x" },
        { type: "LEFT", table: "orders", left: "gone.y", right: "orders.user_id" },
        { type: "LEFT", table: "orders", left: "users.id", right: "gone.x" },
      ],
      select: [{ field: "users.id", as: "" }, { field: "gone.z", as: "" }],
      where: [{ field: "", op: "=", value: "1" }, { field: "gone.z", op: "=", value: "1" }, { field: "users.id", op: "=", value: "1" }],
      group: ["users.id", "gone.q"],
      aggs: [{ fn: "count", field: "", as: "" }, { fn: "sum", field: "gone.w", as: "" }, { fn: "sum", field: "orders.total", as: "" }],
    });
    pruneQuery(model, endpoint);
    const q = endpoint.q;
    expect(q.joins).toEqual([
      { type: "LEFT", table: "orders", left: "", right: "orders.user_id" },
      { type: "LEFT", table: "orders", left: "users.id", right: "" },
    ]);
    expect(q.select).toHaveLength(1);
    expect(q.where).toHaveLength(2);
    expect(q.group).toEqual(["users.id"]);
    expect(q.aggs).toHaveLength(2);
    resetQuery(endpoint, { tables: ["users", "orders"], joins: [{ type: "LEFT", table: "ghost", left: "", right: "" }] });
    pruneQuery(model, endpoint);
    expect(endpoint.q.joins).toHaveLength(1);
    endpoint.dbId = "";
    pruneQuery(model, endpoint);
  });

  it("is wired to the database the endpoint queries", () => {
    const model = starterModel();
    const database = byName(model, "app_db");
    expect(endpointOf(model).dbId).toBe(database.id);
    expect(model.edges.some((e) => e.from === starterService(model).id && e.to === database.id)).toBe(true);
  });
});
