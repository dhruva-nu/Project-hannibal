import type { Lesson, CourseNodeDef } from "@/services/courseDetail";
import type { useCourseState } from "@/pages/CoursePage/useCourseState";
import type { BoardNodeData } from "@/pages/DesignBoard/boardTypes";
import { BoardNode } from "@/shared/components/molecules/BoardNode/BoardNode";
import { ServiceBlock } from "@/shared/components/molecules/ServiceBlock/ServiceBlock";
import styles from "./CourseBoard.module.css";

type CourseHook = ReturnType<typeof useCourseState>;

interface CanvasNodesProps {
  revealedNodes: Set<string>;
  revealedMods: Set<string>;
  nodeDefs: Record<string, CourseNodeDef>;
  buildStep: number;
  pendingPlacement: CourseHook["state"]["pendingPlacement"];
  activeLesson: Lesson | null;
  placedNodes: Record<string, BoardNodeData>;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
}

const noopSelect = () => {};
const noopPort = () => {};
const noopAddModule = () => {};

export function CanvasNodes({
  revealedNodes,
  revealedMods,
  nodeDefs,
  pendingPlacement,
  placedNodes,
  onMoveNode,
}: CanvasNodesProps) {
  return (
    <>
      {Object.entries(nodeDefs).map(([id, n]) => {
        if (revealedNodes.has(id)) return null;
        return (
          <div
            key={`ghost-${id}`}
            className={[styles.ghost, n.kind === "service" ? styles.serviceGhost : ""].join(" ")}
            style={{ left: `${n.x}%`, top: `${n.y}%`, minWidth: n.kind !== "service" ? "70px" : undefined }}
          >?</div>
        );
      })}
      {Object.entries(nodeDefs).map(([id, n]) => {
        if (!revealedNodes.has(id)) return null;
        if (n.kind === "node") {
          return (
            <div key={id} className={[styles.node, styles.nodeShown].join(" ")}
              style={{ left: `${n.x}%`, top: `${n.y}%` }} data-nodeid={id}>
              {n.label}
            </div>
          );
        }
        return (
          <div key={id}
            className={[styles.service, styles.serviceShown].join(" ")}
            style={{ left: `${n.x}%`, top: `${n.y}%` }} data-nodeid={id}>
            <div className={styles.serviceModules}>
              {(n.modules ?? []).map(m => {
                const key = `${id}:${m.id}`;
                if (!revealedMods.has(key)) return null;
                const isPending = pendingPlacement?.kind === "module" && pendingPlacement.id === m.id && pendingPlacement.parent === id;
                return (
                  <div key={m.id}
                    className={[styles.module, styles.moduleShown, isPending ? styles.modulePending : ""].join(" ")}
                    data-modid={key}>{m.label}</div>
                );
              })}
            </div>
            <div className={styles.serviceLabel}>{n.label}</div>
          </div>
        );
      })}
      {Object.values(placedNodes).map(node => (
        node.type === "component" ? (
          <BoardNode
            key={`placed-${node.id}`}
            node={node}
            selected={false}
            onSelect={noopSelect}
            onMove={onMoveNode}
            onPortPointerDown={noopPort}
            onPortPointerUp={noopPort}
          />
        ) : (
          <ServiceBlock
            key={`placed-${node.id}`}
            service={node}
            selected={false}
            onSelect={noopSelect}
            onMove={onMoveNode}
            onPortPointerDown={noopPort}
            onPortPointerUp={noopPort}
            onAddModule={noopAddModule}
          />
        )
      ))}
    </>
  );
}
