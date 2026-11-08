import type { ArchNode } from "../../engine";
import { REG } from "../../engine";
import type { TraceMark } from "../../view/traceHighlight";
import { PortHandles } from "./PortHandles";
import styles from "./canvas.module.css";

interface ContainerBoxProps {
  node: ArchNode;
  selected: boolean;
  mark: TraceMark;
}

export const ContainerBox = ({ node, selected, mark }: ContainerBoxProps) => (
  <div
    className={styles.container}
    data-id={node.id}
    data-kind="container"
    data-selected={selected}
    data-trace={mark}
    style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
  >
    <div className={styles.containerHead}>
      <i className={styles.containerDot} />
      <span className={styles.nodeName}>{node.name}</span>
      <span className={styles.nodeKind}>{REG[node.type].label}</span>
    </div>
    <PortHandles />
  </div>
);
