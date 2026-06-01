import type { PaletteKind } from "@/pages/DesignBoard/boardTypes";
import styles from "./PaletteItem.module.css";

interface PaletteItemProps {
  kind: PaletteKind;
  label: string;
  displayLabel?: string;
}

export const PaletteItem = ({ kind, label, displayLabel }: PaletteItemProps) => {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("kind", kind);
    e.dataTransfer.setData("label", label);
  };

  return (
    <div
      className={`${styles.item} ${styles[kind]}`}
      draggable
      onDragStart={handleDragStart}
      aria-label={`Drag ${displayLabel ?? label} onto board`}
    >
      <span className={styles.ico} aria-hidden="true" />
      {displayLabel ?? label}
    </div>
  );
};
