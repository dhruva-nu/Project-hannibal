import type { ArchModel, FlowState, LayerId } from "../../engine";
import { node as nodeOf } from "../../engine";
import type { SelectionState, TraceView } from "../../state/archApi";
import type { EdgeScene } from "../../view/edgeScene";
import { groupBoxes } from "../../view/groupBoxes";
import type { Point, Viewport } from "../../view/geometry";
import { traceMark } from "../../view/traceHighlight";
import { visibleCards, visibleContainers, type Visibility } from "../../view/visibility";
import { ContainerBox } from "./ContainerBox";
import { EdgeChips } from "./EdgeChips";
import { EdgeLayer } from "./EdgeLayer";
import { GhostCard } from "./GhostCard";
import { NodeCard } from "./NodeCard";
import styles from "./canvas.module.css";

export interface WorldProps {
  model: ArchModel;
  endpointFocus: string | null;
  flow: FlowState;
  visibility: Visibility;
  scene: EdgeScene;
  scope: LayerId | null;
  selection: SelectionState;
  trace: TraceView | null;
  showFlow: boolean;
  view: Viewport;
  preview: { from: Point; to: Point } | null;
  idPrefix: string;
  docked?: ReadonlySet<string>;
  onOpenFlow: (edgeId: string) => void;
}

const isSelected = (selection: SelectionState, type: "node" | "group", id: string) =>
  selection.type === type && selection.ids.includes(id);

const activeEndpointOf = (props: WorldProps, nodeId: string): string | null => {
  const step = props.trace?.result.steps[props.trace.index];
  if (step) return step.node === nodeId ? (step.meta.endpoint ?? null) : null;
  return isSelected(props.selection, "node", nodeId) ? props.endpointFocus : null;
};

const byAreaDescending = <T extends { w: number; h: number }>(a: T, b: T) => b.w * b.h - a.w * a.h;

export const World = (props: WorldProps) => {
  const { model, flow, visibility, scene, scope, selection, trace, showFlow, view } = props;
  const containers = [...visibleContainers(model, scope)].sort(byAreaDescending);
  return (
    <div className={styles.world} data-world="true" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})` }}>
      <div className={styles.layerGroup}>
        {containers.map((node) => (
          <ContainerBox
            key={node.id}
            node={node}
            selected={isSelected(selection, "node", node.id)}
            mark={traceMark(model, trace, node.id)}
          />
        ))}
        {groupBoxes(model, scope).map((box) => (
          <div
            key={box.id}
            className={styles.group}
            data-selected={isSelected(selection, "group", box.id)}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          >
            <span className={styles.groupHead} data-group-head={box.id}>
              {box.name}
            </span>
          </div>
        ))}
      </div>
      <EdgeLayer scene={scene} idPrefix={props.idPrefix} preview={props.preview} />
      <div className={styles.layerGroup}>
        {visibleCards(model, scope).map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            model={model}
            flow={flow}
            trace={trace}
            mark={traceMark(model, trace, node.id)}
            selected={isSelected(selection, "node", node.id)}
            showFlow={showFlow}
            hasMismatch={Boolean(flow.nodeWarn[node.id])}
            activeEndpoint={activeEndpointOf(props, node.id)}
            docked={props.docked?.has(node.id) ?? false}
          />
        ))}
        {Object.entries(visibility.ghosts).map(([id, box]) => {
          const target = nodeOf(model, id);
          return target ? <GhostCard key={id} node={target} box={box} mark={traceMark(model, trace, id)} /> : null;
        })}
      </div>
      <div className={styles.layerGroup}>
        <EdgeChips chips={scene.chips} onOpenFlow={props.onOpenFlow} />
      </div>
    </div>
  );
};
