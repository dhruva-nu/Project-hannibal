import type { ArchModel, LayerNode, PlacedNode, StateVar } from "../engine";
import { DEFAULT_VIEW } from "../engine";

export interface ImportedDiagram {
  name?: string;
  store?: StateVar[];
  nodes: PlacedNode[];
  edges?: ArchModel["edges"];
  groups?: ArchModel["groups"];
  lnodes?: LayerNode[];
}

export const modelFromImport = (imported: ImportedDiagram, fallbackName: string): ArchModel => ({
  name: imported.name || fallbackName,
  store: imported.store ?? [],
  nodes: imported.nodes,
  edges: imported.edges ?? [],
  groups: imported.groups ?? [],
  lnodes: imported.lnodes ?? [],
  view: { ...DEFAULT_VIEW },
  views: { overview: { ...DEFAULT_VIEW } },
});
