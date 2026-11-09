import { NO_SELECTION } from "@/pages/ArchTest/state/archApi";
import { intersects, toWorld } from "@/pages/ArchTest/view/geometry";
import { visibleNodes } from "@/pages/ArchTest/view/visibility";
import { hasMoved, type GestureContext, type PointerLike } from "./gestureContext";
import { trackPointer } from "./track";

export const startPan = (ctx: GestureContext, start: PointerLike): void => {
  const origin = ctx.view;
  let moved = false;
  ctx.setPanning(true);
  trackPointer(
    (move) => {
      if (!moved && !hasMoved(start, move)) return;
      moved = true;
      ctx.setView({ ...origin, x: origin.x + move.clientX - start.clientX, y: origin.y + move.clientY - start.clientY });
    },
    () => {
      ctx.setPanning(false);
      if (!moved) ctx.select(NO_SELECTION);
    },
  );
};

export const startMarquee = (ctx: GestureContext, start: PointerLike): void => {
  const rect = ctx.viewportRect();
  const rectBetween = (current: PointerLike) => ({
    x: Math.min(start.clientX, current.clientX) - rect.left,
    y: Math.min(start.clientY, current.clientY) - rect.top,
    width: Math.abs(current.clientX - start.clientX),
    height: Math.abs(current.clientY - start.clientY),
  });
  ctx.setMarquee(rectBetween(start));
  trackPointer(
    (move) => ctx.setMarquee(rectBetween(move)),
    (end) => {
      ctx.setMarquee(null);
      const a = toWorld(ctx.view, start.clientX - rect.left, start.clientY - rect.top);
      const b = toWorld(ctx.view, end.clientX - rect.left, end.clientY - rect.top);
      const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      const ids = visibleNodes(ctx.model, ctx.scope)
        .filter((n) => n.type !== "layer" && intersects(n, x1, y1, x2, y2))
        .map((n) => n.id);
      ctx.select(ids.length ? { type: "node", ids } : NO_SELECTION);
    },
  );
};
