import { useState, useEffect, useCallback, useRef } from "react";
import type { BuildStep, PendingPlacement, TestResult } from "./courseTypes";
import type { CourseContent } from "@/services/courseDetail";
import { getBuildBlock } from "@/services/courseDetail";
import { runSimple, streamExecute, type RunSimpleResult } from "@/services/rce";
import { getNodePlacement, type PlacedNode } from "@/services/nodes";
import {
  completeLesson as syncCompleteLesson,
  resetProgress as syncResetProgress,
  updateProgress as syncUpdateProgress,
} from "@/services/progress";

export interface InitialProgress {
  completedLessonIds: string[];
  activeLessonId: string | null;
  placedNodes: PlacedNode[];
}

export interface UseCourseStateOptions {
  courseId?: number;
  initialProgress?: InitialProgress | null;
}

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

const initialState = (): CourseState => ({
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

function normalise(name: string) {
  return name.trim().toLowerCase().replace(/_/g, " ");
}

function parseTestOutput(stdout: string, existing: TestResult[]): TestResult[] | null {
  const passed = new Set<string>();
  const failed = new Set<string>();

  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (t.startsWith("✓ ")) passed.add(normalise(t.slice(2).split(":")[0]));
    else if (t.startsWith("✗ ")) failed.add(normalise(t.slice(2).split(":")[0]));
  }

  if (passed.size === 0 && failed.size === 0) return null;

  return existing.map(r => {
    const key = normalise(r.name);
    if (passed.has(key)) return { ...r, pass: true };
    if (failed.has(key)) return { ...r, pass: false };
    return { ...r, pass: null };
  });
}

export function useCourseState(
  content: CourseContent,
  options: UseCourseStateOptions = {},
) {
  const { lessons } = content;
  const { courseId, initialProgress } = options;
  const [state, setState] = useState<CourseState>(initialState);

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

  const syncActive = useCallback((lessonId: string) => {
    if (courseId === undefined) return;
    syncUpdateProgress(courseId, { activeLessonId: Number(lessonId) }).catch(err => {
      console.error("sync active lesson failed:", err);
    });
  }, [courseId]);

  const syncComplete = useCallback((lessonId: string) => {
    if (courseId === undefined) return;
    syncCompleteLesson(courseId, Number(lessonId)).catch(err => {
      console.error("sync complete lesson failed:", err);
    });
  }, [courseId]);

  const syncPlacedNodes = useCallback((nodeIds: string[]) => {
    if (courseId === undefined || nodeIds.length === 0) return;
    syncUpdateProgress(courseId, { placedNodeIds: nodeIds }).catch(err => {
      console.error("sync placed nodes failed:", err);
    });
  }, [courseId]);

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
  }, []);

  const openLesson = useCallback((id: string) => {
    let didOpen = false;
    setState(prev => {
      const lesson = lessons.find(l => l.id === id);
      if (!lesson) return prev;
      const idx = lessons.indexOf(lesson);
      if (!isUnlocked(idx, prev.completed) && !prev.completed.has(id)) return prev;
      didOpen = true;
      const newState: CourseState = { ...prev, activeId: id, buildStep: 0, pendingPlacement: null };
      if (prev.completed.has(id)) {
        if (lesson.kind === "theory") newState.theoryOpen = true;
        if (lesson.kind === "build") newState.buildStep = 2;
      } else {
        if (lesson.kind === "theory") newState.theoryOpen = true;
        if (lesson.kind === "build") {
          newState.buildStep = 2;
          if (lesson.target?.type === "service" && lesson.drag) {
            newState.pendingPlacement = { kind: "module", id: lesson.drag.id, parent: lesson.drag.parent };
          } else if (lesson.drag?.kind === "node") {
            newState.pendingPlacement = { kind: "node", id: lesson.drag.id };
          }
        }
      }
      return newState;
    });
    if (didOpen) syncActive(id);
  }, [lessons, isUnlocked, syncActive]);

  const markTheoryDone = useCallback(() => {
    let completedLessonId: string | null = null;
    setState(prev => {
      const lesson = lessons.find(l => l.id === prev.activeId);
      if (!lesson) return prev;
      const completed = new Set(prev.completed);
      const wasNew = !completed.has(lesson.id);
      completed.add(lesson.id);
      let activeId = prev.activeId;
      if (wasNew) {
        completedLessonId = lesson.id;
        const idx = lessons.findIndex(l => l.id === prev.activeId);
        const next = lessons[idx + 1];
        if (next) activeId = next.id;
      }
      return { ...prev, completed, activeId, buildStep: 0, pendingPlacement: null, theoryOpen: false };
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

  const runTests = useCallback(async (lessonId: string, code: string, language: string) => {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return;

    setState(prev => ({ ...prev, streamOutput: [], isStreaming: true, runError: null }));

    let rceResult: RunSimpleResult | null = null;
    await Promise.allSettled([
      streamExecute(code, language, (event) => {
        if (event.event_type === "stdout" || event.event_type === "stderr") {
          setState(prev => ({ ...prev, streamOutput: [...prev.streamOutput, event.line] }));
        }
        if (event.event_type === "error") {
          setState(prev => ({ ...prev, streamOutput: [...prev.streamOutput, `error: ${event.message}`] }));
        }
      }),
      runSimple(code, language, lesson.nosqlId)
        .then(r => { rceResult = r; })
        .catch(err => console.error("run-simple failed:", err)),
    ]);

    const result = rceResult as RunSimpleResult | null;
    const allPass = result?.exit_code === 0;

    const runError: string | null = (() => {
      if (allPass || !result) return null;
      const err = result.stderr.trim();
      return err || null;
    })();

    setState(prev => {
      const existing = prev.testResults[lessonId] ?? [];
      let results: TestResult[];

      if (lesson.code) {
        results = allPass
          ? lesson.code.tests.map(t => ({ name: t.name, pass: true }))
          : lesson.code.tests.map(t => {
              const pass = (() => { try { return !!t.check(code); } catch { return false; } })();
              return { name: t.name, pass };
            });
      } else if (existing.length > 0) {
        const parsed = rceResult ? parseTestOutput(rceResult.stdout, existing) : null;
        results = parsed ?? existing.map(t => ({ ...t, pass: allPass ? true : null }));
      } else {
        results = [{ name: "code runs without error", pass: allPass }];
      }

      return { ...prev, isStreaming: false, runError, testResults: { ...prev.testResults, [lessonId]: results } };
    });
  }, [lessons]);

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
    } catch {
      // placement is best-effort; lesson still gets marked complete
    }

    let completedLessonId: string | null = null;
    let addedNodeIds: string[] = [];
    setState(prev => {
      const current = lessons.find(l => l.id === prev.activeId);
      if (!current) return prev;
      const completed = new Set(prev.completed);
      if (!completed.has(current.id)) completedLessonId = current.id;
      completed.add(current.id);
      const idx = lessons.findIndex(l => l.id === prev.activeId);
      const next = lessons[idx + 1];
      const existingIds = new Set(prev.placedNodes.map(n => n.id));
      const added = newNodes.filter(n => !existingIds.has(n.id));
      addedNodeIds = added.map(n => n.id);
      const merged = [...prev.placedNodes, ...added];
      return { ...prev, completed, activeId: next ? next.id : prev.activeId, buildStep: 3, pendingPlacement: null, placedNodes: merged };
    });
    if (completedLessonId) syncComplete(completedLessonId);
    syncPlacedNodes(addedNodeIds);
  }, [lessons, state.activeId, syncComplete, syncPlacedNodes]);

  const resetAll = useCallback(() => {
    setState(initialState());
    if (courseId !== undefined) {
      syncResetProgress(courseId).catch(err => {
        console.error("sync reset failed:", err);
      });
    }
  }, [courseId]);

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
    resetAll,
    getRevealed: () => getRevealed(state),
  };
}
