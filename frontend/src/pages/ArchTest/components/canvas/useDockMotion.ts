import { useLayoutEffect, useRef, useState } from "react";
import type { LayerId } from "../../engine";

const MOVE_MS = 660;

/**
 * `docked` flips on one frame after a layer opens so the cards animate from their overview spot into their chips.
 * `moving` hides the connectors while cards travel, so arrows never lead or trail their boxes.
 */
export const useDockMotion = (scope: LayerId | null): { docked: boolean; moving: boolean } => {
  const [docked, setDocked] = useState(false);
  const [moving, setMoving] = useState(false);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    const returning = !scope && wasOpen.current;
    wasOpen.current = Boolean(scope);
    if (!scope) setDocked(false);
    setMoving(Boolean(scope) || returning);
    if (!scope && !returning) return;
    const frames: number[] = [];
    if (scope) frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(() => setDocked(true)))));
    const timer = setTimeout(() => setMoving(false), MOVE_MS);
    return () => {
      frames.forEach(cancelAnimationFrame);
      clearTimeout(timer);
    };
  }, [scope]);
  return { docked, moving };
};
