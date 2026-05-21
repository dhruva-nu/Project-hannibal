import { NavBrand, ThemeToggle } from "@/shared/components";
import type { Theme } from "@/shared/types";
import { NAV_SECTIONS } from "./storyboard.data";
import styles from "./Storyboard.module.css";

interface StoryboardSidebarProps {
  activeSection: string;
  theme: Theme;
  toggleTheme: () => void;
  onScrollTo: (id: string) => void;
}

export const StoryboardSidebar = ({ activeSection, theme, toggleTheme, onScrollTo }: StoryboardSidebarProps) => (
  <aside className={styles.sidebar}>
    <div className={styles.sidebarBrand}>
      <NavBrand />
      <div className={styles.divRow} />
      <span className={styles.sidebarTitle}>Component Library</span>
      <span className={styles.sidebarSub}>// atomic design · v1</span>
    </div>

    <nav className={styles.sidebarNav} aria-label="Storyboard sections">
      {NAV_SECTIONS.map((sec) => (
        <div key={sec.id}>
          <div className={styles.navSection}>{sec.label}</div>
          <button
            className={[styles.navItem, activeSection === sec.id ? styles.navItemActive : ""].filter(Boolean).join(" ")}
            onClick={() => onScrollTo(sec.id)}
            type="button"
          >
            <span className={styles.navDot} style={{ background: sec.color }} />
            {sec.label}
          </button>
        </div>
      ))}
    </nav>

    <div className={styles.themeRow}>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </div>
  </aside>
);
