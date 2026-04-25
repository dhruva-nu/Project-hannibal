import React from "react";
import { BoardChrome } from "@/shared/components/molecules";
import styles from "./CanvasBoard.module.css";

interface BoardTab {
  label: string;
  active?: boolean;
}

interface CanvasBoardProps {
  tabs: BoardTab[];
  metaLabel?: string;
  children: React.ReactNode;
}

/**
 * The outer shell of the interactive diagram+chat panel.
 * Renders the dotted grid background, chrome header, and body slot.
 */
export const CanvasBoard = ({ tabs, metaLabel, children }: CanvasBoardProps) => {
  return (
    <div className={styles.board}>
      <BoardChrome tabs={tabs} metaLabel={metaLabel} />
      <div className={styles.body}>{children}</div>
    </div>
  );
};
