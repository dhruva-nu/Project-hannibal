import { describe, expect, it } from "vitest";
import type { Lesson } from "@/services/courseDetail";
import { computeRevealed, isLessonUnlocked } from "./courseProgress";

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "1",
    num: "01",
    title: "lesson",
    meta: "theory",
    nosqlId: "abc",
    theory: { tag: "theory", body: "" },
    adds: { nodes: [], edges: [], modules: [] },
    ...overrides,
  };
}

describe("isLessonUnlocked", () => {
  const lessons = [makeLesson({ id: "1" }), makeLesson({ id: "2" })];

  it("always unlocks the first lesson", () => {
    expect(isLessonUnlocked(lessons, 0, new Set())).toBe(true);
  });

  it("unlocks a lesson only when its predecessor is completed", () => {
    expect(isLessonUnlocked(lessons, 1, new Set())).toBe(false);
    expect(isLessonUnlocked(lessons, 1, new Set(["1"]))).toBe(true);
  });
});

describe("computeRevealed", () => {
  const lessons = [
    makeLesson({
      id: "1",
      adds: { nodes: ["api"], edges: ["e1"], modules: ["api:auth"] },
      addsExtra: { nodes: ["cache"] },
    }),
    makeLesson({ id: "2", adds: { nodes: ["db"], edges: [], modules: [] } }),
  ];

  it("reveals only what completed lessons add", () => {
    const revealed = computeRevealed(lessons, new Set(["1"]));
    expect([...revealed.nodes].sort()).toEqual(["api", "cache"]);
    expect([...revealed.edges]).toEqual(["e1"]);
    expect([...revealed.mods]).toEqual(["api:auth"]);
  });

  it("reveals nothing when no lesson is completed", () => {
    expect(computeRevealed(lessons, new Set()).nodes.size).toBe(0);
  });
});
