import type { ArchModel, LayerNode, PlacedNode } from "../engine";
import { DEFAULT_VIEW } from "../engine";

export interface ImportedDiagram {
  name?: string;
  nodes: PlacedNode[];
  edges?: ArchModel["edges"];
  groups?: ArchModel["groups"];
  lnodes?: LayerNode[];
}

export const modelFromImport = (imported: ImportedDiagram, fallbackName: string): ArchModel => ({
  name: imported.name || fallbackName,
  nodes: imported.nodes,
  edges: imported.edges ?? [],
  groups: imported.groups ?? [],
  lnodes: imported.lnodes ?? [],
  view: { ...DEFAULT_VIEW },
  views: { overview: { ...DEFAULT_VIEW } },
});
