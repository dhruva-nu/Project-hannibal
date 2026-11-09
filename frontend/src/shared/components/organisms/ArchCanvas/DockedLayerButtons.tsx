import type { ArchModel, LayerId } from "@/pages/ArchTest/engine";
import type { Box } from "@/pages/ArchTest/view/geometry";
import styles from "./canvas.module.css";

interface DockedLayerButtonsProps {
  model: ArchModel;
  chips: Record<string, Box>;
  onOpen: (layer: LayerId) => void;
}

export const DockedLayerButtons = ({ model, chips, onOpen }: DockedLayerButtonsProps) =>
  model.lnodes
    .filter((layer) => chips[layer.id])
    .map((layer) => {
      const chip = chips[layer.id];
      return (
        <button
          key={layer.id}
          type="button"
          className={styles.dockButton}
          aria-label={`Open ${layer.name}`}
          style={{ left: chip.x, top: chip.y, width: chip.w, height: chip.h }}
          onClick={() => onOpen(layer.lid)}
        />
      );
    });
