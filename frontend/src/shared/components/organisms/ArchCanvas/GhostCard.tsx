import type { ArchNode } from "@/pages/ArchTest/engine";
import { LAYERS } from "@/pages/ArchTest/engine";
import type { TraceMark } from "@/pages/ArchTest/view/traceHighlight";
import type { GhostBox } from "@/pages/ArchTest/view/visibility";
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
