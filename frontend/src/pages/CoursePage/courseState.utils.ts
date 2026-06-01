import type { BuildStep, PendingPlacement, TestResult } from "@/shared/types/course";
import type { BoardNodeData, PlacedEdge } from "@/shared/types/board";

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
  placedNodes: Record<string, BoardNodeData>;
  placedEdges: PlacedEdge[];
  blockObjIds: Record<string, string | null>;
}

export const initialState = (): CourseState => ({
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
  placedNodes: {},
  placedEdges: [],
  blockObjIds: {},
});

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
