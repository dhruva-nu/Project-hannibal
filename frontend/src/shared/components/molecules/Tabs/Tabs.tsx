import type { TabItem } from "@/shared/types";
import { classNames } from "@/shared/utils/classNames";
import styles from "./Tabs.module.css";

interface TabsProps<Id extends string> {
  tabs: ReadonlyArray<TabItem<Id>>;
  activeId: Id;
  onChange: (id: Id) => void;
  variant?: "pill" | "underline";
}

export const Tabs = <Id extends string>({ tabs, activeId, onChange, variant = "pill" }: TabsProps<Id>) => (
  <div className={styles[variant]} role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        role="tab"
        aria-selected={tab.id === activeId}
        className={classNames(styles.tab, tab.id === activeId && styles.active)}
        onClick={() => onChange(tab.id)}
        type="button"
      >
        {tab.label}
      </button>
    ))}
  </div>
);
