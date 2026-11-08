import { DEFAULT_VIEW, normalize } from "./model";
import type { ArchModel, Snapshot, View } from "./types";

export const STORAGE_KEY = "arch-designer-v1";
const UNTITLED_NAME = "Untitled architecture";

export const snapshotOf = (model: ArchModel): string =>
  JSON.stringify({
    name: model.name,
    nodes: model.nodes,
    edges: model.edges,
    groups: model.groups,
    lnodes: model.lnodes,
  });

export const applySnapshot = (model: ArchModel, snapshot: string): void => {
  const parsed = JSON.parse(snapshot) as Snapshot;
  model.name = parsed.name;
  model.nodes = parsed.nodes;
  model.edges = parsed.edges;
  model.groups = parsed.groups;
  if (parsed.lnodes) model.lnodes = parsed.lnodes;
  normalize(model);
};

const parseSaved = (text: string): ArchModel | null => {
  const saved = JSON.parse(text) as Partial<ArchModel> | null;
  if (!saved || !Array.isArray(saved.nodes) || !saved.nodes.length) return null;
  const views: Record<string, View> = saved.views ?? {};
  const overview = views.overview ?? saved.view ?? { ...DEFAULT_VIEW };
  views.overview = overview;
  const model: ArchModel = {
    name: saved.name || UNTITLED_NAME,
    nodes: saved.nodes,
    edges: saved.edges ?? [],
    groups: saved.groups ?? [],
    lnodes: saved.lnodes ?? [],
    view: overview,
    views,
  };
  normalize(model);
  return model;
};

export const loadSaved = (storage: Storage): ArchModel | null => {
  try {
    const text = storage.getItem(STORAGE_KEY);
    return text ? parseSaved(text) : null;
  } catch {
    return null;
  }
};

export const save = (storage: Storage, model: ArchModel): boolean => {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(model));
    return true;
  } catch {
    return false;
  }
};
