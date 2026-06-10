import type { Lesson } from "@/services/courseDetail";
import type { RunSimpleResult } from "@/services/rce";
import type { PendingPlacement, TestResult } from "./courseTypes";

function normalise(name: string) {
  return name.trim().toLowerCase().replace(/_/g, " ");
}

export function parseTestOutput(stdout: string, existing: TestResult[]): TestResult[] | null {
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

export function buildTestResults(
  lesson: Lesson,
  existing: TestResult[],
  code: string,
  result: RunSimpleResult | null,
): TestResult[] {
  const allPass = result?.exit_code === 0;

  if (lesson.code) {
    if (allPass) return lesson.code.tests.map(t => ({ name: t.name, pass: true }));
    return lesson.code.tests.map(t => {
      const pass = (() => { try { return !!t.check(code); } catch { return false; } })();
      return { name: t.name, pass };
    });
  }

  if (existing.length > 0) {
    const parsed = result ? parseTestOutput(result.stdout, existing) : null;
    return parsed ?? existing.map(t => ({ ...t, pass: allPass ? true : null }));
  }

  return [{ name: "code runs without error", pass: allPass }];
}

export function extractRunError(result: RunSimpleResult | null): string | null {
  if (!result || result.exit_code === 0) return null;
  return result.stderr.trim() || null;
}

export function isLessonUnlocked(lessons: Lesson[], idx: number, completed: Set<string>): boolean {
  if (idx === 0) return true;
  return completed.has(lessons[idx - 1].id);
}

export interface RevealedBoard {
  nodes: Set<string>;
  edges: Set<string>;
  mods: Set<string>;
}

export function computeRevealed(
  lessons: Lesson[],
  completed: Set<string>,
  pendingPlacement: PendingPlacement | null,
): RevealedBoard {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const mods = new Set<string>();
  lessons.forEach(l => {
    if (!completed.has(l.id)) return;
    (l.adds.nodes || []).forEach(n => nodes.add(n));
    (l.adds.edges || []).forEach(e => edges.add(e));
    (l.adds.modules || []).forEach(m => mods.add(m));
    if (l.addsExtra) (l.addsExtra.nodes || []).forEach(n => nodes.add(n));
  });
  if (pendingPlacement) {
    if (pendingPlacement.kind === "node") nodes.add(pendingPlacement.id);
    if (pendingPlacement.kind === "module" && pendingPlacement.parent) {
      mods.add(`${pendingPlacement.parent}:${pendingPlacement.id}`);
    }
  }
  return { nodes, edges, mods };
}
