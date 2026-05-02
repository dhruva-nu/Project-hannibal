export type BuildStep = 0 | 1 | 2 | 3;

export interface PendingPlacement { kind: "node" | "module"; id: string; parent?: string; }
export interface TestResult { name: string; pass: boolean | null; }
