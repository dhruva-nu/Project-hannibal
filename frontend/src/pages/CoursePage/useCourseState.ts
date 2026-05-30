import { useState, useCallback } from "react";
import type { BuildStep, PendingPlacement, TestResult } from "./courseTypes";
import type { CourseContent } from "@/services/courseDetail";
import { getBuildBlock } from "@/services/courseDetail";
import { runSimple, streamExecute, type RunSimpleResult } from "@/services/rce";

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

    const allPass = rceResult?.exit_code === 0 ?? false;

    const runError: string | null = (() => {
      if (allPass || !rceResult) return null;
      const err = rceResult.stderr.trim();
      return err || null;
    })();

    setState(prev => {
      const existing = prev.testResults[lessonId] ?? [];
      let results: TestResult[];

      if (lesson.code) {
        results = allPass
          ? lesson.code.tests.map(t => ({ name: t.name, pass: true }))
          : lesson.code.tests.map(t => {
              let pass = false;
              try { pass = !!t.check(code); } catch { pass = false; }
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
