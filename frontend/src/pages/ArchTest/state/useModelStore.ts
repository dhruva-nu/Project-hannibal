import { useCallback, useEffect, useRef, useState } from "react";
import type { ArchModel, View } from "../engine";
import {
  applySnapshot,
  canRedo,
  canUndo,
  checkpoint,
  clone,
  createHistory,
  DEFAULT_VIEW,
  loadSaved,
  normalize,
  redo,
  save,
  snapshotOf,
  starter,
  undo,
} from "../engine";
import type { ModelMutator } from "./archApi";

const PERSIST_DELAY_MS = 300;

export const readStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const initialModel = (storage: Storage | null): ArchModel => {
  const model = (storage ? loadSaved(storage) : null) ?? starter();
  normalize(model);
  return model;
};

export type ViewMap = Record<string, View>;

export interface ModelStore {
  model: ArchModel;
  views: ViewMap;
  setViews: (update: (views: ViewMap) => ViewMap) => void;
  commit: (mutator: ModelMutator, coalesceKey?: string) => void;
  /** Replace the whole diagram as one undoable step (load example, blank, import). */
  replaceModel: (next: ArchModel) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setName: (name: string) => void;
}

export const useModelStore = (storage: Storage | null): ModelStore => {
  const [model, setModel] = useState(() => initialModel(storage));
  const [views, setViewMap] = useState<ViewMap>(() => ({ overview: { ...DEFAULT_VIEW }, ...model.views }));
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });
  const modelRef = useRef(model);
  const historyRef = useRef(createHistory());

  const publish = useCallback((next: ArchModel) => {
    modelRef.current = next;
    setModel(next);
    const history = historyRef.current;
    setAvailability({ canUndo: canUndo(history), canRedo: canRedo(history) });
  }, []);

  const commit = useCallback(
    (mutator: ModelMutator, coalesceKey?: string) => {
      const base = modelRef.current;
      checkpoint(historyRef.current, () => snapshotOf(base), coalesceKey, Date.now());
      const draft = clone(base);
      mutator(draft);
      normalize(draft);
      publish(draft);
    },
    [publish],
  );

  const replaceModel = useCallback(
    (next: ArchModel) => {
      const base = modelRef.current;
      checkpoint(historyRef.current, () => snapshotOf(base), undefined, Date.now());
      normalize(next);
      publish(next);
    },
    [publish],
  );

  const restoreWith = useCallback(
    (step: typeof undo) => {
      const base = modelRef.current;
      const snapshot = step(historyRef.current, snapshotOf(base));
      if (snapshot === null) return;
      const draft = clone(base);
      applySnapshot(draft, snapshot);
      publish(draft);
    },
    [publish],
  );

  const setName = useCallback(
    (name: string) => {
      const draft = clone(modelRef.current);
      draft.name = name;
      publish(draft);
    },
    [publish],
  );

  useEffect(() => {
    if (!storage) return undefined;
    const timer = window.setTimeout(
      () => save(storage, { ...model, view: views.overview ?? model.view, views }),
      PERSIST_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [storage, model, views]);

  return {
    model,
    views,
    setViews: setViewMap,
    commit,
    replaceModel,
    undo: () => restoreWith(undo),
    redo: () => restoreWith(redo),
    canUndo: availability.canUndo,
    canRedo: availability.canRedo,
    setName,
  };
};
