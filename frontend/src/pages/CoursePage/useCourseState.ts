import { useState, useEffect, useCallback, useRef } from "react";
import type { CourseContent } from "@/services/courseDetail";
import { computeRevealed, isLessonUnlocked } from "./courseProgress";
import {
  applyMarkTheoryDone,
  applyOpenLesson,
  initialState,
  type CourseState,
} from "./courseStateTransitions";
import { useProgressSync } from "./useProgressSync";

export type { CourseState };

export interface InitialProgress {
  completedLessonIds: string[];
  activeLessonId: string | null;
}

export interface UseCourseStateOptions {
  courseId?: number;
  initialProgress?: InitialProgress | null;
  unlockAll?: boolean;
}

export function useCourseState(
  content: CourseContent,
  options: UseCourseStateOptions = {},
) {
  const { lessons } = content;
  const { courseId, initialProgress, unlockAll = false } = options;
  const [state, setState] = useState<CourseState>(initialState);
  const { syncActive, syncComplete, syncReset } = useProgressSync(courseId);

  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !initialProgress) return;
    hydratedRef.current = true;
    setState(prev => ({
      ...prev,
      completed: new Set(initialProgress.completedLessonIds),
      activeId: initialProgress.activeLessonId ?? prev.activeId,
    }));
  }, [initialProgress]);

  const closeOverlays = useCallback(() => {
    setState(prev => ({ ...prev, theoryOpen: false }));
  }, []);

  const openLesson = useCallback((id: string) => {
    let didOpen = false;
    setState(prev => {
      const result = applyOpenLesson(prev, lessons, id, unlockAll);
      didOpen = result.didOpen;
      return result.state;
    });
    if (didOpen) syncActive(id);
  }, [lessons, syncActive, unlockAll]);

  const markTheoryDone = useCallback(() => {
    let completedLessonId: string | null = null;
    setState(prev => {
      const result = applyMarkTheoryDone(prev, lessons);
      completedLessonId = result.completedLessonId;
      return result.state;
    });
    if (completedLessonId) syncComplete(completedLessonId);
  }, [lessons, syncComplete]);

  const resetAll = useCallback(() => {
    setState(initialState());
    syncReset();
  }, [syncReset]);

  return {
    state,
    content,
    isUnlocked: (idx: number) => unlockAll || isLessonUnlocked(lessons, idx, state.completed),
    openLesson,
    markTheoryDone,
    closeOverlays,
    resetAll,
    getRevealed: () => computeRevealed(lessons, state.completed),
  };
}
