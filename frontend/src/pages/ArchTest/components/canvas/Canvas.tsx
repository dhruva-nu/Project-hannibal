import { useMemo, type RefObject } from "react";
import { useArch } from "../../state/archApi";
import type { Controller } from "../../state/useArchController";
import { toScreen, type Viewport } from "../../view/geometry";
import { applyOverrides, NO_OVERRIDES } from "../../view/overrides";
import { EdgePopover } from "./EdgePopover";
import { ScopeBar } from "./ScopeBar";
import { World } from "./World";
import styles from "./canvas.module.css";
import { useCanvasGestures } from "./useCanvasGestures";
import { useWorldData } from "./useWorldData";

const GRID_SIZE = 24;
const OVERVIEW_HINT = "Click a layer to open it. Drag layers to arrange them. Hover a box and drag from a dot to connect.";

const gridStyle = (view: Viewport) => ({
  backgroundSize: `${GRID_SIZE * view.k}px ${GRID_SIZE * view.k}px`,
  backgroundPosition: `${view.x}px ${view.y}px`,
});

interface CanvasProps {
  stageRef: RefObject<HTMLDivElement | null>;
  controller: Controller;
  onOpenInsertMenu: (anchor: HTMLElement) => void;
  onConnect: (fromId: string, toId: string) => void;
}

export const Canvas = ({ stageRef, controller, onOpenInsertMenu, onConnect }: CanvasProps) => {
  const api = useArch();
  const { view: scopeView, showFlow, showStateLinks } = controller;
  const { scope, view } = scopeView;
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
    scope,
    selection: api.selection,
    trace: api.trace,
    showFlow,
    showStateLinks,
  });
  const backdrop = useWorldData({
    model: api.model,
    flow: api.flow,
    scope: null,
    selection: { type: null, ids: [] },
    trace: api.trace,
    showFlow,
    showStateLinks: false,
  });

  const selectedEdgeId = api.selection.type === "edge" ? api.selection.ids[0] : null;
  const selectedMidpoint = selectedEdgeId ? live.scene.midpoints[selectedEdgeId] : undefined;
  const popoverAnchor = selectedMidpoint ? toScreen(view, selectedMidpoint) : null;
  const viewportClass = [styles.viewport, scope && styles.inner, panning && styles.panning]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      onPointerDown={(event) => {
        if (scope && event.target === event.currentTarget) scopeView.closeScope();
      }}
    >
      {scope && (
        <div className={styles.backdrop} aria-hidden="true">
          <div className={styles.viewport} style={gridStyle(scopeView.overviewView)}>
            <World
              model={api.model}
              flow={api.flow}
              visibility={backdrop.visibility}
              scene={backdrop.scene}
              scope={null}
              selection={{ type: null, ids: [] }}
              trace={api.trace}
              showFlow={showFlow}
              view={scopeView.overviewView}
              preview={null}
              idPrefix="backdrop"
              onOpenFlow={api.openFlow}
            />
          </div>
        </div>
      )}
      <div ref={attachViewport} className={viewportClass} style={gridStyle(view)} onPointerDown={onPointerDown}>
        {scope && <ScopeBar scope={scope} onFit={scopeView.fit} onClose={scopeView.closeScope} />}
        <World
          model={liveModel}
          flow={api.flow}
          visibility={live.visibility}
          scene={live.scene}
          scope={scope}
          selection={api.selection}
          trace={api.trace}
          showFlow={showFlow}
          view={view}
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
        {!scope && <div className={styles.hint}>{OVERVIEW_HINT}</div>}
      </div>
    </div>
  );
};
