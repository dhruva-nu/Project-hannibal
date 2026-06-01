import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Lesson } from "@/services/courseDetail";
import type { BoardNodeData } from "@/shared/types/board";
import { getBuildBlock } from "@/services/courseDetail";
import { getNodePlacement } from "@/services/nodes";
import { applyPlacementNodes, extractEdges, mergeEdges } from "./placement";
import type { CourseState } from "./courseState.utils";

type SetState = Dispatch<SetStateAction<CourseState>>;

export function useBoardPlacement(state: CourseState, lessons: Lesson[], setState: SetState) {
  const advancePlacement = useCallback((placedNodes?: Record<string, BoardNodeData>) => {
    setState(prev => {
      const lesson = lessons.find(l => l.id === prev.activeId);
      if (!lesson) return prev;
      const completed = new Set(prev.completed);
      completed.add(lesson.id);
      const idx = lessons.findIndex(l => l.id === prev.activeId);
      const next = lessons[idx + 1];
      return {
        ...prev,
        completed,
        activeId: next ? next.id : prev.activeId,
        buildStep: 3,
        pendingPlacement: null,
        placedNodes: placedNodes ?? prev.placedNodes,
      };
    });
  }, [lessons, setState]);

  const resolveObjId = useCallback(async (activeId: string, lesson: Lesson): Promise<string | null> => {
    const cached = state.blockObjIds[activeId];
    if (activeId in state.blockObjIds) return cached;
    try {
      const block = await getBuildBlock(lesson.nosqlId);
      setState(prev => ({ ...prev, blockObjIds: { ...prev.blockObjIds, [activeId]: block.objId } }));
      return block.objId;
    } catch (err) {
      console.error("place-on-board: failed to fetch build block", err);
      return null;
    }
  }, [state.blockObjIds, setState]);

  const placeOnBoard = useCallback(async () => {
    const activeId = state.activeId;
    if (!activeId) return;
    const lesson = lessons.find(l => l.id === activeId);
    if (!lesson) return;

    const objId = await resolveObjId(activeId, lesson);
    if (!objId) { advancePlacement(); return; }

    try {
      const placement = await getNodePlacement(objId);
      setState(prev => ({
        ...prev,
        placedNodes: applyPlacementNodes(prev.placedNodes, placement.nodes),
        placedEdges: mergeEdges(prev.placedEdges, extractEdges(placement.nodes)),
      }));
    } catch (err) {
      console.error("place-on-board: failed to fetch node placement", err);
    }
    advancePlacement();
  }, [state.activeId, lessons, resolveObjId, advancePlacement, setState]);

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    setState(prev => {
      const node = prev.placedNodes[nodeId];
      if (!node) return prev;
      return { ...prev, placedNodes: { ...prev.placedNodes, [nodeId]: { ...node, x, y } } };
    });
  }, [setState]);

  return { placeOnBoard, moveNode };
}
