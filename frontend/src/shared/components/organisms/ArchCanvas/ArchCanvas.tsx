import { useMemo, type RefObject } from "react";
import { useArch } from "@/pages/ArchTest/state/archApi";
import type { Controller } from "@/pages/ArchTest/state/useArchController";
import { dockModel, WINDOW_INSET } from "@/pages/ArchTest/view/dock";
import { toScreen } from "@/pages/ArchTest/view/geometry";
import { classNames } from "@/shared/utils/classNames";
import { applyOverrides, NO_OVERRIDES } from "@/pages/ArchTest/view/overrides";
import { DockedLayerButtons } from "./DockedLayerButtons";
import { EdgePopover } from "./EdgePopover";
import { gridStyle } from "./gridStyle";
import { OverviewBackdrop } from "./OverviewBackdrop";
import { ScopeBar } from "./ScopeBar";
import { World } from "./World";
import styles from "./canvas.module.css";
import { useCanvasGestures } from "./useCanvasGestures";
import { useDockMotion } from "./useDockMotion";
import { useRetainedScope } from "./useRetainedScope";
import { useStageSize } from "./useStageSize";
import { useWindowGrow } from "./useWindowGrow";
import { useWorldData } from "./useWorldData";

const OVERVIEW_HINT = "Click a layer to open it · drag to arrange · drag from a dot to connect";
const LAYER_HINT = "Drag to pan · Ctrl/Cmd + scroll to zoom · double-click a box for details · drag from a dot to connect";

interface CanvasProps {
  stageRef: RefObject<HTMLDivElement | null>;
  controller: Controller;
  onOpenInsertMenu: (anchor: HTMLElement) => void;
  onConnect: (fromId: string, toId: string, endpointId?: string) => void;
}

export const ArchCanvas = ({ stageRef, controller, onOpenInsertMenu, onConnect }: CanvasProps) => {
  const api = useArch();
  const { view: scopeView, showFlow, showStateLinks } = controller;
  const { scope, view } = scopeView;
  const shown = useRetainedScope(scope, view, scopeView.viewOfScope);
  const { attachViewport, overrides, preview, marquee, panning, onPointerDown } = useCanvasGestures({
    model: api.model,
    selection: api.selection,
    scope,
    view,
    setView: scopeView.setView,
    select: api.select,
    commit: api.commit,
    openScope: scopeView.openScope,
    openDetail: api.openDetail,
    connect: onConnect,
    reveal: api.reveal,
    focusEndpoint: api.focusEndpoint,
    zoomAtPoint: scopeView.zoomAtPoint,
    panBy: scopeView.panBy,
  });

  const liveModel = useMemo(
    () => applyOverrides(api.model, overrides ?? NO_OVERRIDES),
    [api.model, overrides],
  );
  const live = useWorldData({
    model: liveModel,
    flow: api.flow,
    scope: shown.scope,
    selection: api.selection,
    trace: api.trace,
    showFlow,
    showStateLinks,
  });
  const stage = useStageSize(stageRef);
  const { docked, moving } = useDockMotion(scope);
  useWindowGrow({ stageRef, scope, shownScope: shown.scope, model: api.model, overviewView: scopeView.overviewView, stage });
  const dock = useMemo(
    () =>
      scope && docked && stage.width > 0
        ? dockModel(api.model, scopeView.overviewView, stage, scope)
        : { model: api.model, chips: {} },
    [api.model, scopeView.overviewView, stage, scope, docked],
  );
  const dockedIds = useMemo(() => new Set(Object.keys(dock.chips)), [dock.chips]);
  const selectedEdgeId = api.selection.type === "edge" ? api.selection.ids[0] : null;
  const selectedMidpoint = selectedEdgeId ? live.scene.midpoints[selectedEdgeId] : undefined;
  const popoverAnchor = selectedMidpoint ? toScreen(shown.view, selectedMidpoint) : null;
  const viewportClass = classNames(styles.viewport, shown.scope && styles.inner, panning && styles.panning);

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      onPointerDown={(event) => {
        if (scope && event.target === event.currentTarget) scopeView.closeScope();
      }}
    >
      {shown.scope && (
        <OverviewBackdrop
          dockedModel={dock.model}
          dockedIds={dockedIds}
          overviewView={scopeView.overviewView}
          moving={moving}
          showFlow={showFlow}
        />
      )}
      {scope && <DockedLayerButtons model={api.model} chips={dock.chips} onOpen={scopeView.openScope} />}
      <div
        ref={attachViewport}
        className={viewportClass}
        style={{
          ...gridStyle(shown.view),
          ...(shown.scope && { inset: `${WINDOW_INSET.y}px ${WINDOW_INSET.x}px` }),
          ...(shown.closing && { pointerEvents: "none" }),
        }}
        data-live-viewport="true"
        onPointerDown={onPointerDown}
      >
        {shown.scope && !shown.closing && <ScopeBar scope={shown.scope} onFit={scopeView.fit} onClose={scopeView.closeScope} />}
        <World
          model={liveModel}
          endpointFocus={api.endpointFocus}
          flow={api.flow}
          visibility={live.visibility}
          scene={live.scene}
          scope={shown.scope}
          selection={api.selection}
          trace={api.trace}
          showFlow={showFlow}
          view={shown.view}
          preview={preview}
          idPrefix="live"
          onOpenFlow={api.openFlow}
        />
        {selectedEdgeId && popoverAnchor && (
          <EdgePopover edgeId={selectedEdgeId} anchor={popoverAnchor} onOpenInsertMenu={onOpenInsertMenu} />
        )}
        {marquee && (
          <div
            className={styles.marquee}
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}
        <div className={styles.hint}>{shown.scope ? LAYER_HINT : OVERVIEW_HINT}</div>
      </div>
    </div>
  );
};
