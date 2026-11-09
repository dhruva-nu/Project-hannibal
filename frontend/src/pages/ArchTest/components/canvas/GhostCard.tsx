import type { ArchNode } from "../../engine";
import { LAYERS } from "../../engine";
import type { TraceMark } from "../../view/traceHighlight";
import type { GhostBox } from "../../view/visibility";
import styles from "./canvas.module.css";

interface GhostCardProps {
  node: ArchNode;
  box: GhostBox;
  mark: TraceMark;
}

const layerLabel = (node: ArchNode): string =>
  (LAYERS.find((l) => l.id === node.layer)?.label ?? "Infrastructure").replace(" layer", "");

export const GhostCard = ({ node, box, mark }: GhostCardProps) => (
  <div
    className={styles.ghost}
    data-ghost={node.id}
    data-trace={mark}
    style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
  >
    <span className={styles.nodeName}>
      {box.up ? "↑ " : "↓ "}
      {node.name}
    </span>
    <span className={styles.ghostLayer}>{layerLabel(node)}</span>
  </div>
);
