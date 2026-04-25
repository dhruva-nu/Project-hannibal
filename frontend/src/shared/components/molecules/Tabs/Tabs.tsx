import type { TabItem } from "@/shared/types";
import styles from "./Tabs.module.css";

interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
}

export const Tabs = ({ tabs, activeId, onChange }: TabsProps) => {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={[styles.tab, tab.id === activeId ? styles.active : ""].filter(Boolean).join(" ")}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};
