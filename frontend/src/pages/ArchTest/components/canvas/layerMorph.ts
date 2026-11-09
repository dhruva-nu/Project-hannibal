import { collapsedBoxIn, transformBetween } from "../../view/dock";
import type { Box } from "../../view/geometry";

export const MORPH_MS = 600;
export const MORPH_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const CHROME_FADE_SHARE = 0.4;

const toBox = (rect: DOMRect): Box => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });

const pillBoxOf = (root: ParentNode, nodeId: string | null): Box | null => {
  const pill = nodeId ? root.querySelector(`[data-member-id="${nodeId}"]`) : null;
  return pill ? toBox(pill.getBoundingClientRect()) : null;
};

/**
 * Every real card flies between its pill in the layer card and its place in the window.
 * Cards without a pill (nested or newly added) grow from the middle of `layerCard`.
 */
export const morphNodes = (root: ParentNode, win: Element, layerCard: Box, opening: boolean): Animation[] => {
  const fallback = collapsedBoxIn(layerCard);
  return Array.from(win.querySelectorAll<HTMLElement>('[data-kind="node"]')).map((node) => {
    const placed = toBox(node.getBoundingClientRect());
    const zoom = node.offsetWidth ? placed.w / node.offsetWidth : 1;
    const from = (opening && pillBoxOf(root, node.getAttribute("data-id"))) || fallback;
    const small = { transform: transformBetween(from, placed, zoom), opacity: 0, transformOrigin: "0 0" };
    const full = { transform: "none", opacity: 1, transformOrigin: "0 0" };
    return node.animate(opening ? [small, full] : [full, small], {
      duration: MORPH_MS,
      easing: MORPH_EASING,
      fill: opening ? "none" : "forwards",
    });
  });
};

/** Everything around the cards (connectors, ghosts, chips, toolbar, hint) fades in late and out early. */
export const fadeChrome = (win: Element, opening: boolean): Animation[] =>
  Array.from(win.querySelectorAll<HTMLElement>(":scope > :not([data-world]), svg, [data-ghost], [data-kind]:not([data-kind=\"node\"])")).map(
    (element) =>
      element.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
        duration: MORPH_MS * CHROME_FADE_SHARE,
        delay: opening ? MORPH_MS * (1 - CHROME_FADE_SHARE) : 0,
        fill: opening ? "backwards" : "forwards",
      }),
  );
