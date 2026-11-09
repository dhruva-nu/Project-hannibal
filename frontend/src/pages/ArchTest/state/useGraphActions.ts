import type { AnyEdge, ArchModel, FnTrigger, InfraType, LayerId, PlacedType } from "../engine";
import { grp, node as nodeOf } from "../engine";
import type { Point, Viewport } from "../view/geometry";
import {
  NO_SELECTION,
  type ConfirmRequest,
  type ModelMutator,
  type Notice,
  type SelectionState,
} from "./archApi";
import {
  addEdgeToModel,
  addFunctionToComponent,
  addNodeToModel,
  flipEdgeDirection,
  groupNodes,
  hasEdge,
  insertInfraOnEdge,
  linkFunctionToEndpoint,
  removeEdges,
  removeNodes,
  ungroupNodes,
  type ViewportSize,
} from "./structure";

export interface GraphDeps {
  model: ArchModel;
  scope: LayerId | null;
  view: Viewport;
  selection: SelectionState;
  commit: (mutator: ModelMutator, coalesceKey?: string) => void;
  select: (selection: SelectionState) => void;
  notify: (notice: Notice) => void;
  confirm: (request: ConfirmRequest) => void;
  undo: () => void;
  edgeById: (id: string) => AnyEdge | undefined;
  midpointOf: (edgeId: string) => Point;
  viewportSize: () => ViewportSize;
  ensureVisible: (nodeId: string) => void;
}

export interface GraphActions {
  addNode: (type: PlacedType) => void;
  connect: (fromId: string, toId: string, selectNew: boolean, endpointId?: string) => void;
  insertOnEdge: (edgeId: string, type: InfraType) => void;
  flipEdge: (edgeId: string) => void;
  askDeleteEdge: (edgeId: string) => void;
  askDeleteSelection: () => void;
  groupSelected: () => void;
  ungroup: (groupId: string) => void;
  addFunctionTo: (componentId: string, trigger: FnTrigger) => void;
}

const pluralConnections = (count: number) => (count > 1 ? `${count} connections deleted` : "Connection deleted");

export const useGraphActions = (deps: GraphDeps): GraphActions => {
  const { model, scope, view, selection, commit, select, notify, confirm, undo, edgeById } = deps;

  const selectOnly = (type: "node" | "edge" | "group", id: string) => select({ type, ids: [id] });

  const addNode = (type: PlacedType) => {
    const created: { id?: string } = {};
    commit((draft) => {
      created.id = addNodeToModel(draft, type, scope, view, deps.viewportSize()).id;
    });
    if (!created.id) return;
    selectOnly("node", created.id);
    deps.ensureVisible(created.id);
  };

  const connect = (fromId: string, toId: string, selectNew: boolean, endpointId = "") => {
    if (fromId === toId) return;
    if (hasEdge(model, fromId, toId)) {
      if (endpointId) commit((draft) => linkFunctionToEndpoint(draft, fromId, toId, endpointId));
      else notify({ message: "Those two are already connected in that direction" });
      return;
    }
    const created: { id?: string } = {};
    commit((draft) => {
      created.id = addEdgeToModel(draft, fromId, toId, endpointId)?.id;
    });
    if (selectNew && created.id) selectOnly("edge", created.id);
  };

  const insertOnEdge = (edgeId: string, type: InfraType) => {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const middle = deps.midpointOf(edgeId);
    const created: { id?: string } = {};
    commit((draft) => {
      created.id = insertInfraOnEdge(draft, edge, type, middle, scope).id;
    });
    if (created.id) selectOnly("node", created.id);
    notify({ message: "Inserted into the connection. Drag it to reposition." });
  };

  const deleteEdge = (edgeId: string) => {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const ids = edge.derived ? edge.ids : [edgeId];
    commit((draft) => removeEdges(draft, ids));
    select(NO_SELECTION);
    notify({ message: pluralConnections(ids.length), actionLabel: "Undo", onAction: undo });
  };

  const askDeleteEdge = (edgeId: string) => {
    const edge = edgeById(edgeId);
    if (edge?.derived) {
      confirm({
        message: `Delete all ${edge.ids.length} connection(s) between these two?`,
        confirmLabel: "Delete",
        onConfirm: () => deleteEdge(edgeId),
      });
      return;
    }
    deleteEdge(edgeId);
  };

  const deleteNodes = (ids: string[]) => {
    commit((draft) => removeNodes(draft, ids));
    select(NO_SELECTION);
  };

  const askDeleteNodes = (ids: string[]) => {
    const subject = ids.length > 1 ? `${ids.length} components` : (nodeOf(model, ids[0])?.name ?? "this item");
    confirm({
      message: `Delete ${subject}? Connections to ${ids.length > 1 ? "them" : "it"} are removed too.`,
      confirmLabel: "Delete",
      onConfirm: () => deleteNodes(ids),
    });
  };

  const askDeleteGroup = (groupId: string) => {
    const group = grp(model, groupId);
    if (!group) return;
    const memberIds = model.nodes.filter((n) => n.group === groupId).map((n) => n.id);
    confirm({
      message: `Delete the group "${group.name}" and the ${memberIds.length} components inside it?`,
      confirmLabel: "Delete group and components",
      onConfirm: () => deleteNodes(memberIds),
    });
  };

  const askDeleteSelection = () => {
    if (selection.type === null || !selection.ids.length) return;
    if (selection.type === "edge") askDeleteEdge(selection.ids[0]);
    else if (selection.type === "node") askDeleteNodes([...selection.ids]);
    else askDeleteGroup(selection.ids[0]);
  };

  const groupSelected = () => {
    if (selection.type !== "node" || !selection.ids.length) {
      notify({ message: "Select components first. Shift-click or shift-drag to select several." });
      return;
    }
    const created: { id?: string } = {};
    commit((draft) => {
      created.id = groupNodes(draft, [...selection.ids]).id;
    });
    if (created.id) selectOnly("group", created.id);
  };

  return {
    addNode,
    connect,
    insertOnEdge,
    flipEdge: (edgeId) => commit((draft) => void flipEdgeDirection(draft, edgeId)),
    askDeleteEdge,
    askDeleteSelection,
    groupSelected,
    ungroup: (groupId) => {
      commit((draft) => ungroupNodes(draft, groupId));
      select(NO_SELECTION);
    },
    addFunctionTo: (componentId, trigger) => commit((draft) => void addFunctionToComponent(draft, componentId, trigger)),
  };
};
