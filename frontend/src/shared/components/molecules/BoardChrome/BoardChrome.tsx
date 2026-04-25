import { LiveDot } from "@/shared/components/atoms";
import styles from "./BoardChrome.module.css";

interface BoardTab {
  label: string;
  active?: boolean;
}

interface BoardChromeProps {
  tabs: BoardTab[];
  metaLabel?: string;
}

export const BoardChrome = ({ tabs, metaLabel = "tutor · live" }: BoardChromeProps) => {
  return (
    <div className={styles.chrome}>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <span
            key={tab.label}
            className={[styles.tab, tab.active ? styles.tabActive : ""].filter(Boolean).join(" ")}
          >
            {tab.label}
          </span>
        ))}
      </div>
      <div className={styles.meta}>
        <LiveDot />
        <span>{metaLabel}</span>
      </div>
    </div>
  );
};
