import type { Lesson } from "@/services/courseDetail";
import type { PlacedNode } from "@/services/nodes";
import type { BuildStep, PendingPlacement, TestResult } from "./courseTypes";
import { isLessonUnlocked } from "./courseProgress";

export interface CourseState {
  completed: Set<string>;
  activeId: string | null;
  buildStep: BuildStep;
  codeBufs: Record<string, string>;
  testResults: Record<string, TestResult[]>;
  pendingPlacement: PendingPlacement | null;
  theoryOpen: boolean;
  streamOutput: string[];
  isStreaming: boolean;
  runError: string | null;
  placedNodes: PlacedNode[];
}

export const initialState = (): CourseState => ({
  completed: new Set(),
  activeId: null,
  buildStep: 0,
  codeBufs: {},
  testResults: {},
  pendingPlacement: null,
  theoryOpen: false,
  streamOutput: [],
  isStreaming: false,
  runError: null,
  placedNodes: [],
});

export function applyOpenLesson(
  prev: CourseState,
  lessons: Lesson[],
  id: string,
  unlockAll = false,
): { state: CourseState; didOpen: boolean } {
  const lesson = lessons.find(l => l.id === id);
  if (!lesson) return { state: prev, didOpen: false };
  const idx = lessons.indexOf(lesson);
  const locked = !isLessonUnlocked(lessons, idx, prev.completed) && !prev.completed.has(id);
  if (locked && !unlockAll) {
    return { state: prev, didOpen: false };
  }
  const state: CourseState = { ...prev, activeId: id, buildStep: 0, pendingPlacement: null };
  if (lesson.kind === "theory") state.theoryOpen = true;
  if (lesson.kind === "build") {
    state.buildStep = 2;
    if (!prev.completed.has(id)) {
      if (lesson.target?.type === "service" && lesson.drag) {
        state.pendingPlacement = { kind: "module", id: lesson.drag.id, parent: lesson.drag.parent };
      } else if (lesson.drag?.kind === "node") {
        state.pendingPlacement = { kind: "node", id: lesson.drag.id };
      }
    }
  }
  return { state, didOpen: true };
}

export function applyMarkTheoryDone(
  prev: CourseState,
  lessons: Lesson[],
): { state: CourseState; completedLessonId: string | null } {
  const lesson = lessons.find(l => l.id === prev.activeId);
  if (!lesson) return { state: prev, completedLessonId: null };
  const completed = new Set(prev.completed);
  const wasNew = !completed.has(lesson.id);
  completed.add(lesson.id);
  let activeId = prev.activeId;
  if (wasNew) {
    const idx = lessons.findIndex(l => l.id === prev.activeId);
    const next = lessons[idx + 1];
    if (next) activeId = next.id;
  }
  return {
    state: { ...prev, completed, activeId, buildStep: 0, pendingPlacement: null, theoryOpen: false },
    completedLessonId: wasNew ? lesson.id : null,
  };
}

export function applyPlaceOnBoard(
  prev: CourseState,
  lessons: Lesson[],
  newNodes: PlacedNode[],
): { state: CourseState; completedLessonId: string | null; addedNodeIds: string[] } {
  const current = lessons.find(l => l.id === prev.activeId);
  if (!current) return { state: prev, completedLessonId: null, addedNodeIds: [] };
  const completed = new Set(prev.completed);
  const completedLessonId = completed.has(current.id) ? null : current.id;
  completed.add(current.id);
  const idx = lessons.findIndex(l => l.id === prev.activeId);
  const next = lessons[idx + 1];
  const existingIds = new Set(prev.placedNodes.map(n => n.id));
  const added = newNodes.filter(n => !existingIds.has(n.id));
  return {
    state: {
      ...prev,
      completed,
      activeId: next ? next.id : prev.activeId,
      buildStep: 3,
      pendingPlacement: null,
      placedNodes: [...prev.placedNodes, ...added],
    },
    completedLessonId,
    addedNodeIds: added.map(n => n.id),
  };
}
