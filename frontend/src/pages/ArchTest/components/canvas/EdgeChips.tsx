import type { EdgeChip } from "../../view/edgeScene";
import styles from "./canvas.module.css";

interface EdgeChipsProps {
  chips: EdgeChip[];
  onOpenFlow: (edgeId: string) => void;
}

export const EdgeChips = ({ chips, onOpenFlow }: EdgeChipsProps) => (
  <>
    {chips.map((chip) => (
      <div
        key={chip.key}
        className={styles.chip}
        data-chip="true"
        data-kind={chip.kind}
        data-warn={chip.warn}
        data-dimmed={chip.dimmed}
        style={{ left: chip.x, top: chip.y }}
        title={chip.kind === "flow" ? "Open the full payload" : undefined}
        role={chip.kind === "flow" ? "button" : undefined}
        tabIndex={chip.kind === "flow" ? 0 : undefined}
        onClick={chip.edgeId && chip.kind === "flow" ? () => onOpenFlow(chip.edgeId as string) : undefined}
        onKeyDown={
          chip.edgeId && chip.kind === "flow"
            ? (e) => {
                if (e.key === "Enter") onOpenFlow(chip.edgeId as string);
              }
            : undefined
        }
      >
        {chip.text}
      </div>
    ))}
  </>
);
