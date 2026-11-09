import type { ArchModel, ArchNode, LayerId } from "../engine";
import { isContainer } from "../engine";
import { clamp, toScreen, toWorld, type Box, type Viewport } from "./geometry";

export interface StageSize {
  width: number;
  height: number;
}

export const WINDOW_INSET = { x: 24, y: 80 };
export const CHIP_SIZE = { w: 190, h: 44, margin: 14, gap: 12 };

export const windowBox = (stage: StageSize): Box => ({
  x: WINDOW_INSET.x,
  y: WINDOW_INSET.y,
  w: stage.width - WINDOW_INSET.x * 2,
  h: stage.height - WINDOW_INSET.y * 2,
});

const layerNodeId = (layer: LayerId) => `L_${layer}`;

const isDockable = (node: ArchNode): boolean => !isContainer(node) && (node.type === "layer" || !node.layer);

const screenBoxOf = (view: Viewport, node: Box): Box => {
  const origin = toScreen(view, node);
  return { x: origin.x, y: origin.y, w: node.w * view.k, h: node.h * view.k };
};

const packRow = (boxes: Array<{ id: string; x: number }>, stageWidth: number): Record<string, number> => {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const placed: Array<{ id: string; x: number }> = [];
  sorted.forEach((box) => {
    const previous = placed[placed.length - 1];
    const minX = previous ? previous.x + CHIP_SIZE.w + CHIP_SIZE.gap : CHIP_SIZE.margin;
    placed.push({ id: box.id, x: Math.max(box.x, minX) });
  });
  const last = placed[placed.length - 1];
  const overflow = last ? last.x + CHIP_SIZE.w + CHIP_SIZE.margin - stageWidth : 0;
  const shift = Math.max(0, overflow);
  return Object.fromEntries(placed.map((box) => [box.id, Math.max(CHIP_SIZE.margin, box.x - shift)]));
};

/** Screen-space chip boxes for every overview card except the open layer. Cards above the middle dock on top, the rest below. */
export const dockedScreenBoxes = (
  model: ArchModel,
  overviewView: Viewport,
  stage: StageSize,
  scope: LayerId,
): Record<string, Box> => {
  const cards = [...model.lnodes, ...model.nodes].filter((n) => isDockable(n) && n.id !== layerNodeId(scope));
  const top: Array<{ id: string; x: number }> = [];
  const bottom: Array<{ id: string; x: number }> = [];
  cards.forEach((card) => {
    const box = screenBoxOf(overviewView, card);
    const x = clamp(box.x, CHIP_SIZE.margin, Math.max(CHIP_SIZE.margin, stage.width - CHIP_SIZE.w - CHIP_SIZE.margin));
    (box.y + box.h / 2 < stage.height / 2 ? top : bottom).push({ id: card.id, x });
  });
  const topX = packRow(top, stage.width);
  const bottomX = packRow(bottom, stage.width);
  const bottomY = stage.height - CHIP_SIZE.margin - CHIP_SIZE.h;
  return {
    ...Object.fromEntries(top.map(({ id }) => [id, { x: topX[id], y: CHIP_SIZE.margin, w: CHIP_SIZE.w, h: CHIP_SIZE.h }])),
    ...Object.fromEntries(bottom.map(({ id }) => [id, { x: bottomX[id], y: bottomY, w: CHIP_SIZE.w, h: CHIP_SIZE.h }])),
  };
};

const placeInWorld = (node: ArchNode, screen: Box, view: Viewport): ArchNode => {
  const origin = toWorld(view, screen.x, screen.y);
  return { ...node, x: origin.x, y: origin.y, w: screen.w / view.k, h: screen.h / view.k };
};

/** Overview model with the open layer stretched to the window and every other card shrunk into its docked chip. */
export const dockModel = (
  model: ArchModel,
  overviewView: Viewport,
  stage: StageSize,
  scope: LayerId,
): { model: ArchModel; chips: Record<string, Box> } => {
  const chips = dockedScreenBoxes(model, overviewView, stage, scope);
  const open = windowBox(stage);
  const place = (node: ArchNode): ArchNode => {
    if (node.id === layerNodeId(scope)) return placeInWorld(node, open, overviewView);
    const chip = chips[node.id];
    return chip ? placeInWorld(node, chip, overviewView) : node;
  };
  return {
    model: {
      ...model,
      lnodes: model.lnodes.map((n) => place(n) as typeof n),
      nodes: model.nodes.map((n) => place(n) as typeof n),
    },
    chips,
  };
};

/** Where the window grows from: the open card on the overview, or the docked chip when switching layers. */
export const growOrigin = (
  model: ArchModel,
  overviewView: Viewport,
  stage: StageSize,
  previousScope: LayerId | null,
  target: LayerId,
): Box | null => {
  if (previousScope) return dockedScreenBoxes(model, overviewView, stage, previousScope)[layerNodeId(target)] ?? null;
  const card = model.lnodes.find((n) => n.id === layerNodeId(target));
  return card ? screenBoxOf(overviewView, card) : null;
};

/** CSS inset() that reveals only `origin` inside `window`, so the window frame can grow out of a card. */
export const clipInsetFrom = (origin: Box, window: Box, radiusPx: number): string => {
  const top = Math.max(0, origin.y - window.y);
  const left = Math.max(0, origin.x - window.x);
  const right = Math.max(0, window.x + window.w - (origin.x + origin.w));
  const bottom = Math.max(0, window.y + window.h - (origin.y + origin.h));
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radiusPx}px)`;
};

/** CSS transform that makes an element laid out at `to` look like `from`; `zoom` is the scale of any parent world. */
export const transformBetween = (from: Box, to: Box, zoom: number): string =>
  `translate(${(from.x - to.x) / zoom}px, ${(from.y - to.y) / zoom}px) scale(${from.w / to.w}, ${from.h / to.h})`;

const COLLAPSED_SIZE = { w: 80, h: 20 };

/** A small box at the centre of `box`, where cards without a pill come from and go to. */
export const collapsedBoxIn = (box: Box): Box => ({
  x: box.x + box.w / 2 - COLLAPSED_SIZE.w / 2,
  y: box.y + box.h / 2 - COLLAPSED_SIZE.h / 2,
  ...COLLAPSED_SIZE,
});
