import { cleanup, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, vi, type Mock } from "vitest";
import {
  starter,
  type ArchModel,
  type ArchNode,
  type DerivedEdge,
  type Endpoint,
  type ServiceNode,
} from "../engine";
import { NO_SELECTION, type SelectionState } from "../state/archApi";
import { ArchHarness } from "./ArchHarness";
import { ArchInspector } from "@/shared/components/organisms/ArchInspector/ArchInspector";
import type { Editor } from "@/shared/components/organisms/ArchInspector/panelEditor";

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

export const idOf = (model: ArchModel, name: string): string => {
  const found = model.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`No node named ${name}`);
  return found.id;
};

export const renderSelectedNode = (name: string, model: ArchModel = starter()): PanelRender =>
  renderWithArch(<ArchInspector />, { model, selection: { type: "node", ids: [idOf(model, name)] } });

export const USER_SERVICE = "User service";

export const changeField = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

export const userServiceOf = (view: PanelRender): ServiceNode => view.nodeNamed(USER_SERVICE) as ServiceNode;

export const endpointOf = (view: PanelRender, endpointId: string): Endpoint => {
  const found = userServiceOf(view).cfg.endpoints.find((e) => e.id === endpointId);
  if (!found) throw new Error(`No endpoint ${endpointId} on ${USER_SERVICE}`);
  return found;
};

export const serviceIn = (model: ArchModel): ServiceNode => {
  const found = model.nodes.find((n): n is ServiceNode => n.type === "service");
  if (!found) throw new Error("No service in the model");
  return found;
};

type EditMutation<T> = (target: T, draft: ArchModel) => void;

/** An editor that records each mutation instead of committing it, so a test can replay it on a stale draft. */
export const recordingEditor = () => {
  const edit = vi.fn();
  const editor: Editor = { set: vi.fn(), push: vi.fn(), remove: vi.fn(), edit };
  const lastMutation = <T,>() => edit.mock.calls.at(-1)![0] as EditMutation<T>;
  return { editor, lastMutation };
};
