import { useState } from "react";
import { PaletteItem } from "@/shared/components/molecules/PaletteItem/PaletteItem";
import type { PaletteKind, PaletteSection } from "@/shared/types/board";
import styles from "./DesignPalette.module.css";

interface DesignPaletteProps {
  sections: PaletteSection[];
  onAddCustom: (label: string, kind: PaletteKind) => void;
}

export const DesignPalette = ({ sections, onAddCustom }: DesignPaletteProps) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commit = (section: PaletteSection) => {
    const trimmed = draft.trim();
    if (trimmed && section.addKind) onAddCustom(trimmed, section.addKind);
    setEditing(null);
    setDraft("");
  };

  return (
    <aside className={styles.palette} aria-label="Component palette">
      {sections.map(section => (
        <div key={section.title}>
          <h3 className={styles.heading}>{section.title}</h3>
          <div className={styles.group}>
            {section.items.map(item => (
              <PaletteItem key={item.label} kind={item.kind} label={item.label} />
            ))}
            {section.addKind && (
              editing === section.title ? (
                <input
                  className={styles.inlineInput}
                  value={draft}
                  autoFocus
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") commit(section);
                    if (e.key === "Escape") { setEditing(null); setDraft(""); }
                  }}
                  onBlur={() => commit(section)}
                  placeholder="label…"
                  aria-label={`New ${section.addKind} label`}
                />
              ) : (
                <button
                  type="button"
                  className={styles.addBtn}
                  onClick={() => { setEditing(section.title); setDraft(""); }}
                  aria-label={`Add custom ${section.addKind}`}
                >
                  +
                </button>
              )
            )}
          </div>
          {section.tip && <p className={styles.tip}>{section.tip}</p>}
        </div>
      ))}
    </aside>
  );
};
