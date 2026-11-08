import { useMemo } from "react";
import type { ArchModel, FlowState, LayerId } from "../../engine";
import type { SelectionState, TraceView } from "../../state/archApi";
import { buildEdgeScene, type EdgeScene } from "../../view/edgeScene";
import { computeVisibility, type Visibility } from "../../view/visibility";

interface WorldDataInput {
  model: ArchModel;
  flow: FlowState;
  scope: LayerId | null;
  selection: SelectionState;
  trace: TraceView | null;
  showFlow: boolean;
  showStateLinks: boolean;
}

export const useWorldData = (input: WorldDataInput): { visibility: Visibility; scene: EdgeScene } => {
  const { model, flow, scope, selection, trace, showFlow, showStateLinks } = input;
  const visibility = useMemo(() => computeVisibility(model, scope), [model, scope]);
  const scene = useMemo(
    () => buildEdgeScene({ model, flow, visibility, scope, selection, trace, showFlow, showStateLinks }),
    [model, flow, visibility, scope, selection, trace, showFlow, showStateLinks],
  );
  return { visibility, scene };
};
