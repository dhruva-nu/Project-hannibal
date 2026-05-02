import type { PortPosition } from "@/shared/components/atoms/PortDot/PortDot";
export type { PortPosition };

export type PaletteKind = "component" | "service" | "module";

export interface BoardModule {
  id: string;
  label: string;
}

export interface BoardNodeData {
  id: string;
  type: "component" | "service";
  x: number;
  y: number;
  w?: number;
  label: string;
  modules?: BoardModule[];
}

export interface EdgeEndpoint {
  nodeId: string;
  moduleId?: string;
  port: PortPosition;
}

export interface BoardEdge {
  id: string;
  from: EdgeEndpoint;
  to: EdgeEndpoint;
}

export interface PendingEdge {
  fromNodeId: string;
  fromModuleId?: string;
  fromPort: PortPosition;
  x: number;
  y: number;
}

export interface SelectedItem {
  kind: "node" | "service" | "module" | "edge";
  id: string;
  moduleId?: string;
}

export interface PaletteEntry {
  kind: PaletteKind;
  label: string;
}

export interface PaletteSection {
  title: string;
  items: PaletteEntry[];
  tip?: string;
  addKind?: PaletteKind;
}
