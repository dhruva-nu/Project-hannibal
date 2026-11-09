import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArchModel, FnTrigger, LayerId, TraceStep } from "../engine";
import { blank, FN_TRIGGERS, node as nodeOf, simulate, starter } from "../engine";
import { buildEdgeScene } from "../view/edgeScene";
import { fitView } from "../view/geometry";
import { computeVisibility, visibleNodes } from "../view/visibility";
import {
  NO_SELECTION,
  type ArchApi,
  type ModalState,
  type Notice,
  type SelectionState,
} from "./archApi";
import { sanitizeSelection } from "./sanitizeSelection";
import { useGraphActions } from "./useGraphActions";
import { readStorage, useModelStore } from "./useModelStore";
import { useScopeView, viewportSizeFor, type StageSize } from "./useScopeView";
import { useTraceState } from "./useTraceState";

const NOTICE_DURATION_MS = 4500;

const toTrigger = (value: string): FnTrigger => {
  const trigger = FN_TRIGGERS.find((t) => t === value);
  if (!trigger) throw new Error(`Unknown function trigger: ${value}`);
  return trigger;
};

export interface Controller {
  api: ArchApi;
  modal: ModalState | null;
  notice: Notice | null;
  dismissNotice: () => void;
  showFlow: boolean;
  showStateLinks: boolean;
  showStore: boolean;
  toggleFlow: () => void;
  toggleStateLinks: () => void;
  toggleStore: () => void;
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showFlow, setShowFlow] = useState(false);
  const [showStateLinks, setShowStateLinks] = useState(false);
  const [showStore, setShowStore] = useState(true);
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

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reveal = (nodeId: string) => {
    const target = nodeOf(model, nodeId);
    if (!target) return;
    if (target.layer && scope !== target.layer) view.openScope(target.layer);
    else if (!target.layer && scope) view.closeScope();
    setRawSelection({ type: "node", ids: [nodeId] });
    view.ensureVisible(nodeId, target.layer);
  };

  const followTraceStep = (step: TraceStep) => {
    const target = nodeOf(model, step.node);
    if (!target) return;
    const layer: LayerId | null = target.layer;
    if (scope && layer !== scope) {
      if (layer) view.openScope(layer);
      else view.closeScope();
    }
    view.ensureVisible(step.node, layer);
  };
  const trace = useTraceState(model, followTraceStep);

  const midpointOf = (edgeId: string) =>
    buildEdgeScene({
      model,
      flow,
      visibility,
      scope,
      selection,
      trace: null,
      showFlow: false,
      showStateLinks: false,
    }).midpoints[edgeId] ?? { x: 0, y: 0 };

  const viewportSize = () => viewportSizeFor(scope, getStageSize());

  const graph = useGraphActions({
    model,
    scope,
    view: view.view,
    selection,
    commit,
    select: setRawSelection,
    notify: setNotice,
    confirm: (request) => setModal({ kind: "confirm", request }),
    undo: store.undo,
    edgeById,
    midpointOf,
    viewportSize,
    ensureVisible: (id) => view.ensureVisible(id),
  });

  const resetDiagramState = (next: ArchModel) => {
    store.setViews(() => ({
      overview: fitView(visibleNodes(next, null), getStageSize().width, getStageSize().height),
    }));
    view.closeScope();
    trace.close();
    setRawSelection(NO_SELECTION);
  };

  const loadDiagram = (next: ArchModel) => {
    store.replaceModel(next);
    resetDiagramState(next);
  };

  const confirmReplace = (message: string, confirmLabel: string, build: () => ArchModel) =>
    setModal({
      kind: "confirm",
      request: { message, confirmLabel, onConfirm: () => loadDiagram(build()) },
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
    notify: setNotice,
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
    dismissNotice: () => setNotice(null),
    showFlow,
    showStateLinks,
    showStore,
    toggleFlow: () => setShowFlow((on) => !on),
    toggleStateLinks: () => setShowStateLinks((on) => !on),
    toggleStore: () => setShowStore((on) => !on),
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
