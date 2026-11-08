import type { ArchModel } from "../../../engine";
import type { LayerId } from "../../../engine";
import type { SelectionState } from "../../../state/archApi";
import type { Point, Viewport } from "../../../view/geometry";
import type { GeometryOverrides } from "../../../view/overrides";

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectPreview {
  from: Point;
  to: Point;
}

export interface PointerLike {
  clientX: number;
  clientY: number;
  shiftKey?: boolean;
}

/** Everything a pointer gesture needs from the canvas; supplied fresh on each gesture start. */
export interface GestureContext {
  model: ArchModel;
  selection: SelectionState;
  scope: LayerId | null;
  view: Viewport;
  viewportRect: () => ViewportRect;
  select: (selection: SelectionState) => void;
  commit: (mutator: (draft: ArchModel) => void) => void;
  setOverrides: (overrides: GeometryOverrides | null) => void;
  setPreview: (preview: ConnectPreview | null) => void;
  setMarquee: (marquee: MarqueeRect | null) => void;
  setPanning: (panning: boolean) => void;
  setView: (view: Viewport) => void;
  openScope: (layer: LayerId) => void;
  openDetail: (nodeId: string) => void;
  connect: (fromId: string, toId: string) => void;
  reveal: (nodeId: string) => void;
  elementAt: (x: number, y: number) => Element | null;
  now: () => number;
  lastClick: { id: string | null; time: number };
}

export const DOUBLE_CLICK_MS = 400;

export const MOVE_THRESHOLD_PX = 4;

export const hasMoved = (start: PointerLike, current: PointerLike): boolean =>
  Math.hypot(current.clientX - start.clientX, current.clientY - start.clientY) >= MOVE_THRESHOLD_PX;
