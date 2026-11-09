import { useCallback, useMemo, useState } from "react";
import type { ArchModel, FnTrigger, LayerId, TraceStep } from "../engine";
import { blank, FN_TRIGGERS, findNode as nodeOf, simulate, starter } from "../engine";
import { edgeMidpoint } from "../view/edgeScene";
import { computeVisibility } from "../view/visibility";
import {
  NO_SELECTION,
  type ArchApi,
  type ModalState,
  type Notice,
  type SelectionState,
} from "./archApi";
import { sanitizeSelection } from "./sanitizeSelection";
import { useDiagramLoader } from "./useDiagramLoader";
import { useDisplayToggles } from "./useDisplayToggles";
import { useGraphActions } from "./useGraphActions";
import { useNotice } from "./useNotice";
import { readStorage, useModelStore } from "./useModelStore";
import { useScopeView, viewportSizeFor, type StageSize } from "./useScopeView";
import { useTraceState } from "./useTraceState";

const toTrigger = (value: string): FnTrigger => {
  const trigger = FN_TRIGGERS.find((t) => t === value);
  if (!trigger) throw new Error(`Unknown function trigger: ${value}`);
  return trigger;
};

export interface Controller extends ReturnType<typeof useDisplayToggles> {
  api: ArchApi;
  modal: ModalState | null;
  notice: Notice | null;
  dismissNotice: () => void;
  canUndo: boolean;
  canRedo: boolean;
  redo: () => void;
  setName: (name: string) => void;
  view: ReturnType<typeof useScopeView>;
  addNode: ReturnType<typeof useGraphActions>["addNode"];
  loadExample: () => void;
  newBlank: () => void;
  loadDiagram: (parsed: ArchModel) => void;
  closeOrDeselect: () => void;
}

export const useArchController = (getStageSize: () => StageSize): Controller => {
  const [storage] = useState(readStorage);
  const store = useModelStore(storage);
  const { model, commit } = store;
  const [rawSelection, setRawSelection] = useState<SelectionState>(NO_SELECTION);
  const [modal, setModal] = useState<ModalState | null>(null);
  const { notice, notify, dismissNotice } = useNotice();
  const toggles = useDisplayToggles();
  const [endpointFocus, setEndpointFocus] = useState<string | null>(null);

  const clearSelection = useCallback(() => setRawSelection(NO_SELECTION), []);
  const view = useScopeView({
    model,
    views: store.views,
    setViews: store.setViews,
    getStageSize,
    onScopeChange: clearSelection,
  });
  const { scope } = view;

  const flow = useMemo(() => simulate(model), [model]);
  const visibility = useMemo(() => computeVisibility(model, scope), [model, scope]);
  const edgeById = useCallback(
    (id: string) => visibility.derivedById[id] ?? model.edges.find((e) => e.id === id),
    [visibility, model],
  );
  const selection = useMemo(
    () => sanitizeSelection(rawSelection, model, (id) => Boolean(edgeById(id))),
    [rawSelection, model, edgeById],
  );

  const moveToLayer = (layer: LayerId | null) => (layer ? view.openScope(layer) : view.closeScope());

  const reveal = (nodeId: string) => {
    const target = nodeOf(model, nodeId);
    if (!target) return;
    if (target.layer !== scope) moveToLayer(target.layer);
    setRawSelection({ type: "node", ids: [nodeId] });
    view.ensureVisible(nodeId, target.layer);
  };

  const followTraceStep = (step: TraceStep) => {
    const target = nodeOf(model, step.node);
    if (!target) throw new Error(`Trace step ${step.i} points at node "${step.node}", which is not in the diagram`);
    if (scope && target.layer !== scope) moveToLayer(target.layer);
    view.ensureVisible(step.node, target.layer);
  };
  const trace = useTraceState(model, followTraceStep);

  const midpointOf = (edgeId: string) => edgeMidpoint({ model, flow, visibility, scope, selection }, edgeId);

  const viewportSize = () => viewportSizeFor(scope, getStageSize());

  const graph = useGraphActions({
    model,
    scope,
    view: view.view,
    selection,
    commit,
    select: setRawSelection,
    notify,
    confirm: (request) => setModal({ kind: "confirm", request }),
    undo: store.undo,
    edgeById,
    midpointOf,
    viewportSize,
    ensureVisible: (id) => view.ensureVisible(id),
  });

  const { loadDiagram, confirmReplace } = useDiagramLoader({
    store,
    getStageSize,
    onReset: () => {
      view.closeScope();
      trace.close();
      setRawSelection(NO_SELECTION);
    },
    confirm: (request) => setModal({ kind: "confirm", request }),
  });

  const api: ArchApi = {
    model,
    flow,
    selection,
    endpointFocus,
    scope,
    trace: trace.trace,
    commit,
    edgeById,
    groupById: (id) => model.groups.find((g) => g.id === id),
    select: setRawSelection,
    focusEndpoint: setEndpointFocus,
    reveal,
    openDetail: (nodeId) => setModal({ kind: "detail", nodeId }),
    openFlow: (edgeId) => setModal({ kind: "flow", edgeId }),
    openModal: setModal,
    closeModal: () => setModal(null),
    confirm: (request) => setModal({ kind: "confirm", request }),
    notify,
    undo: store.undo,
    connect: graph.connect,
    insertOnEdge: graph.insertOnEdge,
    flipEdge: graph.flipEdge,
    askDeleteEdge: graph.askDeleteEdge,
    askDeleteSelection: graph.askDeleteSelection,
    groupSelected: graph.groupSelected,
    ungroup: graph.ungroup,
    addFunctionTo: (componentId, trigger) => graph.addFunctionTo(componentId, toTrigger(trigger)),
    startTrace: (componentId) => {
      setModal(null);
      trace.start(componentId);
      view.ensureVisible(componentId);
    },
    closeTrace: trace.close,
    traceGo: trace.goTo,
    traceTogglePlay: trace.togglePlay,
    traceSetWarm: trace.setWarm,
    traceSetOnly: trace.setOnly,
  };

  return {
    api,
    modal,
    notice,
    dismissNotice,
    ...toggles,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    redo: store.redo,
    setName: store.setName,
    view,
    addNode: graph.addNode,
    loadExample: () =>
      confirmReplace("Replace the current diagram with the user profile example? You can undo this.", "Load example", starter),
    newBlank: () => confirmReplace("Start a new blank diagram? You can undo this.", "Start blank", blank),
    loadDiagram,
    closeOrDeselect: () => {
      if (modal) setModal(null);
      else if (selection.type) setRawSelection(NO_SELECTION);
      else if (scope) view.closeScope();
    },
  };
};
