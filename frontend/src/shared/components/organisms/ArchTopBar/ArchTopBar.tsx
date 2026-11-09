import type { ReactNode } from "react";
import { BrandMark } from "@/shared/components/atoms/BrandMark/BrandMark";
import { ThemeToggle } from "@/shared/components/atoms/ThemeToggle/ThemeToggle";
import type { Theme } from "@/shared/types";
import { ToolButton } from "@/shared/components/atoms";
import styles from "./ArchTopBar.module.css";

interface TopBarProps {
  title: string;
  zoomPercent: number;
  theme: Theme;
  showFlow: boolean;
  showStateLinks: boolean;
  showStore: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTitleChange: (title: string) => void;
  onOpenMenu: (kind: "add" | "file", anchor: HTMLElement) => void;
  onGroup: () => void;
  onToggleFlow: () => void;
  onToggleStateLinks: () => void;
  onToggleStore: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (direction: "in" | "out") => void;
  onFit: () => void;
  onToggleTheme: () => void;
}

const Cluster = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className={styles.cluster} role="group" aria-label={label}>
    {children}
  </div>
);

const ArrowIcon = ({ flip }: { flip?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <path d="M6 3 2 7l4 4M2.5 7H10a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Toggle = ({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: ReactNode }) => (
  <ToolButton title={title} active={on} aria-pressed={on} onClick={onClick}>
    {children}
  </ToolButton>
);

export const ArchTopBar = (props: TopBarProps) => (
  <header className={styles.topbar}>
    <a className={styles.brand} href="/home" aria-label="Home">
      <BrandMark />
    </a>
    <input
      className={styles.title}
      aria-label="Diagram name"
      value={props.title}
      onChange={(e) => props.onTitleChange(e.target.value)}
    />
    <Cluster label="Edit">
      <ToolButton onClick={(e) => props.onOpenMenu("add", e.currentTarget)}>+ Add &#9662;</ToolButton>
      <ToolButton title="Group the selected components" onClick={props.onGroup}>
        Group
      </ToolButton>
      <ToolButton aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!props.canUndo} onClick={props.onUndo}>
        <ArrowIcon />
      </ToolButton>
      <ToolButton aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={props.onRedo}>
        <ArrowIcon flip />
      </ToolButton>
    </Cluster>
    <Cluster label="Show">
      <Toggle on={props.showStore} title="Show the app-wide state panel" onClick={props.onToggleStore}>
        App state
      </Toggle>
      <Toggle on={props.showFlow} title="Show the data flowing through each connection" onClick={props.onToggleFlow}>
        Data flow
      </Toggle>
      <Toggle on={props.showStateLinks} title="Link what sets a variable to what reads it" onClick={props.onToggleStateLinks}>
        State links
      </Toggle>
    </Cluster>
    <span className={styles.grow} />
    <Cluster label="Zoom">
      <ToolButton aria-label="Zoom out" onClick={() => props.onZoom("out")}>
        &minus;
      </ToolButton>
      <span className={styles.zoomValue}>{props.zoomPercent}%</span>
      <ToolButton aria-label="Zoom in" onClick={() => props.onZoom("in")}>
        +
      </ToolButton>
      <ToolButton onClick={props.onFit}>Fit</ToolButton>
    </Cluster>
    <ToolButton onClick={(e) => props.onOpenMenu("file", e.currentTarget)}>File &#9662;</ToolButton>
    <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />
  </header>
);
