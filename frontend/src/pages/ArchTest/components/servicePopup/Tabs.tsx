import styles from "./popup.module.css";

interface Props<T extends string> {
  tabs: ReadonlyArray<readonly [T, string]>;
  current: T;
  onChange: (id: T) => void;
}

export const Tabs = <T extends string>({ tabs, current, onChange }: Props<T>) => (
  <div className={styles.tabs} role="tablist">
    {tabs.map(([id, label]) => (
      <button key={id} type="button" role="tab" className={styles.tab} aria-selected={current === id} onClick={() => onChange(id)}>
        {label}
      </button>
    ))}
  </div>
);
