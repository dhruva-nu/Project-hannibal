import { createContext, useContext } from "react";
import type {
  AnyEdge,
  ArchModel,
  FlowState,
  Group,
  InfraType,
  LayerId,
  TraceResult,
} from "../engine";

export type SelectionState =
  | { type: null; ids: readonly [] }
  | { type: "node" | "edge" | "group"; ids: readonly string[] };

export const NO_SELECTION: SelectionState = { type: null, ids: [] };

export interface TraceView {
  compId: string;
  only: string;
  warm: boolean;
  index: number;
  playing: boolean;
  result: TraceResult;
}

export interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export type ModalState =
  | { kind: "confirm"; request: ConfirmRequest }
  | { kind: "io" }
  | { kind: "detail"; nodeId: string }
  | { kind: "state" }
  | { kind: "flow"; edgeId: string }
  | { kind: "picker"; fromId: string; toId: string };

export interface Notice {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Mutates a cloned copy of the model; the result is normalized and committed. */
export type ModelMutator = (draft: ArchModel) => void;

export interface ArchApi {
  model: ArchModel;
  flow: FlowState;
  selection: SelectionState;
  /** Endpoint opened in the selected service's inspector (and highlighted on its card). */
  endpointFocus: string | null;
  scope: LayerId | null;
  trace: TraceView | null;
  /** Checkpoint for undo, clone, run the mutator, normalize, persist. Same coalesceKey within 1.5s shares one undo step. */
  commit: (mutator: ModelMutator, coalesceKey?: string) => void;
  /** Look up a stored or overview-derived edge. */
  edgeById: (id: string) => AnyEdge | undefined;
  groupById: (id: string) => Group | undefined;
  select: (selection: SelectionState) => void;
  focusEndpoint: (endpointId: string | null) => void;
  /** Open the layer holding the node (or leave the layer), select it and scroll it into view. */
  reveal: (nodeId: string) => void;
  openDetail: (nodeId: string) => void;
  openFlow: (edgeId: string) => void;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  confirm: (request: ConfirmRequest) => void;
  notify: (notice: Notice) => void;
  undo: () => void;
  // structure edits
  connect: (fromId: string, toId: string, selectNew: boolean, endpointId?: string) => void;
  insertOnEdge: (edgeId: string, type: InfraType) => void;
  flipEdge: (edgeId: string) => void;
  askDeleteEdge: (edgeId: string) => void;
  askDeleteSelection: () => void;
  groupSelected: () => void;
  ungroup: (groupId: string) => void;
  addFunctionTo: (componentId: string, trigger: string) => void;
  // tracing
  startTrace: (componentId: string) => void;
  closeTrace: () => void;
  traceGo: (index: number) => void;
  traceTogglePlay: () => void;
  traceSetWarm: (warm: boolean) => void;
  traceSetOnly: (functionId: string) => void;
}

export const ArchContext = createContext<ArchApi | null>(null);

export const useArch = (): ArchApi => {
  const api = useContext(ArchContext);
  if (!api) throw new Error("useArch must be used inside <ArchContext.Provider>");
  return api;
};
