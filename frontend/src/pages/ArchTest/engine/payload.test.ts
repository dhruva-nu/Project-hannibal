import { describe, expect, it } from "vitest";
import {
  applyEdge,
  applyMap,
  diffPayload,
  expectedFor,
  flat,
  outOf,
  payloadLabel,
  shapeDiff,
  warnText,
} from "./payload";
import { addNode, byName, starterModel } from "./testFixtures";
import type { ApiNode, ComponentNode, ConnectorNode, FunctionNode } from "./types";

describe("applyEdge", () => {
  it("renames fields and adds constants without mutating the input", () => {
    const map = [
      { from: "userId", to: "id", value: "" },
      { from: "", to: "flag", value: "true" },
      { from: "", to: "", value: "ignored" },
    ];
    const input = { userId: 1, keep: "x" };
    expect(applyEdge({ map }, input)).toEqual({ keep: "x", id: 1, flag: true });
    expect(input).toEqual({ userId: 1, keep: "x" });
  });

  it("passes payloads through when there is nothing to map", () => {
    expect(applyEdge(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(applyEdge(null, 5)).toBe(5);
    expect(applyEdge({ map: [] }, { a: 1 })).toEqual({ a: 1 });
    expect(applyEdge({ map: [{ from: "a", to: "b", value: "" }] }, null)).toBeNull();
    expect(applyEdge({ map: [{ from: "a", to: "b", value: "" }] }, undefined)).toBeUndefined();
    expect(applyEdge({ map: [{ from: "a", to: "b", value: "" }] }, "text")).toBe("text");
  });
});

describe("applyMap", () => {
  it("resolves root, named and nested references", () => {
    const template = { user: { id: "$.id" }, all: "$", list: ["$.name", "static"], other: "$Conn.x", num: 3 };
    const root = { id: 1, name: "Ada" };
    expect(applyMap(template, root, { Conn: { x: 9 } })).toEqual({
      user: { id: 1 },
      all: root,
      list: ["Ada", "static"],
      other: 9,
      num: 3,
    });
    expect(applyMap("$Conn", root, { Conn: 4 })).toBe(4);
    expect(applyMap(null, root, {})).toBeNull();
  });
});

describe("flat and diffPayload", () => {
  it("flattens nested structures with limits", () => {
    expect(flat({ a: { b: 1 }, list: [1, 2, 3, 4], empty: [], obj: {} })).toEqual({
      "a.b": 1,
      "list[0]": 1,
      "list[1]": 2,
      "list[2]": 3,
      empty: "[]",
      obj: "{}",
    });
    expect(flat(5)).toEqual({ "(value)": 5 });
    expect(flat([])).toEqual({ "[]": "[]" });
    expect(flat({})).toEqual({ "{}": "{}" });
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(Object.keys(flat(deep))).toEqual(["a.b.c.d.e.f"]);
  });

  it("reports added, changed and removed fields", () => {
    expect(diffPayload({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 })).toEqual([
      { k: "b", t: "chg", from: 2, to: 5 },
      { k: "d", t: "add", to: 4 },
      { k: "c", t: "rem", from: 3 },
    ]);
  });
});

describe("shapeDiff", () => {
  it("accepts matching shapes and wildcards", () => {
    expect(shapeDiff(null, 1)).toEqual([]);
    expect(shapeDiff(undefined, 1)).toEqual([]);
    expect(shapeDiff("__any__", 1)).toEqual([]);
    expect(shapeDiff({ a: 1 }, null)).toEqual([]);
    expect(shapeDiff({ a: 1 }, { a: 2 })).toEqual([]);
    expect(shapeDiff([{ a: 1 }], [{ a: 5 }])).toEqual([]);
    expect(shapeDiff([], [1])).toEqual([]);
    expect(shapeDiff([1], [])).toEqual([]);
  });

  it("reports missing and mistyped fields", () => {
    expect(shapeDiff({ a: 1, b: { c: "x" } }, { b: { c: 2 } })).toEqual([
      { path: "a", kind: "missing", exp: "number" },
      { path: "b.c", kind: "type", exp: "string", act: "number" },
    ]);
    expect(shapeDiff({ a: 1 }, undefined)).toEqual([{ path: "(root)", kind: "missing", exp: "object" }]);
    expect(shapeDiff({ a: 1 }, [1])).toEqual([{ path: "(root)", kind: "type", exp: "object", act: "array" }]);
    expect(shapeDiff([{ id: 1 }], [{}])).toEqual([{ path: "[0].id", kind: "missing", exp: "number" }]);
  });

  it("describes warnings", () => {
    expect(warnText({ path: "a", kind: "missing", exp: "number" })).toBe("a is expected (number) but not provided");
    expect(warnText({ path: "a", kind: "type", exp: "string", act: "number" })).toBe("a should be string but is number");
  });
});

describe("expectedFor and outOf", () => {
  it("derives expectations per node type", () => {
    const model = starterModel();
    const api = byName<ApiNode>(model, "Get user");
    expect(expectedFor(api)).toEqual({ id: 0 });
    api.cfg.query.push({ k: "must", type: "string", required: true }, { k: "opt", type: "string", required: false });
    api.cfg.pathParams.push({ k: "", type: "string" });
    api.cfg.body = '{"extra":true}';
    expect(expectedFor(api)).toEqual({ id: 0, must: "", extra: true });
    api.cfg.pathParams = [];
    api.cfg.query = [];
    api.cfg.body = "[1]";
    expect(expectedFor(api)).toBeNull();
    expect(expectedFor(byName<FunctionNode>(model, "fetchUser"))).toEqual({ userId: 1 });
    expect(expectedFor(byName<ConnectorNode>(model, "userWithOrders"))).toEqual({ id: "__any__" });
    byName<ConnectorNode>(model, "userWithOrders").cfg.q.where = [];
    expect(expectedFor(byName(model, "userWithOrders"))).toBeNull();
    expect(expectedFor(byName(model, "app_db"))).toBeNull();
  });

  it("derives outputs per node type", () => {
    const model = starterModel();
    expect(outOf(byName<ComponentNode>(model, "UserProfile"))).toEqual({ userId: 1 });
    const fn = byName<FunctionNode>(model, "fetchUser");
    expect(outOf(fn)).toEqual({ userId: 1 });
    fn.cfg.output = '{"o":1}';
    expect(outOf(fn)).toEqual({ o: 1 });
    expect(outOf(byName(model, "Get user"))).toEqual({ id: 0 });
    expect(outOf(byName(model, "userWithOrders"))).toEqual({});
    expect(outOf(addNode(model, "queue", "q"))).toEqual({});
  });
});

describe("payloadLabel", () => {
  it("summarises payloads", () => {
    expect(payloadLabel(undefined)).toBe("");
    expect(payloadLabel(null)).toBe("null");
    expect(payloadLabel([1, 2])).toBe("[2]");
    expect(payloadLabel({ sql: "x", params: [] })).toBe("SQL query");
    expect(payloadLabel({ a: 1, b: 2, c: 3 })).toBe("{ a, b, c }");
    expect(payloadLabel({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe("{ a, b, c, +2 }");
    expect(payloadLabel(7)).toBe("7");
  });
});
