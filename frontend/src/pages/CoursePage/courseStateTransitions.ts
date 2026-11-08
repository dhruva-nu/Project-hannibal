import type { Lesson } from "@/services/courseDetail";
import { isLessonUnlocked } from "./courseProgress";

export interface CourseState {
  completed: Set<string>;
  activeId: string | null;
  theoryOpen: boolean;
}

export const initialState = (): CourseState => ({
  completed: new Set(),
  activeId: null,
  theoryOpen: false,
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
  return { state: { ...prev, activeId: id, theoryOpen: true }, didOpen: true };
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
    state: { ...prev, completed, activeId, theoryOpen: false },
    completedLessonId: wasNew ? lesson.id : null,
  };
}
