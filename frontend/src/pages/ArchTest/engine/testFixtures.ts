import { mkEdge, mkNode } from "./model";
import { starter } from "./starter";
import type { ArchEdge, ArchModel, MapRow, PlacedNode, PlacedType } from "./types";

export const byName = <T extends PlacedNode>(model: ArchModel, name: string): T => {
  const found = model.nodes.find((n) => n.name === name);
  if (!found) throw new Error("fixture node missing: " + name);
  return found as T;
};

export const addNode = <T extends PlacedNode>(
  model: ArchModel,
  type: PlacedType,
  name: string,
  cfg: Record<string, unknown> = {},
  options: { x?: number; y?: number; w?: number; h?: number } = {},
): T => {
  const created = mkNode(type, options.x ?? 0, options.y ?? 0, { name, cfg, w: options.w, h: options.h });
  model.nodes.push(created);
  return created as T;
};

export const link = (model: ArchModel, from: PlacedNode, to: PlacedNode, map: MapRow[] = []): ArchEdge => {
  const created = mkEdge(from.id, to.id, map);
  model.edges.push(created);
  return created;
};

export const removeEdgeBetween = (model: ArchModel, from: PlacedNode, to: PlacedNode): void => {
  model.edges = model.edges.filter((e) => !(e.from === from.id && e.to === to.id));
};

export const starterModel = (): ArchModel => starter();
