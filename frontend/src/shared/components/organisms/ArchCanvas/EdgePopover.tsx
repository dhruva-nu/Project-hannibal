import { useArch } from "@/pages/ArchTest/state/archApi";
import { ToolButton } from "@/shared/components/atoms";
import type { Point } from "@/pages/ArchTest/view/geometry";
import styles from "./canvas.module.css";

interface EdgePopoverProps {
  edgeId: string;
  anchor: Point;
  onOpenInsertMenu: (anchor: HTMLElement) => void;
}

export const EdgePopover = ({ edgeId, anchor, onOpenInsertMenu }: EdgePopoverProps) => {
  const api = useArch();
  const edge = api.edgeById(edgeId);
  if (!edge) return null;
  return (
    <div className={styles.popover} data-popover="true" style={{ left: anchor.x, top: anchor.y - 12 }}>
      <ToolButton small onClick={(e) => onOpenInsertMenu(e.currentTarget)}>
        Insert infrastructure &#9662;
      </ToolButton>
      <ToolButton small onClick={() => api.openFlow(edgeId)}>
        {edge.derived ? "Connections" : "Payload"}
      </ToolButton>
      {!edge.derived && (
        <ToolButton small onClick={() => api.flipEdge(edgeId)}>
          Flip
        </ToolButton>
      )}
      <ToolButton small danger onClick={() => api.askDeleteEdge(edgeId)}>
        Delete
      </ToolButton>
    </div>
  );
};
