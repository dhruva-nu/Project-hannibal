import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Lesson } from "@/services/courseDetail";
import type { CourseState } from "./courseState.utils";

type SetState = Dispatch<SetStateAction<CourseState>>;

export function useLessonNavigation(lessons: Lesson[], setState: SetState) {
  const isUnlocked = useCallback((idx: number, completed: Set<string>): boolean => {
    if (idx === 0) return true;
    return completed.has(lessons[idx - 1].id);
  }, [lessons]);

  const getRevealed = useCallback((st: CourseState) => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    const mods = new Set<string>();
    lessons.forEach(l => {
      if (!st.completed.has(l.id)) return;
      (l.adds.nodes || []).forEach(n => nodes.add(n));
      (l.adds.edges || []).forEach(e => edges.add(e));
      (l.adds.modules || []).forEach(m => mods.add(m));
      if (l.addsExtra) (l.addsExtra.nodes || []).forEach(n => nodes.add(n));
    });
    if (st.pendingPlacement) {
      const p = st.pendingPlacement;
      if (p.kind === "node") nodes.add(p.id);
      if (p.kind === "module" && p.parent) mods.add(`${p.parent}:${p.id}`);
    }
    return { nodes, edges, mods };
  }, [lessons]);

  const closeOverlays = useCallback(() => {
    setState(prev => ({ ...prev, buildStep: 0, pendingPlacement: null, theoryOpen: false }));
  }, [setState]);

  const openLesson = useCallback((id: string) => {
    setState(prev => {
      const lesson = lessons.find(l => l.id === id);
      if (!lesson) return prev;
      const idx = lessons.indexOf(lesson);
      if (!isUnlocked(idx, prev.completed) && !prev.completed.has(id)) return prev;
      const newState: CourseState = { ...prev, activeId: id, buildStep: 0, pendingPlacement: null };
      if (lesson.kind === "theory") newState.theoryOpen = true;
      if (lesson.kind === "build") {
        newState.buildStep = 2;
        if (!prev.completed.has(id)) {
          if (lesson.target?.type === "service" && lesson.drag) {
            newState.pendingPlacement = { kind: "module", id: lesson.drag.id, parent: lesson.drag.parent };
          } else if (lesson.drag?.kind === "node") {
            newState.pendingPlacement = { kind: "node", id: lesson.drag.id };
          }
        }
      }
      return newState;
    });
  }, [lessons, isUnlocked, setState]);

  const markTheoryDone = useCallback(() => {
    setState(prev => {
      const lesson = lessons.find(l => l.id === prev.activeId);
      if (!lesson) return prev;
      const completed = new Set(prev.completed);
      const wasNew = !completed.has(lesson.id);
      completed.add(lesson.id);
      let activeId = prev.activeId;
      if (wasNew) {
        const idx = lessons.findIndex(l => l.id === prev.activeId);
        const next = lessons[idx + 1];
        if (next) activeId = next.id;
      }
      return { ...prev, completed, activeId, buildStep: 0, pendingPlacement: null, theoryOpen: false };
    });
  }, [lessons, setState]);

  return { isUnlocked, getRevealed, closeOverlays, openLesson, markTheoryDone };
}
