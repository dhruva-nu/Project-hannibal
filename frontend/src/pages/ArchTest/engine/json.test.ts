import { describe, expect, it } from "vitest";
import {
  clone,
  deletePath,
  getPath,
  isObject,
  parseLiteral,
  isValidJson,
  parseJsonOr,
  pathSegments,
  toPrettyJson,
  emptyValueOfType,
  setPath,
  lastSegment,
  jsonTypeOf,
  uid,
} from "./json";

describe("json helpers", () => {
  it("detects plain objects only", () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject("x")).toBe(false);
  });

  it("builds prefixed ids", () => {
    expect(uid("n")).toMatch(/^n[a-z0-9]+$/);
  });

  it("clones deeply and passes undefined through", () => {
    const source = { a: [1, { b: 2 }] };
    const copy = clone(source);
    copy.a.push(3);
    expect(source.a).toHaveLength(2);
    expect(clone(undefined)).toBeUndefined();
  });


  it("parses json with fallbacks", () => {
    expect(parseJsonOr(null, "fb")).toBe("fb");
    expect(parseJsonOr(undefined, "fb")).toBe("fb");
    expect(parseJsonOr({ a: 1 }, "fb")).toEqual({ a: 1 });
    expect(parseJsonOr("   ", "fb")).toBe("fb");
    expect(parseJsonOr('{"a":1}', "fb")).toEqual({ a: 1 });
    expect(parseJsonOr("{bad", "fb")).toBe("fb");
    expect(parseJsonOr("[1]", null)).toEqual([1]);
  });

  it("validates json text", () => {
    expect(isValidJson(5)).toBe(true);
    expect(isValidJson("  ")).toBe(true);
    expect(isValidJson("{}")).toBe(true);
    expect(isValidJson("{")).toBe(false);
  });

  it("pretty prints", () => {
    expect(toPrettyJson(undefined)).toBe("");
    expect(toPrettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("splits paths with indexes", () => {
    expect(pathSegments("a.b[0].c")).toEqual(["a", "b", "0", "c"]);
  });

  it("reads paths and stops at null", () => {
    const root = { a: { b: [{ c: 1 }] }, n: null };
    expect(getPath(root, "a.b[0].c")).toBe(1);
    expect(getPath(root, "n.x")).toBeUndefined();
    expect(getPath(root, "missing.x")).toBeUndefined();
  });

  it("writes paths creating objects and arrays", () => {
    const root: Record<string, unknown> = { scalar: 3 };
    setPath(root, "a.b", 1);
    setPath(root, "list.0.name", "x");
    setPath(root, "scalar.inner", 2);
    setPath(root, "empty.deep", 1);
    setPath(root, "a.c", 2);
    expect(root).toEqual({ a: { b: 1, c: 2 }, list: [{ name: "x" }], scalar: { inner: 2 }, empty: { deep: 1 } });
    const withNull: Record<string, unknown> = { gap: null };
    setPath(withNull, "gap.x", 1);
    expect(withNull).toEqual({ gap: { x: 1 } });
  });

  it("deletes paths safely", () => {
    const root = { a: { b: 1, c: 2 } };
    deletePath(root, "a.b");
    expect(root).toEqual({ a: { c: 2 } });
    deletePath(root, "x.y.z");
    deletePath(root, "a.c.d");
    deletePath({ n: null }, "n.y");
    expect(root).toEqual({ a: { c: 2 } });
  });

  it("interprets literals", () => {
    expect(parseLiteral(5)).toBe(5);
    expect(parseLiteral("true")).toBe(true);
    expect(parseLiteral("plain text")).toBe("plain text");
  });

  it("shortens fields and names types", () => {
    expect(lastSegment("users.id")).toBe("id");
    expect(lastSegment(undefined)).toBe("");
    expect(lastSegment(null)).toBe("");
    expect(jsonTypeOf(null)).toBe("null");
    expect(jsonTypeOf([])).toBe("array");
    expect(jsonTypeOf(1)).toBe("number");
  });

  it("gives sample values per type", () => {
    expect(emptyValueOfType("number")).toBe(0);
    expect(emptyValueOfType("boolean")).toBe(false);
    expect(emptyValueOfType("object")).toEqual({});
    expect(emptyValueOfType("array")).toEqual([]);
    expect(emptyValueOfType("string")).toBe("");
    expect(emptyValueOfType("nope")).toBeUndefined();
  });
});
