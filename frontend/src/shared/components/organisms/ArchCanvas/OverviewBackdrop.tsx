import type { ArchModel } from "@/pages/ArchTest/engine";
import { NO_SELECTION, useArch } from "@/pages/ArchTest/state/archApi";
import type { Viewport } from "@/pages/ArchTest/view/geometry";
import { gridStyle } from "./gridStyle";
import { useWorldData } from "./useWorldData";
import { World } from "./World";
import styles from "./canvas.module.css";

interface OverviewBackdropProps {
  dockedModel: ArchModel;
  dockedIds: ReadonlySet<string>;
  overviewView: Viewport;
  moving: boolean;
  showFlow: boolean;
}

export const OverviewBackdrop = ({ dockedModel, dockedIds, overviewView, moving, showFlow }: OverviewBackdropProps) => {
  const api = useArch();
  const backdrop = useWorldData({
    model: dockedModel,
    flow: api.flow,
    scope: null,
    selection: NO_SELECTION,
    trace: api.trace,
    showFlow,
    showStateLinks: false,
  });
  return (
    <div className={styles.backdrop} data-moving={moving} aria-hidden="true">
      <div className={styles.viewport} style={gridStyle(overviewView)}>
        <World
          model={dockedModel}
          docked={dockedIds}
          endpointFocus={null}
          flow={api.flow}
          visibility={backdrop.visibility}
          scene={backdrop.scene}
          scope={null}
          selection={NO_SELECTION}
          trace={api.trace}
          showFlow={showFlow}
          view={overviewView}
          preview={null}
          idPrefix="backdrop"
          onOpenFlow={api.openFlow}
        />
      </div>
    </div>
  );
};
