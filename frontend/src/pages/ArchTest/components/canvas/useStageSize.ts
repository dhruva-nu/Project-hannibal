import { useLayoutEffect, useState, type RefObject } from "react";
import type { StageSize } from "../../view/dock";

const EMPTY: StageSize = { width: 0, height: 0 };

export const useStageSize = (stageRef: RefObject<HTMLDivElement | null>): StageSize => {
  const [size, setSize] = useState<StageSize>(EMPTY);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      setSize((current) =>
        current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef]);
  return size;
};
