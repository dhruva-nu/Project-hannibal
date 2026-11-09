import { useCallback, useState } from "react";
import type { ArchModel, LayerId, View } from "../engine";
import { DEFAULT_VIEW, node as nodeOf } from "../engine";
import { centerOnBox, fitView, zoomAround } from "../view/geometry";
import { windowBox, type StageSize } from "../view/dock";
import { visibleNodes } from "../view/visibility";
import type { ViewMap } from "./useModelStore";

export type { StageSize };

const BUTTON_ZOOM_STEP = 1.2;

export const viewportSizeFor = (scope: LayerId | null, stage: StageSize): StageSize => {
  if (!scope) return stage;
  const window = windowBox(stage);
  return { width: window.w, height: window.h };
};

const viewKey = (scope: LayerId | null) => scope ?? "overview";

export interface ScopeViewApi {
  scope: LayerId | null;
  view: View;
  overviewView: View;
  setScope: (scope: LayerId | null) => void;
  panBy: (dx: number, dy: number) => void;
  setView: (view: View) => void;
  zoomAtPoint: (x: number, y: number, factor: number) => void;
  zoomFromCenter: (direction: "in" | "out") => void;
  fit: () => void;
  openScope: (layer: LayerId) => void;
  closeScope: () => void;
  ensureVisible: (nodeId: string, forScope?: LayerId | null) => void;
}

interface Inputs {
  model: ArchModel;
  views: ViewMap;
  setViews: (update: (views: ViewMap) => ViewMap) => void;
  getStageSize: () => StageSize;
  onScopeChange: () => void;
}

export const useScopeView = ({ model, views, setViews, getStageSize, onScopeChange }: Inputs): ScopeViewApi => {
  const [scope, setScopeState] = useState<LayerId | null>(null);
  const view = views[viewKey(scope)] ?? DEFAULT_VIEW;

  const storeView = useCallback(
    (forScope: LayerId | null, next: View) => setViews((all) => ({ ...all, [viewKey(forScope)]: next })),
    [setViews],
  );

  const setView = useCallback((next: View) => storeView(scope, next), [storeView, scope]);

  const panBy = useCallback((dx: number, dy: number) => setView({ ...view, x: view.x - dx, y: view.y - dy }), [setView, view]);

  const zoomAtPoint = useCallback(
    (x: number, y: number, factor: number) => setView(zoomAround(view, x, y, factor)),
    [setView, view],
  );

  const zoomFromCenter = useCallback(
    (direction: "in" | "out") => {
      const size = viewportSizeFor(scope, getStageSize());
      zoomAtPoint(size.width / 2, size.height / 2, direction === "in" ? BUTTON_ZOOM_STEP : 1 / BUTTON_ZOOM_STEP);
    },
    [scope, getStageSize, zoomAtPoint],
  );

  const fitScope = useCallback(
    (forScope: LayerId | null) => {
      const size = viewportSizeFor(forScope, getStageSize());
      storeView(forScope, fitView(visibleNodes(model, forScope), size.width, size.height));
    },
    [model, getStageSize, storeView],
  );

  const fit = useCallback(() => fitScope(scope), [fitScope, scope]);

  const openScope = useCallback(
    (layer: LayerId) => {
      setScopeState(layer);
      onScopeChange();
      if (!views[layer]) fitScope(layer);
    },
    [views, fitScope, onScopeChange],
  );

  const ensureVisible = useCallback(
    (nodeId: string, forScope: LayerId | null = scope) => {
      const target = nodeOf(model, nodeId);
      if (!target) return;
      const size = viewportSizeFor(forScope, getStageSize());
      const current = views[viewKey(forScope)];
      if (!current) return;
      const next = centerOnBox(current, target, size.width, size.height);
      if (next) storeView(forScope, next);
    },
    [model, scope, views, getStageSize, storeView],
  );

  return {
    scope,
    view,
    overviewView: views.overview ?? DEFAULT_VIEW,
    setScope: setScopeState,
    panBy,
    setView,
    zoomAtPoint,
    zoomFromCenter,
    fit,
    openScope,
    closeScope: () => {
      setScopeState(null);
      onScopeChange();
    },
    ensureVisible,
  };
};
