export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Side = "t" | "b" | "l" | "r";

export interface Anchor extends Point {
  side: Side;
}

export interface Curve {
  path: string;
  mid: Point;
}

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface EdgeEnds {
  id: string;
  from: string;
  to: string;
}

export type EdgeAnchors = Record<string, { a?: Anchor; b?: Anchor }>;

const SIDE_NORMALS: Record<Side, readonly [number, number]> = {
  t: [0, -1],
  b: [0, 1],
  l: [-1, 0],
  r: [1, 0],
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const MAX_FIT_ZOOM = 1.2;
const FIT_PADDING = 50;

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export const snapToGrid = (value: number) => Math.round(value / 10) * 10;

export const centerOf = (box: Box): Point => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

export const sideFacing = (from: Box, to: Box): Side => {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontalPull = Math.abs(dx) / (from.w / 2 + to.w / 2);
  const verticalPull = Math.abs(dy) / (from.h / 2 + to.h / 2);
  if (horizontalPull > verticalPull) return dx > 0 ? "r" : "l";
  return dy > 0 ? "b" : "t";
};

export const anchorPoint = (box: Box, side: Side, fraction: number): Anchor => {
  if (side === "t") return { x: box.x + box.w * fraction, y: box.y, side };
  if (side === "b") return { x: box.x + box.w * fraction, y: box.y + box.h, side };
  if (side === "l") return { x: box.x, y: box.y + box.h * fraction, side };
  return { x: box.x + box.w, y: box.y + box.h * fraction, side };
};

interface PendingEnd {
  edgeId: string;
  end: "a" | "b";
  other: Box;
}

const crossAxisCenter = (side: Side, box: Box) => (side === "t" || side === "b" ? centerOf(box).x : centerOf(box).y);

const collectEnds = (edges: EdgeEnds[], boxOf: (id: string) => Box | undefined) => {
  const ends: Record<string, PendingEnd[]> = {};
  const addEnd = (nodeId: string, side: Side, end: PendingEnd) => {
    const key = `${nodeId}|${side}`;
    (ends[key] = ends[key] ?? []).push(end);
  };
  edges.forEach((edge) => {
    const a = boxOf(edge.from);
    const b = boxOf(edge.to);
    if (!a || !b) return;
    addEnd(edge.from, sideFacing(a, b), { edgeId: edge.id, end: "a", other: b });
    addEnd(edge.to, sideFacing(b, a), { edgeId: edge.id, end: "b", other: a });
  });
  return ends;
};

export const computeAnchors = (edges: EdgeEnds[], boxOf: (id: string) => Box | undefined): EdgeAnchors => {
  const result: EdgeAnchors = {};
  Object.entries(collectEnds(edges, boxOf)).forEach(([key, pending]) => {
    const [nodeId, side] = key.split("|") as [string, Side];
    const box = boxOf(nodeId);
    if (!box) return;
    const ordered = [...pending].sort((p, q) => crossAxisCenter(side, p.other) - crossAxisCenter(side, q.other));
    ordered.forEach((item, index) => {
      const slot = (result[item.edgeId] = result[item.edgeId] ?? {});
      slot[item.end] = anchorPoint(box, side, (index + 1) / (ordered.length + 1));
    });
  });
  return result;
};

export const curveBetween = (from: Anchor, to: Anchor): Curve => {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const reach = Math.max(30, Math.min(160, distance * 0.4));
  const [fx, fy] = SIDE_NORMALS[from.side];
  const [tx, ty] = SIDE_NORMALS[to.side];
  const c1 = { x: from.x + fx * reach, y: from.y + fy * reach };
  const c2 = { x: to.x + tx * reach, y: to.y + ty * reach };
  return {
    path: `M${from.x},${from.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${to.x},${to.y}`,
    mid: {
      x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8,
      y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8,
    },
  };
};

export const rectEdgeToward = (box: Box, target: Point): Point => {
  const center = centerOf(box);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (!dx && !dy) return center;
  const scale = Math.min(box.w / 2 / Math.abs(dx || 1e-9), box.h / 2 / Math.abs(dy || 1e-9));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
};

export const boundsOf = (boxes: Box[]): Bounds | null => {
  if (!boxes.length) return null;
  return boxes.reduce<Bounds>(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.x),
      minY: Math.min(acc.minY, b.y),
      maxX: Math.max(acc.maxX, b.x + b.w),
      maxY: Math.max(acc.maxY, b.y + b.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
};

export const DEFAULT_VIEW: Viewport = { x: 60, y: 40, k: 0.8 };

export const fitView = (boxes: Box[], width: number, height: number): Viewport => {
  const bounds = boundsOf(boxes);
  if (!bounds) return { ...DEFAULT_VIEW };
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const k = clamp(
    Math.min((width - FIT_PADDING * 2) / spanX, (height - FIT_PADDING * 2) / spanY, 1),
    MIN_ZOOM,
    MAX_FIT_ZOOM,
  );
  return {
    k,
    x: FIT_PADDING - bounds.minX * k + (width - FIT_PADDING * 2 - spanX * k) / 2,
    y: FIT_PADDING - bounds.minY * k + (height - FIT_PADDING * 2 - spanY * k) / 2,
  };
};

export const zoomAround = (view: Viewport, pointX: number, pointY: number, factor: number): Viewport => {
  const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / view.k;
  return { k, x: pointX - (pointX - view.x) * ratio, y: pointY - (pointY - view.y) * ratio };
};

export const toWorld = (view: Viewport, screenX: number, screenY: number): Point => ({
  x: (screenX - view.x) / view.k,
  y: (screenY - view.y) / view.k,
});

export const toScreen = (view: Viewport, world: Point): Point => ({
  x: world.x * view.k + view.x,
  y: world.y * view.k + view.y,
});

export const centerOnBox = (view: Viewport, box: Box, width: number, height: number): Viewport | null => {
  const margin = 30;
  const left = box.x * view.k + view.x;
  const top = box.y * view.k + view.y;
  const offScreen =
    left < margin || top < margin || left + box.w * view.k > width - margin || top + box.h * view.k > height - margin;
  if (!offScreen) return null;
  return {
    k: view.k,
    x: width / 2 - (box.x + box.w / 2) * view.k,
    y: height / 2 - (box.y + box.h / 2) * view.k,
  };
};

export const boxesOverlap = (a: Box, b: Box, gap = 10) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

export const intersects = (box: Box, x1: number, y1: number, x2: number, y2: number) =>
  box.x < x2 && box.x + box.w > x1 && box.y < y2 && box.y + box.h > y1;

export const containsPoint = (box: Box, point: Point) =>
  point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
