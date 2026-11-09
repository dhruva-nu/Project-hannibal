import { useLayoutEffect, useRef, type RefObject } from "react";
import type { ArchModel, LayerId } from "../../engine";
import { clipInsetFrom, growOrigin, windowBox, type StageSize } from "../../view/dock";
import type { Viewport } from "../../view/geometry";
import { fadeChrome, MORPH_EASING, MORPH_MS, morphNodes } from "./layerMorph";

const WINDOW_RADIUS_PX = 12;
const FULL_CLIP = `inset(0px 0px 0px 0px round ${WINDOW_RADIUS_PX}px)`;
const LIVE_VIEWPORT = "[data-live-viewport]";

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

interface GrowInputs {
  stageRef: RefObject<HTMLDivElement | null>;
  scope: LayerId | null;
  shownScope: LayerId | null;
  model: ArchModel;
  overviewView: Viewport;
  stage: StageSize;
}

const animateFrame = (win: Element, small: string, opening: boolean): Animation =>
  win.animate(
    (opening ? [small, FULL_CLIP] : [FULL_CLIP, small]).map((clipPath) => ({ clipPath })),
    { duration: MORPH_MS, easing: MORPH_EASING, fill: opening ? "none" : "forwards" },
  );

/**
 * Opening: the window frame grows out of its card (or chip) while each component flies out of its pill.
 * Collapsing: the same in reverse, so the window minimises back into the card.
 */
export const useWindowGrow = (inputs: GrowInputs) => {
  const latest = useRef(inputs);
  latest.current = inputs;
  const previousScope = useRef<LayerId | null>(null);
  const { scope, shownScope } = inputs;

  useLayoutEffect(() => {
    const previous = previousScope.current;
    previousScope.current = scope;
    const { stageRef, model, overviewView, stage } = latest.current;
    const root = stageRef.current;
    const win = root?.querySelector(LIVE_VIEWPORT);
    const target = scope ?? previous;
    if (!target || !root || !win || typeof win.animate !== "function" || prefersReducedMotion()) return;
    const origin = growOrigin(model, overviewView, stage, scope ? previous : null, target);
    if (!origin) return;
    const opening = Boolean(scope);
    const animations = [
      animateFrame(win, clipInsetFrom(origin, windowBox(stage), WINDOW_RADIUS_PX), opening),
      ...morphNodes(root, win, origin, opening),
      ...fadeChrome(win, opening),
    ];
    return () => animations.forEach((animation) => animation.cancel());
  }, [scope]);

  useLayoutEffect(() => {
    if (shownScope) return;
    const win = latest.current.stageRef.current?.querySelector(LIVE_VIEWPORT);
    if (win && typeof win.getAnimations === "function") win.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
  }, [shownScope]);
};
