import type { ArchModel, ArchNode } from "../engine";
import type { Point } from "./geometry";

export interface Size {
  w: number;
  h: number;
}

/** Transient geometry while a drag or resize is in flight; committed to the model on release. */
export interface GeometryOverrides {
  positions: Record<string, Point>;
  sizes: Record<string, Size>;
}

export const NO_OVERRIDES: GeometryOverrides = { positions: {}, sizes: {} };

const withOverrides = <T extends ArchNode>(item: T, overrides: GeometryOverrides): T => {
  const position = overrides.positions[item.id];
  const size = overrides.sizes[item.id];
  return position || size ? { ...item, ...position, ...size } : item;
};

export const applyOverrides = (model: ArchModel, overrides: GeometryOverrides): ArchModel => {
  if (overrides === NO_OVERRIDES) return model;
  return {
    ...model,
    nodes: model.nodes.map((n) => withOverrides(n, overrides)),
    lnodes: model.lnodes.map((n) => withOverrides(n, overrides)),
  };
};
