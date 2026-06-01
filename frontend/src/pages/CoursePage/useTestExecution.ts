import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Lesson } from "@/services/courseDetail";
import type { TestResult } from "@/shared/types/course";
import { getBuildBlock } from "@/services/courseDetail";
import { runSimple, streamExecute, type RunSimpleResult } from "@/services/rce";
import { type CourseState, parseTestOutput } from "./courseState.utils";

type SetState = Dispatch<SetStateAction<CourseState>>;

function deriveTestResults(
  lesson: Lesson,
  code: string,
  rceResult: RunSimpleResult | null,
  existing: TestResult[],
  allPass: boolean,
): TestResult[] {
  if (lesson.code) {
    return allPass
      ? lesson.code.tests.map(t => ({ name: t.name, pass: true }))
      : lesson.code.tests.map(t => {
          let pass = false;
          try { pass = !!t.check(code); } catch { pass = false; }
          return { name: t.name, pass };
        });
  }
  if (existing.length > 0) {
    const parsed = rceResult ? parseTestOutput(rceResult.stdout, existing) : null;
    return parsed ?? existing.map(t => ({ ...t, pass: allPass ? true : null }));
  }
  return [{ name: "code runs without error", pass: allPass }];
}

export function useTestExecution(lessons: Lesson[], setState: SetState) {
  const initBuildTests = useCallback(async (lessonId: string, nosqlId: string) => {
    const block = await getBuildBlock(nosqlId);
    setState(prev => {
      const blockObjIds = { ...prev.blockObjIds, [lessonId]: block.objId };
      if (!block.tests.length || prev.testResults[lessonId]?.length) {
        return { ...prev, blockObjIds };
      }
      const initial: TestResult[] = block.tests.map(t => ({ name: t.name, description: t.description, pass: null }));
      return { ...prev, blockObjIds, testResults: { ...prev.testResults, [lessonId]: initial } };
    });
  }, [setState]);

  const runTests = useCallback(async (lessonId: string, code: string, language: string) => {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return;

    setState(prev => ({ ...prev, streamOutput: [], isStreaming: true, runError: null }));

    let rceResult: RunSimpleResult | null = null;
    await Promise.allSettled([
      streamExecute(code, language, (event) => {
        if (event.event_type === "stdout" || event.event_type === "stderr") {
          setState(prev => ({ ...prev, streamOutput: [...prev.streamOutput, event.line] }));
        } else if (event.event_type === "error") {
          setState(prev => ({ ...prev, streamOutput: [...prev.streamOutput, `error: ${event.message}`] }));
        }
      }),
      runSimple(code, language, lesson.nosqlId)
        .then(r => { rceResult = r; })
        .catch(err => console.error("run-simple failed:", err)),
    ]);

    const result = rceResult as RunSimpleResult | null;
    const allPass = result?.exit_code === 0;
    const runError = !allPass && result ? (result.stderr.trim() || null) : null;

    setState(prev => {
      const existing = prev.testResults[lessonId] ?? [];
      const results = deriveTestResults(lesson, code, rceResult, existing, allPass);
      return { ...prev, isStreaming: false, runError, testResults: { ...prev.testResults, [lessonId]: results } };
    });
  }, [lessons, setState]);

  return { initBuildTests, runTests };
}
