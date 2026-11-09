import type { ArchNode, FlowState, ArchModel } from "@/pages/ArchTest/engine";
import { NODE_REGISTRY } from "@/pages/ArchTest/engine";
import type { TraceView } from "@/pages/ArchTest/state/archApi";
import type { TraceMark } from "@/pages/ArchTest/view/traceHighlight";
import { FlowIo, NodeBody } from "./NodeBody";
import { PortHandles } from "./PortHandles";
import styles from "./canvas.module.css";

const categoryOf = (node: ArchNode): string => (node.type === "layer" ? node.lid : NODE_REGISTRY[node.type].cat);

const kindLabel = (node: ArchNode): string => {
  if (node.type === "function") return node.cfg.trigger;
  if (node.type === "service") return node.cfg.framework;
  return NODE_REGISTRY[node.type].label;
};

interface NodeCardProps {
  node: ArchNode;
  model: ArchModel;
  flow: FlowState;
  trace: TraceView | null;
  mark: TraceMark;
  selected: boolean;
  showFlow: boolean;
  hasMismatch: boolean;
  activeEndpoint: string | null;
  docked?: boolean;
}

export const NodeCard = ({ node, model, flow, trace, mark, selected, showFlow, hasMismatch, activeEndpoint, docked = false }: NodeCardProps) => (
  <div
    className={styles.node}
    data-id={node.id}
    data-kind="node"
    data-type={node.type}
    data-cat={categoryOf(node)}
    data-selected={selected}
    data-trace={mark}
    data-docked={docked}
    style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
  >
    <div className={styles.nodeHead}>
      <i className={styles.dot} />
      <span className={styles.nodeName}>{node.name}</span>
      {hasMismatch && (
        <span className={styles.warnMark} title="Response does not match what this component expects">
          !
        </span>
      )}
      {node.type !== "layer" && <span className={styles.nodeKind}>{kindLabel(node)}</span>}
    </div>
    <div className={styles.nodeBody}>
      <NodeBody node={node} model={model} trace={trace} activeEndpoint={activeEndpoint} />
    </div>
    {showFlow && <FlowIo flow={flow} nodeId={node.id} />}
    <PortHandles />
  </div>
);
