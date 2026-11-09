import type { FnTrigger, StateVar } from "./types";

export interface SchemaWarning {
  path: string;
  kind: "missing" | "type";
  exp: string;
  act?: string;
}

export interface PayloadDiff {
  k: string;
  t: "add" | "chg" | "rem";
  from?: unknown;
  to?: unknown;
}

export interface StateWrite {
  varId: string;
  value: unknown;
  by: string;
  stepI?: number;
}

export interface StepMeta {
  notes: string[];
  pre?: unknown;
  sql?: string;
  cache?: "HIT" | "MISS";
  status?: number;
  rows?: number;
  endpoint?: string;
  writes?: StateWrite[];
}

export interface TraceStep {
  i: number;
  dir: "req" | "res";
  node: string;
  edge: string | null;
  payload: unknown;
  title: string;
  warns: SchemaWarning[];
  meta: StepMeta;
}

export interface FunctionOrderEntry {
  id: string;
  name: string;
  trigger: FnTrigger;
}

export interface TraceResult {
  steps: TraceStep[];
  fnOrder: FunctionOrderEntry[];
  writes: StateWrite[];
}

export interface TraceOptions {
  sim?: boolean;
  warm?: boolean;
  only?: string;
}

export interface TraceSession {
  cacheStore: Record<string, unknown>;
  roundRobin: Record<string, number>;
}

export interface EdgeFlow {
  warns: SchemaWarning[];
  req?: unknown;
  src?: unknown;
  res?: unknown;
}

export interface NodeFlow {
  in?: unknown;
  out?: unknown;
}

export interface FlowState {
  edges: Record<string, EdgeFlow>;
  nodes: Record<string, NodeFlow>;
  nodeWarn: Record<string, SchemaWarning[]>;
}

export interface EdgeInfo {
  warns: SchemaWarning[];
  src?: unknown;
  req?: unknown;
  res?: unknown;
  sim: boolean;
  count?: number;
}

export interface StateVarRef extends StateVar {
  /** Component that owns the variable, or null for the app-wide store. */
  owner: string | null;
}
