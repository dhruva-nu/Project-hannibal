import { BrandMark } from "@/shared/components/atoms/BrandMark/BrandMark";
import { ThemeToggle } from "@/shared/components/atoms/ThemeToggle/ThemeToggle";
import type { Theme } from "@/shared/types";
import { ToolButton } from "../ui/Controls";
import styles from "../ArchTest.module.css";

interface TopBarProps {
  title: string;
  zoomPercent: number;
  theme: Theme;
  showFlow: boolean;
  showStateLinks: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTitleChange: (title: string) => void;
  onOpenMenu: (kind: "add" | "file", anchor: HTMLElement) => void;
  onGroup: () => void;
  onToggleFlow: () => void;
  onToggleStateLinks: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (direction: "in" | "out") => void;
  onFit: () => void;
  onToggleTheme: () => void;
}

export const TopBar = (props: TopBarProps) => (
  <header className={styles.topbar}>
    <a className={styles.brand} href="/home" aria-label="Home">
      <BrandMark />
    </a>
    <span className={styles.crumb}>
      /<b>arch-test</b>
    </span>
    <input
      className={styles.title}
      aria-label="Diagram name"
      value={props.title}
      onChange={(e) => props.onTitleChange(e.target.value)}
    />
    <span className={styles.separator} />
    <ToolButton onClick={(e) => props.onOpenMenu("add", e.currentTarget)}>Add &#9662;</ToolButton>
    <ToolButton title="Group the selected components" onClick={props.onGroup}>
      Group
    </ToolButton>
    <span className={styles.separator} />
    <ToolButton title="Show the data flowing through each connection" on={props.showFlow} aria-pressed={props.showFlow} onClick={props.onToggleFlow}>
      Data flow
    </ToolButton>
    <ToolButton title="Show which components read or modify state" on={props.showStateLinks} aria-pressed={props.showStateLinks} onClick={props.onToggleStateLinks}>
      State links
    </ToolButton>
    <span className={styles.separator} />
    <ToolButton disabled={!props.canUndo} onClick={props.onUndo}>
      Undo
    </ToolButton>
    <ToolButton disabled={!props.canRedo} onClick={props.onRedo}>
      Redo
    </ToolButton>
    <span className={styles.grow} />
    <ToolButton aria-label="Zoom out" onClick={() => props.onZoom("out")}>
      &minus;
    </ToolButton>
    <span className={styles.zoomValue}>{props.zoomPercent}%</span>
    <ToolButton aria-label="Zoom in" onClick={() => props.onZoom("in")}>
      +
    </ToolButton>
    <ToolButton onClick={props.onFit}>Fit</ToolButton>
    <ToolButton onClick={(e) => props.onOpenMenu("file", e.currentTarget)}>File &#9662;</ToolButton>
    <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />
  </header>
);
