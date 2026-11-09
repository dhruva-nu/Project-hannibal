import { useEffect, useMemo, useState, type ReactNode } from "react";
import { clone, normalize, simulate, type AnyEdge, type ArchModel, type DerivedEdge } from "../engine";
import { ArchContext, type ArchApi, type SelectionState } from "../state/archApi";
import type { ApiStubs } from "./panelHarness";

interface HarnessProps {
  initialModel: ArchModel;
  initialSelection: SelectionState;
  derivedEdges: DerivedEdge[];
  stubs: ApiStubs;
  onModel: (model: ArchModel) => void;
  onSelection: (selection: SelectionState) => void;
  children: ReactNode;
}

export const ArchHarness = ({ initialModel, initialSelection, derivedEdges, stubs, onModel, onSelection, children }: HarnessProps) => {
  const [model, setModel] = useState(initialModel);
  const [selection, setSelection] = useState(initialSelection);
  const [endpointFocus, setEndpointFocus] = useState<string | null>(null);
  const flow = useMemo(() => simulate(model), [model]);

  useEffect(() => onModel(model), [model, onModel]);
  useEffect(() => onSelection(selection), [selection, onSelection]);

  const api: ArchApi = {
    ...stubs,
    model,
    flow,
    selection,
    endpointFocus,
    focusEndpoint: setEndpointFocus,
    scope: null,
    trace: null,
    commit: (mutator) => {
      const draft = clone(model);
      mutator(draft);
      normalize(draft);
      setModel(draft);
    },
    edgeById: (id): AnyEdge | undefined =>
      model.edges.find((e) => e.id === id) ?? derivedEdges.find((e) => e.id === id),
    groupById: (id) => model.groups.find((g) => g.id === id),
    select: setSelection,
  };
  return <ArchContext.Provider value={api}>{children}</ArchContext.Provider>;
};
