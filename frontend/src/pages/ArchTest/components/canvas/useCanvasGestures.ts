import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ArchModel, LayerId } from "../../engine";
import type { SelectionState } from "../../state/archApi";
import { clamp, type Viewport } from "../../view/geometry";
import type { GeometryOverrides } from "../../view/overrides";
import { handleCanvasPointerDown } from "./gestures/dispatch";
import type { ConnectPreview, GestureContext, MarqueeRect } from "./gestures/gestureContext";

export interface GestureDeps {
  model: ArchModel;
  selection: SelectionState;
  scope: LayerId | null;
  view: Viewport;
  setView: (view: Viewport) => void;
  select: (selection: SelectionState) => void;
  commit: (mutator: (draft: ArchModel) => void) => void;
  openScope: (layer: LayerId) => void;
  openDetail: (nodeId: string) => void;
  connect: (fromId: string, toId: string, endpointId?: string) => void;
  reveal: (nodeId: string) => void;
  focusEndpoint: (endpointId: string | null) => void;
  zoomAtPoint: (x: number, y: number, factor: number) => void;
  panBy: (dx: number, dy: number) => void;
}

export interface CanvasGestures {
  attachViewport: (element: HTMLDivElement | null) => void;
  overrides: GeometryOverrides | null;
  preview: ConnectPreview | null;
  marquee: MarqueeRect | null;
  panning: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

const WHEEL_ZOOM_SPEED = 0.01;

export const useCanvasGestures = (deps: GestureDeps): CanvasGestures => {
  const [viewport, attachViewport] = useState<HTMLDivElement | null>(null);
  const [lastClick] = useState<{ id: string | null; time: number }>(() => ({ id: null, time: 0 }));
  const [overrides, setOverrides] = useState<GeometryOverrides | null>(null);
  const [preview, setPreview] = useState<ConnectPreview | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [panning, setPanning] = useState(false);

  const { zoomAtPoint, panBy } = deps;
  useEffect(() => {
    if (!viewport) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey) {
        panBy(event.deltaX, event.deltaY);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      zoomAtPoint(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-clamp(event.deltaY, -200, 200) * WHEEL_ZOOM_SPEED));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewport, zoomAtPoint, panBy]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const context: GestureContext = {
      model: deps.model,
      selection: deps.selection,
      scope: deps.scope,
      view: deps.view,
      viewportRect: () => viewport?.getBoundingClientRect() ?? { left: 0, top: 0, width: 900, height: 600 },
      select: deps.select,
      commit: deps.commit,
      setOverrides,
      setPreview,
      setMarquee,
      setPanning,
      setView: deps.setView,
      openScope: deps.openScope,
      openDetail: deps.openDetail,
      connect: deps.connect,
      reveal: deps.reveal,
      focusEndpoint: deps.focusEndpoint,
      elementAt: (x, y) => document.elementFromPoint(x, y),
      now: () => Date.now(),
      lastClick,
    };
    handleCanvasPointerDown(context, {
      button: event.button,
      shiftKey: event.shiftKey,
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target as Element,
      preventDefault: () => event.preventDefault(),
    });
  };

  return { attachViewport, overrides, preview, marquee, panning, onPointerDown };
};
