import { describe, expect, it } from "vitest";
import {
  clamp,
  clone,
  delPath,
  getPath,
  isObject,
  litVal,
  okJSON,
  parseJsonOr,
  pathSegments,
  pj,
  pretty,
  sampleOf,
  setPath,
  short,
  snap,
  tOf,
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

  it("clamps and snaps", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(snap(14)).toBe(10);
    expect(snap(16)).toBe(20);
  });

  it("parses json with fallbacks", () => {
    expect(pj(null, "fb")).toBe("fb");
    expect(pj(undefined, "fb")).toBe("fb");
    expect(pj({ a: 1 }, "fb")).toEqual({ a: 1 });
    expect(pj("   ", "fb")).toBe("fb");
    expect(pj('{"a":1}', "fb")).toEqual({ a: 1 });
    expect(pj("{bad", "fb")).toBe("fb");
    expect(parseJsonOr("[1]", null)).toEqual([1]);
  });

  it("validates json text", () => {
    expect(okJSON(5)).toBe(true);
    expect(okJSON("  ")).toBe(true);
    expect(okJSON("{}")).toBe(true);
    expect(okJSON("{")).toBe(false);
  });

  it("pretty prints", () => {
    expect(pretty(undefined)).toBe("");
    expect(pretty({ a: 1 })).toBe('{\n  "a": 1\n}');
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
    expect(root).toEqual({ a: { b: 1 }, list: [{ name: "x" }], scalar: { inner: 2 }, empty: { deep: 1 } });
    const withNull: Record<string, unknown> = { gap: null };
    setPath(withNull, "gap.x", 1);
    expect(withNull).toEqual({ gap: { x: 1 } });
  });

  it("deletes paths safely", () => {
    const root = { a: { b: 1, c: 2 } };
    delPath(root, "a.b");
    expect(root).toEqual({ a: { c: 2 } });
    delPath(root, "x.y.z");
    delPath(root, "a.c.d");
    delPath({ n: null }, "n.y");
    expect(root).toEqual({ a: { c: 2 } });
  });

  it("interprets literals", () => {
    expect(litVal(5)).toBe(5);
    expect(litVal("true")).toBe(true);
    expect(litVal("plain text")).toBe("plain text");
  });

  it("shortens fields and names types", () => {
    expect(short("users.id")).toBe("id");
    expect(short(undefined)).toBe("");
    expect(short(null)).toBe("");
    expect(tOf(null)).toBe("null");
    expect(tOf([])).toBe("array");
    expect(tOf(1)).toBe("number");
  });

  it("gives sample values per type", () => {
    expect(sampleOf("number")).toBe(0);
    expect(sampleOf("boolean")).toBe(false);
    expect(sampleOf("object")).toEqual({});
    expect(sampleOf("array")).toEqual([]);
    expect(sampleOf("string")).toBe("");
    expect(sampleOf("nope")).toBeUndefined();
  });
});
