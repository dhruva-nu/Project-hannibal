import { isContainer } from "./registry";
import type { ArchNode } from "./types";

/** Card geometry shared with canvas.module.css (--card-head, --card-line, --card-pad). */
export const CARD_HEAD = 38;
export const CARD_LINE = 24;
export const CARD_PAD = 20;
export const MAX_TABLE_LINES = 7;

const countIf = (condition: boolean): number => (condition ? 1 : 0);

export const contentLines = (n: ArchNode): number => {
  switch (n.type) {
    case "service":
      return n.cfg.endpoints.length;
    case "component":
      return 1 + n.cfg.state.length + countIf(n.cfg.reads.length > 0) + countIf(n.cfg.writes.length > 0);
    case "function":
      return 2 + countIf(n.cfg.writes.length > 0);
    case "sqldb":
      return Math.min(MAX_TABLE_LINES, n.cfg.tables.length);
    case "nosql":
      return Math.min(MAX_TABLE_LINES, n.cfg.collections.length);
    default:
      return 1;
  }
};

/** Height that fits a card's content exactly, or null for boxes the user sizes (containers, layer cards). */
export const fittedHeight = (n: ArchNode): number | null => {
  if (n.type === "layer" || isContainer(n)) return null;
  return CARD_HEAD + CARD_PAD + Math.max(1, contentLines(n)) * CARD_LINE;
};
