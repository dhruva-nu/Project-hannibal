/* ── Theme ── */
export type Theme = "light" | "dark";

export type AccentPalette = "highlighter" | "coral" | "lime" | "blueprint";

/* ── Chat ── */
export type MessageRole = "user" | "ai";

export interface ChatSegment {
  type: "text" | "code" | "underline";
  value: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  /** Plain text content (user messages) */
  text?: string;
  /** Rich typed segments (AI messages) */
  segments?: ChatSegment[];
}

/* ── Diagram ── */
export interface DiagramNodeData {
  id: string;
  label: string;
  icon?: string;
  sub?: string;
  tag?: string;
  x: number;
  y: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  color?: string;
  dashArray?: string;
}

/* ── Course chip ── */
export interface CourseChip {
  name: string;
  color: string;
}

/* ── How-it-works step ── */
export interface HowStep {
  num: string;
  title: string;
  desc: string;
  hasArrow?: boolean;
}

/* ── Auth flow swimlane ── */
export type ArrowDirection = "outgoing" | "incoming" | "none";

export interface SwimLaneStep {
  id: string;
  label: string;
  labelNum?: string;
  packet: string;
  packetVariant?: "default" | "accent" | "coral" | "green";
  direction: ArrowDirection;
  sideLabel?: string;
}

/* ── Nav links ── */
export interface NavLink {
  label: string;
  href: string;
}

/* ── Trust pill ── */
export interface TrustItem {
  label: string;
}

/* ── Tabs ── */
export interface TabItem {
  id: string;
  label: string;
}
