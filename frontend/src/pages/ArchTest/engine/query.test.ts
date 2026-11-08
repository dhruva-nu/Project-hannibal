import { describe, expect, it } from "vitest";
import {
  aggFn,
  autoJoin,
  bindVal,
  buildQuery,
  getF,
  paramsUsed,
  planCols,
  pruneConnector,
  runQuery,
  schemaOf,
  shapeConnector,
  splitField,
  testOp,
} from "./query";
import { addNode, byName, link, starterModel } from "./testFixtures";
import type { ArchModel, ConnectorNode, FilterOp, NosqlNode } from "./types";

const connectorOf = (model: ArchModel) => byName<ConnectorNode>(model, "userWithOrders");

const resetQuery = (connector: ConnectorNode, patch: Partial<ConnectorNode["cfg"]["q"]>) => {
  connector.cfg.q = { ...connector.cfg.q, joins: [], where: [], select: [], group: [], aggs: [], nest: false, limit: "", ...patch };
};

describe("row access and operators", () => {
  it("reads fields with and without a table prefix", () => {
    const row = { users: { id: 1, nested: { a: 2 } }, orders: null };
    expect(getF(row, "")).toBeUndefined();
    expect(getF(row, "users.id")).toBe(1);
    expect(getF(row, "users.nested.a")).toBe(2);
    expect(getF(row, "orders.id")).toBeUndefined();
    expect(getF({ users: { id: 1 } }, "id")).toBe(1);
    expect(getF(row, "id")).toBeUndefined();
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
    expect(bindVal(":id", { id: 5 })).toBe(5);
    expect(bindVal("7", {})).toBe(7);
    expect(bindVal("abc", {})).toBe("abc");
    expect(bindVal(null, {})).toBe("");
    expect(bindVal(undefined, {})).toBe("");
  });

  it("splits qualified fields", () => {
    expect(splitField("users.id", ["users", "orders"])).toEqual(["users", "id"]);
    expect(splitField("id", ["users"])).toEqual(["users", "id"]);
    expect(splitField("x.id", ["users"])).toEqual(["users", "x.id"]);
    expect(splitField("users", ["users"])).toEqual(["users", "users"]);
  });

  it("aggregates numbers", () => {
    const values = [1, 2, "3", null, "x"];
    expect(aggFn("count", values)).toBe(4);
    expect(aggFn("sum", values)).toBe(6);
    expect(aggFn("avg", values)).toBe(2);
    expect(aggFn("min", values)).toBe(1);
    expect(aggFn("max", values)).toBe(3);
    ["sum", "avg", "min", "max"].forEach((fn) => expect(aggFn(fn as "sum", [])).toBeNull());
    expect(aggFn("count", [undefined])).toBe(0);
  });
});

describe("planning and running queries", () => {
  it("plans the starter join with disambiguated keys", () => {
    const model = starterModel();
    const plan = planCols(model, connectorOf(model));
    expect(plan.agg).toBe(false);
    expect(plan.cols.map((c) => c.key)).toEqual(["users_id", "name", "email", "orders_id", "total", "status"]);
  });

  it("plans with no database, renamed columns and default selection", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    connector.cfg.q.select = [{ field: "users.name", as: "who" }];
    expect(planCols(model, connector).cols[0]).toMatchObject({ col: "who", key: "who" });
    connector.cfg.q.select = [];
    expect(planCols(model, connector).cols).toHaveLength(8);
    connector.cfg.dbId = "";
    expect(planCols(model, connector)).toEqual({ tabs: [], cols: [], agg: false });
  });

  it("returns nested rows for the starter query", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    const flatRows = runQuery(model, connector, { id: 1 }).rows;
    expect(flatRows).toHaveLength(2);
    expect(flatRows[0]).toMatchObject({ users_id: 1, orders_id: 101 });
    const nested = shapeConnector(model, connector, flatRows) as Record<string, unknown>[];
    expect(nested).toHaveLength(1);
    expect(nested[0].orders).toEqual([
      { id: 101, total: 42.5, status: "paid" },
      { id: 102, total: 19.99, status: "shipped" },
    ]);
    const noOrders = shapeConnector(model, connector, runQuery(model, connector, { id: 3 }).rows) as Record<string, unknown>[];
    expect(noOrders[0].orders).toEqual([]);
    expect(runQuery(model, connector, { id: 99 }).rows).toEqual([]);
  });

  it("leaves results flat when nesting does not apply", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    const rows = runQuery(model, connector, { id: 1 }).rows;
    connector.cfg.q.nest = false;
    expect(shapeConnector(model, connector, rows)).toBe(rows);
    connector.cfg.q.nest = true;
    expect(shapeConnector(model, connector, { not: "array" })).toEqual({ not: "array" });
    connector.cfg.q.tables = ["users"];
    expect(shapeConnector(model, connector, rows)).toBe(rows);
    resetQuery(connector, { tables: ["orders"], nest: true, group: ["orders.status"] });
    expect(shapeConnector(model, connector, rows)).toBe(rows);
  });

  it("reports missing database and tables", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    connector.cfg.q.tables = ["ghost"];
    expect(runQuery(model, connector, {}).error).toBe("No table selected");
    connector.cfg.dbId = "";
    expect(runQuery(model, connector, {}).error).toBe("No database selected");
  });

  it("skips incomplete joins, honours inner joins and limits", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    resetQuery(connector, {
      tables: ["users", "orders"],
      joins: [
        { type: "LEFT", table: "ghost", left: "a", right: "b" },
        { type: "LEFT", table: "orders", left: "", right: "" },
      ],
    });
    expect(runQuery(model, connector, {}).rows).toHaveLength(3);
    resetQuery(connector, {
      tables: ["users", "orders"],
      joins: [{ type: "INNER", table: "orders", left: "users.id", right: "orders.user_id" }],
      limit: 2,
    });
    expect(runQuery(model, connector, {}).rows).toHaveLength(2);
    connector.cfg.q.limit = "";
    expect(runQuery(model, connector, {}).rows).toHaveLength(3);
  });

  it("groups and aggregates", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    resetQuery(connector, {
      tables: ["orders"],
      group: ["orders.status"],
      aggs: [
        { fn: "sum", field: "orders.total", as: "" },
        { fn: "count", field: "", as: "n" },
      ],
    });
    const rows = runQuery(model, connector, {}).rows;
    expect(rows).toEqual([
      { status: "paid", sum_total: 130.5, n: 2 },
      { status: "shipped", sum_total: 19.99, n: 1 },
    ]);
    resetQuery(connector, {
      tables: ["orders"],
      where: [{ field: "orders.id", op: ">", value: "1000" }],
      aggs: [{ fn: "count", field: "", as: "" }],
    });
    expect(runQuery(model, connector, {}).rows).toEqual([{ count_all: 0 }]);
    resetQuery(connector, {
      tables: ["orders"],
      where: [{ field: "orders.id", op: ">", value: "1000" }],
      group: ["orders.status"],
      aggs: [{ fn: "avg", field: "orders.total", as: "" }],
    });
    expect(runQuery(model, connector, {}).rows).toEqual([]);
  });
});

describe("building query text", () => {
  it("builds parameterised sql for the starter query", () => {
    const model = starterModel();
    const built = buildQuery(model, connectorOf(model), { id: 1 });
    expect(built.sql).toBe(
      "SELECT users.id, users.name, users.email, orders.id, orders.total, orders.status\nFROM users\nLEFT JOIN orders ON users.id = orders.user_id\nWHERE users.id = $1;",
    );
    expect(built.binds).toEqual([{ name: "id", value: 1 }]);
  });

  it("builds sql with literals, operators, grouping and limits", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    resetQuery(connector, {
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
    expect(buildQuery(model, connector, {}).sql).toBe(
      "SELECT users.name AS who, users.id\nFROM users\nINNER JOIN orders ON users.id = orders.user_id\nWHERE users.name LIKE '%' || 'O''Neil' || '%'\n  AND users.id IN [1,2]\n  AND users.id <> ''\nLIMIT 5;",
    );
    resetQuery(connector, {
      tables: ["orders"],
      group: ["orders.status"],
      aggs: [
        { fn: "count", field: "", as: "" },
        { fn: "sum", field: "orders.total", as: "t" },
      ],
    });
    expect(buildQuery(model, connector, {}).sql).toBe(
      "SELECT orders.status, COUNT(*) AS count_all, SUM(orders.total) AS t\nFROM orders\nGROUP BY orders.status;",
    );
    resetQuery(connector, { tables: ["orders"] });
    expect(buildQuery(model, connector, {}).sql).toBe("SELECT *\nFROM orders;");
    resetQuery(connector, { tables: ["orders"], where: [{ field: "orders.id", op: "=", value: null as unknown as string }] });
    expect(buildQuery(model, connector, {}).sql).toBe("SELECT *\nFROM orders\nWHERE orders.id = '';");
  });

  it("asks for a database and table first", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    connector.cfg.q.tables = [];
    expect(buildQuery(model, connector, {}).sql).toBe("-- choose a database and a table");
    connector.cfg.dbId = "";
    expect(buildQuery(model, connector, {}).binds).toEqual([]);
  });

  it("builds mongo queries", () => {
    const model = starterModel();
    const mongo = addNode<NosqlNode>(model, "nosql", "docs");
    const connector = connectorOf(model);
    connector.cfg.dbId = mongo.id;
    resetQuery(connector, { tables: ["documents"] });
    expect(buildQuery(model, connector, {}).sql).toBe("db.documents.find({})");
    resetQuery(connector, {
      tables: ["documents"],
      where: [
        { field: "name", op: "=", value: ":name" },
        { field: "age", op: ">", value: "3" },
        { field: "tag", op: "contains", value: "x" },
      ],
      select: [{ field: "name", as: "" }],
      limit: 4,
    });
    const built = buildQuery(model, connector, { name: "ada" });
    expect(built.sql).toBe(
      'db.documents.find({"name":"ada","age":{"$gt":3},"tag":{"$regex":"x"}}, {"name":1}).limit(4)',
    );
    expect(built.binds).toEqual([{ name: "name", value: "ada" }]);
    resetQuery(connector, {
      tables: ["documents"],
      where: [{ field: "name", op: "=", value: "" }],
      group: ["kind"],
      aggs: [
        { fn: "count", field: "", as: "" },
        { fn: "avg", field: "age", as: "mean" },
      ],
    });
    expect(buildQuery(model, connector, {}).sql).toBe(
      'db.documents.aggregate([\n  { $match: {"name":""} },\n  { $group: { _id: { kind: "$kind" }, count_all: { $sum: 1 }, mean: { $avg: "$age" } } }\n])',
    );
    resetQuery(connector, { tables: ["documents"], aggs: [{ fn: "count", field: "", as: "" }] });
    expect(buildQuery(model, connector, {}).sql).toContain("_id: null");
    resetQuery(connector, { tables: ["documents"], where: [{ field: "a", op: "in", value: ":ids" }] });
    expect(buildQuery(model, connector, {}).sql).toBe('db.documents.find({"a":{"$in":null}})');
  });
});

describe("introspection helpers", () => {
  it("lists distinct bound parameters", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    connector.cfg.q.where = [
      { field: "a", op: "=", value: ":id" },
      { field: "b", op: "=", value: ":id" },
      { field: "c", op: "=", value: "5" },
      { field: "d", op: "=", value: "" },
    ];
    expect(paramsUsed(connector)).toEqual(["id"]);
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
    const connector = connectorOf(model);
    autoJoin(model, connector);
    expect(connector.cfg.q.joins).toEqual([
      { type: "LEFT", table: "orders", left: "users.id", right: "orders.user_id" },
    ]);
    connector.cfg.q.tables = ["orders", "users"];
    autoJoin(model, connector);
    expect(connector.cfg.q.joins).toEqual([
      { type: "LEFT", table: "users", left: "orders.user_id", right: "users.id" },
    ]);
    connector.cfg.q.tables = ["users", "ghost"];
    autoJoin(model, connector);
    expect(connector.cfg.q.joins).toEqual([]);
    connector.cfg.q.tables = ["ghost", "users"];
    autoJoin(model, connector);
    expect(connector.cfg.q.joins).toEqual([]);
  });

  it("ignores foreign keys to the same table, and non-sql databases", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    const orders = byName<import("./types").SqlNode>(model, "app_db").cfg.tables[1];
    orders.columns[1].fk = "orders.id";
    connector.cfg.q.tables = ["users", "orders", "users"];
    autoJoin(model, connector);
    expect(connector.cfg.q.joins).toEqual([]);
    connector.cfg.q.joins = [{ type: "LEFT", table: "x", left: "", right: "" }];
    const mongo = addNode<NosqlNode>(model, "nosql", "docs");
    connector.cfg.dbId = mongo.id;
    connector.cfg.q.joins = [{ type: "LEFT", table: "x", left: "", right: "" }];
    autoJoin(model, connector);
    expect(connector.cfg.q.joins).toHaveLength(1);
    connector.cfg.dbId = "";
    autoJoin(model, connector);
  });

  it("prunes references that no longer exist", () => {
    const model = starterModel();
    const connector = connectorOf(model);
    resetQuery(connector, {
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
    pruneConnector(model, connector);
    const q = connector.cfg.q;
    expect(q.joins).toEqual([
      { type: "LEFT", table: "orders", left: "", right: "orders.user_id" },
      { type: "LEFT", table: "orders", left: "users.id", right: "" },
    ]);
    expect(q.select).toHaveLength(1);
    expect(q.where).toHaveLength(2);
    expect(q.group).toEqual(["users.id"]);
    expect(q.aggs).toHaveLength(2);
    resetQuery(connector, { tables: ["users", "orders"], joins: [{ type: "LEFT", table: "ghost", left: "", right: "" }] });
    pruneConnector(model, connector);
    expect(connector.cfg.q.joins).toHaveLength(1);
    connector.cfg.dbId = "";
    pruneConnector(model, connector);
  });

  it("is wired to a real database through the starter edges", () => {
    const model = starterModel();
    expect(model.edges.some((e) => e.to === byName(model, "app_db").id)).toBe(true);
    link(model, byName(model, "Get user"), byName(model, "app_db"));
  });
});
