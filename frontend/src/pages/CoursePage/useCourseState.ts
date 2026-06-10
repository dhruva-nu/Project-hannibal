import { useState, useEffect, useCallback, useRef } from "react";
import type { CourseContent } from "@/services/courseDetail";
import { getBuildBlock } from "@/services/courseDetail";
import { runSimple, streamExecute, type RCEEvent, type RunSimpleResult } from "@/services/rce";
import { getNodePlacement, type PlacedNode } from "@/services/nodes";
import { buildTestResults, computeRevealed, extractRunError, isLessonUnlocked } from "./courseProgress";
import {
  applyMarkTheoryDone,
  applyOpenLesson,
  applyPlaceOnBoard,
  initialState,
  type CourseState,
} from "./courseStateTransitions";
import { useProgressSync } from "./useProgressSync";

export type { CourseState };

export interface InitialProgress {
  completedLessonIds: string[];
  activeLessonId: string | null;
  placedNodes: PlacedNode[];
}

export interface UseCourseStateOptions {
  courseId?: number;
  initialProgress?: InitialProgress | null;
}

export function useCourseState(
  content: CourseContent,
  options: UseCourseStateOptions = {},
) {
  const { lessons } = content;
  const { courseId, initialProgress } = options;
  const [state, setState] = useState<CourseState>(initialState);
  const { syncActive, syncComplete, syncPlacedNodes, syncReset } = useProgressSync(courseId);

  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !initialProgress) return;
    hydratedRef.current = true;
    setState(prev => ({
      ...prev,
      completed: new Set(initialProgress.completedLessonIds),
      activeId: initialProgress.activeLessonId ?? prev.activeId,
      placedNodes: initialProgress.placedNodes,
    }));
  }, [initialProgress]);

  const streamAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => streamAbortRef.current?.abort(), []);

  const closeOverlays = useCallback(() => {
    setState(prev => ({ ...prev, buildStep: 0, pendingPlacement: null, theoryOpen: false }));
  }, []);

  const openLesson = useCallback((id: string) => {
    let didOpen = false;
    setState(prev => {
      const result = applyOpenLesson(prev, lessons, id);
      didOpen = result.didOpen;
      return result.state;
    });
    if (didOpen) syncActive(id);
  }, [lessons, syncActive]);

  const markTheoryDone = useCallback(() => {
    let completedLessonId: string | null = null;
    setState(prev => {
      const result = applyMarkTheoryDone(prev, lessons);
      completedLessonId = result.completedLessonId;
      return result.state;
    });
    if (completedLessonId) syncComplete(completedLessonId);
  }, [lessons, syncComplete]);

  const initBuildTests = useCallback(async (lessonId: string, nosqlId: string) => {
    const block = await getBuildBlock(nosqlId);
    if (!block.tests.length) return;
    setState(prev => {
      if (prev.testResults[lessonId]?.length) return prev;
      const initial = block.tests.map(t => ({ name: t.name, description: t.description, pass: null as null }));
      return { ...prev, testResults: { ...prev.testResults, [lessonId]: initial } };
    });
  }, []);

  const appendStreamLine = useCallback((event: RCEEvent) => {
    if (event.event_type === "stdout" || event.event_type === "stderr") {
      setState(prev => ({ ...prev, streamOutput: [...prev.streamOutput, event.line] }));
    }
    if (event.event_type === "error") {
      setState(prev => ({ ...prev, streamOutput: [...prev.streamOutput, `error: ${event.message}`] }));
    }
  }, []);

  const runTests = useCallback(async (lessonId: string, code: string, language: string) => {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return;

    streamAbortRef.current?.abort();
    const abort = new AbortController();
    streamAbortRef.current = abort;

    setState(prev => ({ ...prev, streamOutput: [], isStreaming: true, runError: null }));

    let rceResult: RunSimpleResult | null = null;
    await Promise.allSettled([
      streamExecute(code, language, appendStreamLine, abort.signal),
      runSimple(code, language, lesson.nosqlId)
        .then(r => { rceResult = r; })
        .catch((err: unknown) => console.error("run-simple failed:", err)),
    ]);
    if (abort.signal.aborted) return;

    const result = rceResult as RunSimpleResult | null;
    setState(prev => ({
      ...prev,
      isStreaming: false,
      runError: extractRunError(result),
      testResults: {
        ...prev.testResults,
        [lessonId]: buildTestResults(lesson, prev.testResults[lessonId] ?? [], code, result),
      },
    }));
  }, [lessons, appendStreamLine]);

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

  const placeOnBoard = useCallback(async () => {
    const lesson = lessons.find(l => l.id === state.activeId);
    if (!lesson) return;

    let newNodes: PlacedNode[] = [];
    try {
      const block = await getBuildBlock(lesson.nosqlId);
      if (block.obj_id) {
        newNodes = await getNodePlacement(block.obj_id);
      }
    } catch (err) {
      console.error("node placement lookup failed (lesson still completes):", err);
    }

    let completedLessonId: string | null = null;
    let addedNodeIds: string[] = [];
    setState(prev => {
      const result = applyPlaceOnBoard(prev, lessons, newNodes);
      completedLessonId = result.completedLessonId;
      addedNodeIds = result.addedNodeIds;
      return result.state;
    });
    if (completedLessonId) syncComplete(completedLessonId);
    syncPlacedNodes(addedNodeIds);
  }, [lessons, state.activeId, syncComplete, syncPlacedNodes]);

  const resetAll = useCallback(() => {
    setState(initialState());
    syncReset();
  }, [syncReset]);

  return {
    state,
    content,
    isUnlocked: (idx: number) => isLessonUnlocked(lessons, idx, state.completed),
    openLesson,
    markTheoryDone,
    closeOverlays,
    initBuildTests,
    runTests,
    updateCode,
    resetCode,
    placeOnBoard,
    resetAll,
    getRevealed: () => computeRevealed(lessons, state.completed, state.pendingPlacement),
  };
}
