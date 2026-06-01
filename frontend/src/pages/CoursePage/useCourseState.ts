import { useState, useCallback } from "react";
import type { CourseContent } from "@/services/courseDetail";
import { initialState, type CourseState } from "./courseState.utils";
import { useLessonNavigation } from "./useLessonNavigation";
import { useTestExecution } from "./useTestExecution";
import { useBoardPlacement } from "./useBoardPlacement";

export type { CourseState };

export function useCourseState(content: CourseContent) {
  const { lessons } = content;
  const [state, setState] = useState<CourseState>(initialState);

  const { isUnlocked, getRevealed, closeOverlays, openLesson, markTheoryDone } =
    useLessonNavigation(lessons, setState);
  const { initBuildTests, runTests } = useTestExecution(lessons, setState);
  const { placeOnBoard, moveNode } = useBoardPlacement(state, lessons, setState);

  const updateCode = useCallback((lessonId: string, code: string) => {
    setState(prev => ({ ...prev, codeBufs: { ...prev.codeBufs, [lessonId]: code } }));
  }, []);

  const resetCode = useCallback((lessonId: string) => {
    setState(prev => {
      const codeBufs = { ...prev.codeBufs };
      const testResults = { ...prev.testResults };
      delete codeBufs[lessonId];
      delete testResults[lessonId];
      return { ...prev, codeBufs, testResults };
    });
  }, []);

  const resetAll = useCallback(() => { setState(initialState()); }, []);

  return {
    state,
    content,
    isUnlocked: (idx: number) => isUnlocked(idx, state.completed),
    openLesson,
    markTheoryDone,
    closeOverlays,
    initBuildTests,
    runTests,
    updateCode,
    resetCode,
    placeOnBoard,
    moveNode,
    resetAll,
    getRevealed: () => getRevealed(state),
  };
}
