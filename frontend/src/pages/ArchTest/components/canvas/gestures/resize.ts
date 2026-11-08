import { node as nodeOf, reparent } from "../../../engine";
import { snapToGrid, toWorld } from "../../../view/geometry";
import { type GestureContext, type PointerLike } from "./gestureContext";
import { trackPointer } from "./track";

const MIN_WIDTH = 150;
const MIN_HEIGHT = 70;

export const startResize = (ctx: GestureContext, start: PointerLike, nodeId: string): void => {
  const target = nodeOf(ctx.model, nodeId);
  if (!target) return;
  const rect = ctx.viewportRect();
  const worldOf = (event: PointerLike) => toWorld(ctx.view, event.clientX - rect.left, event.clientY - rect.top);
  const startWorld = worldOf(start);
  let latest: { w: number; h: number } | null = null;
  trackPointer(
    (move) => {
      const here = worldOf(move);
      latest = {
        w: Math.max(MIN_WIDTH, snapToGrid(target.w + here.x - startWorld.x)),
        h: Math.max(MIN_HEIGHT, snapToGrid(target.h + here.y - startWorld.y)),
      };
      ctx.setOverrides({ positions: {}, sizes: { [nodeId]: latest } });
    },
    () => {
      ctx.setOverrides(null);
      if (!latest) return;
      const size = latest;
      ctx.commit((draft) => {
        const resized = nodeOf(draft, nodeId);
        if (!resized) return;
        resized.w = size.w;
        resized.h = size.h;
        if (resized.type === "layer") return;
        draft.nodes.filter((n) => n.layer === resized.layer && n.id !== resized.id).forEach((n) => reparent(draft, n));
      });
    },
  );
};
