import { describe, expect, it } from "vitest";
import type { Lesson } from "@/services/courseDetail";
import {
  applyMarkTheoryDone,
  applyOpenLesson,
  initialState,
  type CourseState,
} from "./courseStateTransitions";

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

const lessons = [makeLesson({ id: "1" }), makeLesson({ id: "2" }), makeLesson({ id: "3" })];

describe("applyOpenLesson", () => {
  it("does not open a locked lesson", () => {
    const prev = initialState();
    const { state, didOpen } = applyOpenLesson(prev, lessons, "2");
    expect(didOpen).toBe(false);
    expect(state).toBe(prev);
  });

  it("opens the first theory lesson", () => {
    const { state, didOpen } = applyOpenLesson(initialState(), lessons, "1");
    expect(didOpen).toBe(true);
    expect(state.activeId).toBe("1");
    expect(state.theoryOpen).toBe(true);
  });

  it("re-opens a completed lesson", () => {
    const prev: CourseState = { ...initialState(), completed: new Set(["1", "2"]) };
    const { state, didOpen } = applyOpenLesson(prev, lessons, "2");
    expect(didOpen).toBe(true);
    expect(state.activeId).toBe("2");
  });

  it("ignores unknown lesson ids", () => {
    const prev = initialState();
    expect(applyOpenLesson(prev, lessons, "nope").didOpen).toBe(false);
  });

  it("opens a locked lesson when unlockAll is set", () => {
    const prev = initialState();
    const { state, didOpen } = applyOpenLesson(prev, lessons, "2", true);
    expect(didOpen).toBe(true);
    expect(state.activeId).toBe("2");
    expect(state.theoryOpen).toBe(true);
  });
});

describe("applyMarkTheoryDone", () => {
  it("completes the active lesson and advances to the next", () => {
    const prev: CourseState = { ...initialState(), activeId: "1", theoryOpen: true };
    const { state, completedLessonId } = applyMarkTheoryDone(prev, lessons);
    expect(completedLessonId).toBe("1");
    expect(state.completed.has("1")).toBe(true);
    expect(state.activeId).toBe("2");
    expect(state.theoryOpen).toBe(false);
  });

  it("does not report an already-completed lesson again", () => {
    const prev: CourseState = { ...initialState(), activeId: "1", completed: new Set(["1"]) };
    const { state, completedLessonId } = applyMarkTheoryDone(prev, lessons);
    expect(completedLessonId).toBeNull();
    expect(state.activeId).toBe("1");
  });

  it("is a no-op without an active lesson", () => {
    const prev = initialState();
    expect(applyMarkTheoryDone(prev, lessons).state).toBe(prev);
  });
});
