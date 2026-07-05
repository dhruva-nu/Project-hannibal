import { describe, expect, it } from "vitest";
import type { Lesson } from "@/services/courseDetail";
import type { RunSimpleResult } from "@/services/rce";
import type { TestResult } from "./courseTypes";
import {
  buildTestResults,
  computeRevealed,
  extractRunError,
  isLessonUnlocked,
  parseTestOutput,
} from "./courseProgress";

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "1",
    num: "01",
    kind: "theory",
    title: "lesson",
    meta: "theory",
    nosqlId: "abc",
    adds: { nodes: [], edges: [], modules: [] },
    ...overrides,
  };
}

function makeResult(overrides: Partial<RunSimpleResult> = {}): RunSimpleResult {
  return {
    exec_id: "e1",
    language: "python",
    block_id: "b1",
    exit_code: 0,
    stdout: "",
    stderr: "",
    timed_out: false,
    duration_ms: 10,
    ...overrides,
  };
}

describe("parseTestOutput", () => {
  const existing: TestResult[] = [
    { name: "stores hash", pass: null },
    { name: "rate_limits requests", pass: null },
  ];

  it("returns null when no test markers are present", () => {
    expect(parseTestOutput("plain output\nno markers", existing)).toBeNull();
  });

  it("marks passed and failed tests, normalising underscores and case", () => {
    const stdout = "✓ Stores Hash: ok\n✗ rate limits requests: boom";
    const parsed = parseTestOutput(stdout, existing);
    expect(parsed).toEqual([
      { name: "stores hash", pass: true },
      { name: "rate_limits requests", pass: false },
    ]);
  });

  it("resets unmatched tests to pending", () => {
    const parsed = parseTestOutput("✓ stores hash", existing);
    expect(parsed?.[1]).toEqual({ name: "rate_limits requests", pass: null });
  });
});

describe("buildTestResults", () => {
  it("marks all lesson-defined tests green on exit code 0", () => {
    const lesson = makeLesson({
      kind: "build",
      code: { file: "a.py", starter: "", tests: [{ name: "t1", check: () => false }] },
    });
    const results = buildTestResults(lesson, [], "code", makeResult());
    expect(results).toEqual([{ name: "t1", pass: true }]);
  });

  it("falls back to local check functions on failure", () => {
    const lesson = makeLesson({
      kind: "build",
      code: {
        file: "a.py",
        starter: "",
        tests: [
          { name: "has def", check: (code: string) => code.includes("def") },
          { name: "throws", check: () => { throw new Error("bad check"); } },
        ],
      },
    });
    const results = buildTestResults(lesson, [], "def f(): pass", makeResult({ exit_code: 1 }));
    expect(results).toEqual([
      { name: "has def", pass: true },
      { name: "throws", pass: false },
    ]);
  });

  it("parses backend test output into existing results", () => {
    const lesson = makeLesson({ kind: "build" });
    const existing: TestResult[] = [{ name: "stores hash", pass: null }];
    const results = buildTestResults(
      lesson, existing, "code",
      makeResult({ exit_code: 1, stdout: "✗ stores hash: nope" }),
    );
    expect(results).toEqual([{ name: "stores hash", pass: false }]);
  });

  it("synthesises a single result when nothing else is known", () => {
    const results = buildTestResults(makeLesson(), [], "code", makeResult());
    expect(results).toEqual([{ name: "code runs without error", pass: true }]);
  });
});

describe("extractRunError", () => {
  it("returns null on success or missing result", () => {
    expect(extractRunError(makeResult())).toBeNull();
    expect(extractRunError(null)).toBeNull();
  });

  it("returns trimmed stderr on failure", () => {
    expect(extractRunError(makeResult({ exit_code: 1, stderr: " boom \n" }))).toBe("boom");
  });

  it("returns null when failure produced no stderr", () => {
    expect(extractRunError(makeResult({ exit_code: 1, stderr: "  " }))).toBeNull();
  });

  it("names the package when it is not on the allowlist", () => {
    const result = makeResult({
      exit_code: -1,
      dependency_error: { package: "leftpad", reason: "nope", kind: "not_allowed" },
    });
    expect(extractRunError(result)).toBe(
      "'leftpad' is not on the allowed package list for this sandbox",
    );
  });

  it("marks install failures as retryable", () => {
    const result = makeResult({
      exit_code: -1,
      dependency_error: { package: "numpy", reason: "mirror down", kind: "install_failed" },
    });
    expect(extractRunError(result)).toBe("couldn't install 'numpy' — try running again");
  });

  it("prefers the dependency error over stderr", () => {
    const result = makeResult({
      exit_code: -1,
      stderr: "Traceback (most recent call last): ...",
      dependency_error: { package: "leftpad", reason: "nope", kind: "not_allowed" },
    });
    expect(extractRunError(result)).not.toContain("Traceback");
  });
});

describe("isLessonUnlocked", () => {
  const lessons = [makeLesson({ id: "1" }), makeLesson({ id: "2" }), makeLesson({ id: "3" })];

  it("always unlocks the first lesson", () => {
    expect(isLessonUnlocked(lessons, 0, new Set())).toBe(true);
  });

  it("unlocks a lesson only when its predecessor is completed", () => {
    expect(isLessonUnlocked(lessons, 1, new Set())).toBe(false);
    expect(isLessonUnlocked(lessons, 1, new Set(["1"]))).toBe(true);
    expect(isLessonUnlocked(lessons, 2, new Set(["1"]))).toBe(false);
  });
});

describe("computeRevealed", () => {
  const lessons = [
    makeLesson({
      id: "1",
      adds: { nodes: ["api"], edges: ["api-db"], modules: ["api:auth"] },
      addsExtra: { nodes: ["cache"] },
    }),
    makeLesson({ id: "2", adds: { nodes: ["worker"], edges: [], modules: [] } }),
  ];

  it("reveals only what completed lessons add", () => {
    const revealed = computeRevealed(lessons, new Set(["1"]), null);
    expect([...revealed.nodes].sort()).toEqual(["api", "cache"]);
    expect([...revealed.edges]).toEqual(["api-db"]);
    expect([...revealed.mods]).toEqual(["api:auth"]);
  });

  it("includes the pending placement", () => {
    const asNode = computeRevealed(lessons, new Set(), { kind: "node", id: "queue" });
    expect(asNode.nodes.has("queue")).toBe(true);

    const asModule = computeRevealed(lessons, new Set(), { kind: "module", id: "otp", parent: "api" });
    expect(asModule.mods.has("api:otp")).toBe(true);
  });
});
