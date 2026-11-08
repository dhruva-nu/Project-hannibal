import type { ArchNode, FlowState, ArchModel } from "../../engine";
import { REG } from "../../engine";
import type { TraceView } from "../../state/archApi";
import type { TraceMark } from "../../view/traceHighlight";
import { NodeBody } from "./NodeBody";
import { PortHandles } from "./PortHandles";
import styles from "./canvas.module.css";

const categoryOf = (node: ArchNode): string => (node.type === "layer" ? node.lid : REG[node.type].cat);

const kindLabel = (node: ArchNode): string => {
  if (node.type === "layer") return "open";
  if (node.type === "function") return node.cfg.trigger;
  if (node.type === "api") return node.cfg.method;
  return REG[node.type].label;
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
}

export const NodeCard = ({ node, model, flow, trace, mark, selected, showFlow, hasMismatch }: NodeCardProps) => (
  <div
    className={styles.node}
    data-id={node.id}
    data-kind="node"
    data-type={node.type}
    data-cat={categoryOf(node)}
    data-selected={selected}
    data-trace={mark}
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
      <span className={styles.nodeKind}>{kindLabel(node)}</span>
    </div>
    <div className={styles.nodeBody}>
      <NodeBody node={node} model={model} flow={flow} trace={trace} showFlow={showFlow} />
    </div>
    <PortHandles />
  </div>
);
