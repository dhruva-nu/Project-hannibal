import type { AnyEdge, ArchModel, FlowState } from "../engine";
import { allVars, edgeInfo, endpointById, endpointLabel, findNode as nodeOf, payloadLabel, readersOf, writersOf } from "../engine";
import type { SelectionState, TraceView } from "../state/archApi";
import { computeAnchors, curveBetween, rectEdgeToward, centerOf, type Box, type Point } from "./geometry";
import { edgeVisits } from "./traceHighlight";
import type { Visibility } from "./visibility";
import { boxOfNodeOrGhost, isVisible } from "./visibility";

export type ArrowMarker = "default" | "selected" | "warn";

export interface EdgeShape {
  id: string;
  path: string;
  warn: boolean;
  selected: boolean;
  traversed: boolean;
  dimmed: boolean;
  marker: ArrowMarker;
}

export interface EdgeOverlay {
  key: string;
  path: string;
  direction: "request" | "response";
}

export interface EdgeChip {
  key: string;
  x: number;
  y: number;
  text: string;
  kind: "flow" | "label" | "state";
  edgeId?: string;
  warn: boolean;
  dimmed: boolean;
}

export interface StateLinkShape {
  key: string;
  path: string;
}

export interface EdgeScene {
  shapes: EdgeShape[];
  overlays: EdgeOverlay[];
  chips: EdgeChip[];
  stateLinks: StateLinkShape[];
  midpoints: Record<string, Point>;
}

export interface SceneInput {
  model: ArchModel;
  flow: FlowState;
  visibility: Visibility;
  scope: Parameters<typeof isVisible>[1];
  selection: SelectionState;
  trace: TraceView | null;
  showFlow: boolean;
  showStateLinks: boolean;
}

const flowChipText = (input: SceneInput, edge: AnyEdge): string => {
  const info = edgeInfo(input.model, input.flow, edge);
  const prefix = edge.label ? `${edge.label}: ` : "";
  if (edge.derived) return `${prefix}${edge.ids.length} connection${edge.ids.length > 1 ? "s" : ""}`;
  const request = `→ ${payloadLabel(info.req)}`;
  const response = info.res !== undefined ? `  ← ${payloadLabel(info.res)}` : "";
  return `${prefix}${request}${response}`;
};

const classifyEdge = (input: SceneInput, edge: AnyEdge, visits: Record<string, "req" | "res"> | null) => {
  const warn = edgeInfo(input.model, input.flow, edge).warns.length > 0;
  const selected = input.selection.type === "edge" && input.selection.ids.includes(edge.id);
  const traversed = visits ? (edge.derived ? edge.ids.some((id) => visits[id]) : Boolean(visits[edge.id])) : false;
  const dimmed = Boolean(visits) && !traversed;
  const marker: ArrowMarker = selected || traversed ? "selected" : warn ? "warn" : "default";
  return { warn, selected, traversed, dimmed, marker };
};

const isActiveEdge = (trace: TraceView, edge: AnyEdge): boolean => {
  const active = trace.result.steps[trace.index];
  if (!active.edge) return false;
  return edge.derived ? edge.ids.includes(active.edge) : active.edge === edge.id;
};

/** A function's connection to a service is labelled with the endpoint it calls. */
const calledEndpointText = (model: ArchModel, edge: AnyEdge): string => {
  const from = nodeOf(model, edge.from);
  const to = nodeOf(model, edge.to);
  if (edge.derived || from?.type !== "function" || to?.type !== "service") return "";
  const ref = endpointById(model, from.cfg.endpoint);
  return ref?.service.id === to.id ? endpointLabel(ref.endpoint) : "";
};

const edgeChip = (input: SceneInput, edge: AnyEdge, mid: Point, dimmed: boolean, warn: boolean): EdgeChip | null => {
  if (input.showFlow) {
    const text = flowChipText(input, edge);
    return { key: edge.id, x: mid.x, y: mid.y, text: (warn ? "! " : "") + text, kind: "flow", edgeId: edge.id, warn, dimmed };
  }
  const text = edge.label || calledEndpointText(input.model, edge);
  if (!text) return null;
  return { key: edge.id, x: mid.x, y: mid.y, text, kind: "label", warn: false, dimmed };
};

/** Dotted links from whatever sets a variable to whatever reads it, labelled with the variables they share. */
const stateLinkScene = (input: SceneInput) => {
  const stateLinks: StateLinkShape[] = [];
  const chips: EdgeChip[] = [];
  const pairs: Record<string, string[]> = {};
  allVars(input.model).forEach((variable) => {
    writersOf(input.model, variable.id).forEach((writer) =>
      readersOf(input.model, variable.id).forEach((reader) => {
        const key = `${writer.id}|${reader.id}`;
        pairs[key] = [...(pairs[key] ?? []), variable.name];
      }),
    );
  });
  Object.entries(pairs).forEach(([key, names]) => {
    const [fromId, toId] = key.split("|");
    const a = nodeOf(input.model, fromId);
    const b = nodeOf(input.model, toId);
    if (!a || !b || a === b || !isVisible(a, input.scope) || !isVisible(b, input.scope)) return;
    const start = rectEdgeToward(a, centerOf(b));
    const end = rectEdgeToward(b, centerOf(a));
    stateLinks.push({ key, path: `M${start.x},${start.y} L${end.x},${end.y}` });
    chips.push({
      key: `state-${key}`,
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      text: `state: ${names.join(", ")}`,
      kind: "state",
      warn: false,
      dimmed: false,
    });
  });
  return { stateLinks, chips };
};

export const buildEdgeScene = (input: SceneInput): EdgeScene => {
  const boxOf = boxOfNodeOrGhost(input.model, input.visibility.ghosts);
  const anchors = computeAnchors(input.visibility.edges, boxOf as (id: string) => Box | undefined);
  const visits = input.trace ? edgeVisits(input.trace) : null;
  const scene: EdgeScene = { shapes: [], overlays: [], chips: [], stateLinks: [], midpoints: {} };
  input.visibility.edges.forEach((edge) => {
    const ends = anchors[edge.id];
    if (!ends?.a || !ends.b) return;
    const curve = curveBetween(ends.a, ends.b);
    const state = classifyEdge(input, edge, visits);
    scene.midpoints[edge.id] = curve.mid;
    scene.shapes.push({ id: edge.id, path: curve.path, ...state });
    if (input.trace && isActiveEdge(input.trace, edge)) {
      const active = input.trace.result.steps[input.trace.index];
      scene.overlays.push(
        active.dir === "req"
          ? { key: edge.id, path: curve.path, direction: "request" }
          : { key: edge.id, path: curveBetween(ends.b, ends.a).path, direction: "response" },
      );
    }
    const chip = edgeChip(input, edge, curve.mid, state.dimmed, state.warn);
    if (chip) scene.chips.push(chip);
  });
  if (input.showStateLinks && input.scope === "client") {
    const links = stateLinkScene(input);
    scene.stateLinks = links.stateLinks;
    scene.chips.push(...links.chips);
  }
  return scene;
};

export const edgeMidpoint = (input: Omit<SceneInput, "trace" | "showFlow" | "showStateLinks">, edgeId: string): Point =>
  buildEdgeScene({ ...input, trace: null, showFlow: false, showStateLinks: false }).midpoints[edgeId] ?? { x: 0, y: 0 };
