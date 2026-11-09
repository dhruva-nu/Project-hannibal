import type { Side } from "@/pages/ArchTest/view/geometry";
import { startConnect } from "./connect";
import { startGroupDrag, startNodeDrag } from "./dragNodes";
import type { GestureContext } from "./gestureContext";
import { startMarquee, startPan } from "./panMarquee";
import { startResize } from "./resize";

export interface CanvasPointerEvent {
  button: number;
  shiftKey: boolean;
  clientX: number;
  clientY: number;
  target: Element;
  preventDefault: () => void;
}

const PASS_THROUGH_SELECTOR = "[data-popover], [data-chip], [data-scopebar]";
const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;

const nodeIdOf = (element: Element | null): string | undefined =>
  element?.closest<HTMLElement>("[data-kind]")?.dataset.id;

export const handleCanvasPointerDown = (ctx: GestureContext, event: CanvasPointerEvent): void => {
  if (event.button !== PRIMARY_BUTTON && event.button !== MIDDLE_BUTTON) return;
  const { target } = event;
  if (target.closest(PASS_THROUGH_SELECTOR)) return;
  if (event.button === MIDDLE_BUTTON) {
    startPan(ctx, event);
    return;
  }
  const port = target.closest<HTMLElement>("[data-port]");
  const portOwner = nodeIdOf(port);
  if (port && portOwner) {
    event.preventDefault();
    startConnect(ctx, portOwner, port.dataset.port as Side);
    return;
  }
  const resizeHandle = target.closest("[data-resize]");
  const resizeOwner = nodeIdOf(resizeHandle);
  if (resizeHandle && resizeOwner) {
    event.preventDefault();
    startResize(ctx, event, resizeOwner);
    return;
  }
  const ghost = target.closest<HTMLElement>("[data-ghost]");
  if (ghost?.dataset.ghost) {
    ctx.reveal(ghost.dataset.ghost);
    return;
  }
  const nodeId = nodeIdOf(target);
  if (nodeId) {
    const endpointId = target.closest<HTMLElement>("[data-endpoint]")?.dataset.endpoint;
    if (endpointId) ctx.focusEndpoint(endpointId);
    startNodeDrag(ctx, event, nodeId);
    return;
  }
  const groupHead = target.closest<HTMLElement>("[data-group-head]");
  if (groupHead?.dataset.groupHead) {
    startGroupDrag(ctx, event, groupHead.dataset.groupHead);
    return;
  }
  const edgeHit = target.closest<HTMLElement>("[data-edge-id]");
  if (edgeHit?.dataset.edgeId) {
    ctx.select({ type: "edge", ids: [edgeHit.dataset.edgeId] });
    return;
  }
  if (event.shiftKey) startMarquee(ctx, event);
  else startPan(ctx, event);
};
