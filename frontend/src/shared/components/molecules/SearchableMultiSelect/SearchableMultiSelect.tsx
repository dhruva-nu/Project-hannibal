import { useEffect, useRef, useState } from "react";
import { matchingOptions } from "./matchingOptions";
import styles from "./SearchableMultiSelect.module.css";

interface SearchableMultiSelectProps {
  options: readonly string[];
  selected: readonly string[];
  onToggle: (option: string) => void;
  singleChoice?: boolean;
  placeholder: string;
  "aria-label": string;
}

export const SearchableMultiSelect = ({ options, selected, onToggle, singleChoice, placeholder, ...aria }: SearchableMultiSelectProps) => {
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
    if (singleChoice) setOpen(false);
  };
  return (
    <div ref={rootRef} className={styles.root}>
      <button type="button" className={styles.trigger} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} {...aria}>
        <span>{selected.length ? selected.join(", ") : placeholder}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={styles.popover}>
          <input
            className={styles.search}
            autoFocus
            placeholder="Search…"
            aria-label="Search options"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div role="listbox" aria-multiselectable={!singleChoice}>
            {shown.map((option) => (
              <label key={option} role="option" aria-selected={selected.includes(option)} className={styles.option}>
                <input type={singleChoice ? "radio" : "checkbox"} checked={selected.includes(option)} onChange={() => pick(option)} />
                {option}
              </label>
            ))}
            {!shown.length && <div className={styles.empty}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
};
