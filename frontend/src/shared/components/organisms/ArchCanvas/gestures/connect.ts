import { findNode as nodeOf } from "@/pages/ArchTest/engine";
import { anchorPoint, toWorld, type Side } from "@/pages/ArchTest/view/geometry";
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
      const hit = ctx.elementAt(end.clientX, end.clientY);
      const targetId = hit?.closest<HTMLElement>("[data-kind]")?.dataset.id;
      const endpointId = hit?.closest<HTMLElement>("[data-endpoint]")?.dataset.endpoint;
      if (targetId && targetId !== fromId) ctx.connect(fromId, targetId, endpointId);
    },
  );
};
