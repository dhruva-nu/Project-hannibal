import { useState, useCallback } from "react";
import type { BuildStep, PendingPlacement, TestResult } from "./courseTypes";
import type { CourseContent } from "@/services/courseDetail";
import { getBuildBlock } from "@/services/courseDetail";
import { runSimple } from "@/services/rce";

export interface CourseState {
  completed: Set<string>;
  activeId: string | null;
  buildStep: BuildStep;
  codeBufs: Record<string, string>;
  testResults: Record<string, TestResult[]>;
  pendingPlacement: PendingPlacement | null;
  theoryOpen: boolean;
}

const initialState = (): CourseState => ({
  completed: new Set(),
  activeId: null,
  buildStep: 0,
  codeBufs: {},
  testResults: {},
  pendingPlacement: null,
  theoryOpen: false,
});

export function useCourseState(content: CourseContent) {
  const { lessons } = content;
  const [state, setState] = useState<CourseState>(initialState);

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
    setState(prev => {
      const lesson = lessons.find(l => l.id === id);
      if (!lesson) return prev;
      const idx = lessons.indexOf(lesson);
      if (!isUnlocked(idx, prev.completed) && !prev.completed.has(id)) return prev;
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
  }, [lessons, isUnlocked]);

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
  }, [lessons]);

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
    let allPass = false;
    try {
      const rceResult = await runSimple(code, language, lesson.nosqlId);
      allPass = rceResult.exit_code === 0;
    } catch (err) {
      console.error("run-simple failed:", err);
    }
    setState(prev => {
      const existing = prev.testResults[lessonId] ?? [];
      const results: TestResult[] = lesson.code
        ? allPass
          ? lesson.code.tests.map(t => ({ name: t.name, pass: true }))
          : lesson.code.tests.map(t => {
              let pass = false;
              try { pass = !!t.check(code); } catch { pass = false; }
              return { name: t.name, pass };
            })
        : existing.length > 0
          ? existing.map(t => ({ ...t, pass: allPass }))
          : [{ name: "code runs without error", pass: allPass }];
      return { ...prev, testResults: { ...prev.testResults, [lessonId]: results } };
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

  const placeOnBoard = useCallback(() => {
    setState(prev => {
      const lesson = lessons.find(l => l.id === prev.activeId);
      if (!lesson) return prev;
      const completed = new Set(prev.completed);
      completed.add(lesson.id);
      const idx = lessons.findIndex(l => l.id === prev.activeId);
      const next = lessons[idx + 1];
      return { ...prev, completed, activeId: next ? next.id : prev.activeId, buildStep: 3, pendingPlacement: null };
    });
  }, [lessons]);

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
    resetAll,
    getRevealed: () => getRevealed(state),
  };
}
