import { cleanup, render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, vi, type Mock } from "vitest";
import { node as findModelNode, starter, type ArchModel, type ArchNode, type DerivedEdge } from "../../engine";
import { NO_SELECTION, type SelectionState } from "../../state/archApi";
import { ArchHarness } from "./ArchHarness";
import { InspectorPanel } from "./Panel";

afterEach(cleanup);

type StubName =
  | "reveal"
  | "openDetail"
  | "openFlow"
  | "openModal"
  | "closeModal"
  | "confirm"
  | "notify"
  | "undo"
  | "connect"
  | "insertOnEdge"
  | "flipEdge"
  | "askDeleteEdge"
  | "askDeleteSelection"
  | "groupSelected"
  | "ungroup"
  | "addFunctionTo"
  | "startTrace"
  | "closeTrace"
  | "traceGo"
  | "traceTogglePlay"
  | "traceSetWarm"
  | "traceSetOnly";

export type ApiStubs = Record<StubName, Mock>;

const STUB_NAMES: StubName[] = [
  "reveal",
  "openDetail",
  "openFlow",
  "openModal",
  "closeModal",
  "confirm",
  "notify",
  "undo",
  "connect",
  "insertOnEdge",
  "flipEdge",
  "askDeleteEdge",
  "askDeleteSelection",
  "groupSelected",
  "ungroup",
  "addFunctionTo",
  "startTrace",
  "closeTrace",
  "traceGo",
  "traceTogglePlay",
  "traceSetWarm",
  "traceSetOnly",
];

const createStubs = (): ApiStubs => Object.fromEntries(STUB_NAMES.map((name) => [name, vi.fn()])) as ApiStubs;

export interface PanelRender extends RenderResult {
  stubs: ApiStubs;
  model: () => ArchModel;
  selection: () => SelectionState;
  nodeNamed: (name: string) => ArchNode;
}

interface RenderOptions {
  model?: ArchModel;
  selection?: SelectionState;
  derivedEdges?: DerivedEdge[];
}

export const renderWithArch = (ui: ReactNode, options: RenderOptions = {}): PanelRender => {
  const stubs = createStubs();
  const initial = options.model ?? starter();
  let latestModel = initial;
  let latestSelection = options.selection ?? NO_SELECTION;
  const result = render(
    <ArchHarness
      initialModel={initial}
      initialSelection={latestSelection}
      derivedEdges={options.derivedEdges ?? []}
      stubs={stubs}
      onModel={(m) => {
        latestModel = m;
      }}
      onSelection={(s) => {
        latestSelection = s;
      }}
    >
      {ui}
    </ArchHarness>,
  );
  const model = () => latestModel;
  return {
    ...result,
    stubs,
    model,
    selection: () => latestSelection,
    nodeNamed: (name) => {
      const found = latestModel.nodes.find((n) => n.name === name);
      if (!found) throw new Error(`No node named ${name} in the starter model`);
      return found;
    },
  };
};

export const nodeIn = (model: ArchModel, id: string): ArchNode => {
  const found = findModelNode(model, id);
  if (!found) throw new Error(`No node ${id}`);
  return found;
};

export const idOf = (model: ArchModel, name: string): string => {
  const found = model.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`No node named ${name}`);
  return found.id;
};

export const renderSelectedNode = (name: string, model: ArchModel = starter()): PanelRender =>
  renderWithArch(<InspectorPanel />, { model, selection: { type: "node", ids: [idOf(model, name)] } });
