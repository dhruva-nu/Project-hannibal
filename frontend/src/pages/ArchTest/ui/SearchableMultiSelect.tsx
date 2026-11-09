import { useEffect, useRef, useState } from "react";
import styles from "./controls.module.css";

interface Props {
  options: readonly string[];
  selected: readonly string[];
  onToggle: (option: string) => void;
  /** Picking an option replaces the selection and closes the list. */
  single?: boolean;
  placeholder: string;
  "aria-label": string;
}

export const matchingOptions = (options: readonly string[], search: string): string[] => {
  const needle = search.trim().toLowerCase();
  return options.filter((o) => o.toLowerCase().includes(needle));
};

export const SearchableMultiSelect = ({ options, selected, onToggle, single, placeholder, ...aria }: Props) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [open]);

  const shown = matchingOptions(options, search);
  const pick = (option: string) => {
    onToggle(option);
    if (single) setOpen(false);
  };
  return (
    <div ref={rootRef} className={styles.multiSelect}>
      <button type="button" className={styles.multiTrigger} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} {...aria}>
        <span>{selected.length ? selected.join(", ") : placeholder}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={styles.multiPopover}>
          <input
            className={styles.multiSearch}
            autoFocus
            placeholder="Search…"
            aria-label="Search options"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div role="listbox" aria-multiselectable={!single}>
            {shown.map((option) => (
              <label key={option} role="option" aria-selected={selected.includes(option)} className={styles.multiOption}>
                <input type={single ? "radio" : "checkbox"} checked={selected.includes(option)} onChange={() => pick(option)} />
                {option}
              </label>
            ))}
            {!shown.length && <div className={styles.multiEmpty}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
};
