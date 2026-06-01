import type { PortPosition } from "@/shared/types";

export interface Point {
  x: number;
  y: number;
}

const CURVATURE = 0.4;

export function buildCubicPath(a: Point, b: Point): string {
  const dx = (b.x - a.x) * CURVATURE;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function anchorOnRect(rect: DOMRect, originX: number, originY: number, port: PortPosition | "c"): Point {
  const x = rect.left - originX;
  const y = rect.top - originY;
  switch (port) {
    case "l": return { x, y: y + rect.height / 2 };
    case "r": return { x: x + rect.width, y: y + rect.height / 2 };
    case "t": return { x: x + rect.width / 2, y };
    case "b": return { x: x + rect.width / 2, y: y + rect.height };
    default:  return { x: x + rect.width / 2, y: y + rect.height / 2 };
  }
}

export function anchorOnElement(
  container: HTMLElement,
  selector: string,
  port: PortPosition | "c",
): Point | null {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const cr = container.getBoundingClientRect();
  return anchorOnRect(el.getBoundingClientRect(), cr.left, cr.top, port);
}
