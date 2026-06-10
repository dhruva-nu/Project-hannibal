import { useCallback } from "react";
import {
  completeLesson as syncCompleteLesson,
  resetProgress as syncResetProgress,
  updateProgress as syncUpdateProgress,
} from "@/services/progress";

export function useProgressSync(courseId?: number) {
  const syncActive = useCallback((lessonId: string) => {
    if (courseId === undefined) return;
    syncUpdateProgress(courseId, { activeLessonId: Number(lessonId) }).catch((err: unknown) => {
      console.error("sync active lesson failed:", err);
    });
  }, [courseId]);

  const syncComplete = useCallback((lessonId: string) => {
    if (courseId === undefined) return;
    syncCompleteLesson(courseId, Number(lessonId)).catch((err: unknown) => {
      console.error("sync complete lesson failed:", err);
    });
  }, [courseId]);

  const syncPlacedNodes = useCallback((nodeIds: string[]) => {
    if (courseId === undefined || nodeIds.length === 0) return;
    syncUpdateProgress(courseId, { placedNodeIds: nodeIds }).catch((err: unknown) => {
      console.error("sync placed nodes failed:", err);
    });
  }, [courseId]);

  const syncReset = useCallback(() => {
    if (courseId === undefined) return;
    syncResetProgress(courseId).catch((err: unknown) => {
      console.error("sync reset failed:", err);
    });
  }, [courseId]);

  return { syncActive, syncComplete, syncPlacedNodes, syncReset };
}
