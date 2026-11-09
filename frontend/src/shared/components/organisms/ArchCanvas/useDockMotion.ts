import { useLayoutEffect, useState } from "react";
import type { LayerId } from "@/pages/ArchTest/engine";

const MOVE_MS = 660;

/**
 * `docked` flips on one frame after a layer opens so the cards animate from their overview spot into their chips.
 * `moving` hides the connectors while cards travel, so arrows never lead or trail their boxes.
 */
export const useDockMotion = (scope: LayerId | null): { docked: boolean; moving: boolean } => {
  const [settledScope, setSettledScope] = useState<LayerId | null>(null);
  const [docked, setDocked] = useState(false);
  const [moving, setMoving] = useState(false);

  if (scope !== settledScope) {
    setSettledScope(scope);
    setMoving(true);
    if (!scope) setDocked(false);
  }

  useLayoutEffect(() => {
    if (!moving) return;
    const frames: number[] = [];
    if (scope) frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(() => setDocked(true)))));
    const timer = setTimeout(() => setMoving(false), MOVE_MS);
    return () => {
      frames.forEach(cancelAnimationFrame);
      clearTimeout(timer);
    };
  }, [scope, moving]);

  return { docked, moving };
};
