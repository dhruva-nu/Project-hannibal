import { describe, expect, it } from "vitest";
import { flowRows } from "./flowRows";

const statusOf = (rows: ReturnType<typeof flowRows>, path: string) => rows.find((r) => r.path === path)?.status;

describe("flowRows", () => {
  it("marks removed, added, mapped and modified fields without a contract", () => {
    const rows = flowRows(
      { gone: 1, kept: 1, changed: 1, userId: 5 },
      { kept: 1, changed: 2, id: 5, extra: true },
      null,
      [{ from: "userId", to: "id", value: "" }],
    );
    expect(statusOf(rows, "gone")).toBe("removed");
    expect(statusOf(rows, "kept")).toBe("");
    expect(statusOf(rows, "changed")).toBe("modified");
    expect(statusOf(rows, "id")).toBe("mapped");
    expect(statusOf(rows, "extra")).toBe("added");
    expect(rows.every((r) => r.expected === "")).toBe(true);
  });

  it("applies the target contract: missing, unused, type mismatch, any", () => {
    const rows = flowRows(
      { a: 1, b: "x", c: 1, d: 1, u: 1 },
      { a: 1, b: 2, extra: 1, d: 1, u: 1 },
      { a: 0, b: "", c: 0, d: "__any__" },
      [],
    );
    expect(statusOf(rows, "c")).toBe("missing");
    expect(statusOf(rows, "u")).toBe("unused");
    expect(statusOf(rows, "extra")).toBe("added");
    expect(statusOf(rows, "b")).toBe("type");
    expect(statusOf(rows, "a")).toBe("");
    expect(rows.find((r) => r.path === "d")?.expected).toBe("any");
    expect(rows.find((r) => r.path === "a")?.expected).toBe("0");
  });

  it("keeps an earlier status when the wire field is unexpected", () => {
    const rows = flowRows({}, { extra: 1 }, { other: 1 }, []);
    expect(statusOf(rows, "extra")).toBe("added");
  });

  it("does not flag null wire values as type mismatches and truncates long cells", () => {
    const rows = flowRows({ n: null, long: "x".repeat(100) }, { n: null, long: "x".repeat(100) }, { n: 0 }, []);
    expect(statusOf(rows, "n")).toBe("");
    expect(rows.find((r) => r.path === "long")?.source).toHaveLength(60);
  });

  it("returns no rows for empty payloads", () => {
    expect(flowRows(undefined, undefined, null, [])).toHaveLength(1);
  });
});
