import { describe, expect, it } from "vitest";
import type { Lesson } from "@/services/courseDetail";
import type { PlacedNode } from "@/services/nodes";
import {
  applyMarkTheoryDone,
  applyOpenLesson,
  applyPlaceOnBoard,
  initialState,
  type CourseState,
} from "./courseStateTransitions";

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

function makeNode(id: string): PlacedNode {
  return {
    id,
    type: "component",
    label: id,
    parent_id: null,
    default_x: 0,
    default_y: 0,
    default_w: null,
    linked_node_ids: [],
  };
}

const lessons = [
  makeLesson({ id: "1", kind: "theory" }),
  makeLesson({ id: "2", kind: "build", drag: { kind: "node", id: "api", label: "api", scribble: "" } }),
  makeLesson({ id: "3", kind: "theory" }),
];

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

  it("opens an unlocked build lesson with a pending node placement", () => {
    const prev: CourseState = { ...initialState(), completed: new Set(["1"]) };
    const { state, didOpen } = applyOpenLesson(prev, lessons, "2");
    expect(didOpen).toBe(true);
    expect(state.buildStep).toBe(2);
    expect(state.pendingPlacement).toEqual({ kind: "node", id: "api" });
  });

  it("re-opens a completed build lesson without a pending placement", () => {
    const prev: CourseState = { ...initialState(), completed: new Set(["1", "2"]) };
    const { state } = applyOpenLesson(prev, lessons, "2");
    expect(state.buildStep).toBe(2);
    expect(state.pendingPlacement).toBeNull();
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
    expect(state.buildStep).toBe(2);
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

describe("applyPlaceOnBoard", () => {
  it("completes the lesson, advances, and merges only new nodes", () => {
    const prev: CourseState = {
      ...initialState(),
      activeId: "2",
      placedNodes: [makeNode("api")],
    };
    const { state, completedLessonId, addedNodeIds } = applyPlaceOnBoard(
      prev, lessons, [makeNode("api"), makeNode("db")],
    );
    expect(completedLessonId).toBe("2");
    expect(addedNodeIds).toEqual(["db"]);
    expect(state.placedNodes.map(n => n.id)).toEqual(["api", "db"]);
    expect(state.activeId).toBe("3");
    expect(state.buildStep).toBe(3);
  });

  it("keeps the active lesson when it is the last one", () => {
    const prev: CourseState = { ...initialState(), activeId: "3", completed: new Set(["1", "2"]) };
    const { state } = applyPlaceOnBoard(prev, lessons, []);
    expect(state.activeId).toBe("3");
  });
});
