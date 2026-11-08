import { node as nodeOf } from "../../../engine";
import { anchorPoint, toWorld, type Side } from "../../../view/geometry";
import type { GestureContext } from "./gestureContext";
import { trackPointer } from "./track";

export const startConnect = (ctx: GestureContext, fromId: string, side: Side): void => {
  const source = nodeOf(ctx.model, fromId);
  if (!source) return;
  const rect = ctx.viewportRect();
  const anchor = anchorPoint(source, side, 0.5);
  trackPointer(
    (move) =>
      ctx.setPreview({ from: anchor, to: toWorld(ctx.view, move.clientX - rect.left, move.clientY - rect.top) }),
    (end) => {
      ctx.setPreview(null);
      const element = ctx.elementAt(end.clientX, end.clientY)?.closest<HTMLElement>("[data-kind]");
      const targetId = element?.dataset.id;
      if (targetId && targetId !== fromId) ctx.connect(fromId, targetId);
    },
  );
};
