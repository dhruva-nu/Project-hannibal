import type { ArchModel } from "../engine";
import { fitView } from "../view/geometry";
import { visibleNodes } from "../view/visibility";
import type { ConfirmRequest } from "./archApi";
import type { ModelStore } from "./useModelStore";
import type { StageSize } from "./useScopeView";

interface LoaderDeps {
  store: Pick<ModelStore, "replaceModel" | "setViews">;
  getStageSize: () => StageSize;
  onReset: () => void;
  confirm: (request: ConfirmRequest) => void;
}

export const useDiagramLoader = ({ store, getStageSize, onReset, confirm }: LoaderDeps) => {
  const loadDiagram = (next: ArchModel) => {
    store.replaceModel(next);
    const stage = getStageSize();
    store.setViews(() => ({ overview: fitView(visibleNodes(next, null), stage.width, stage.height) }));
    onReset();
  };

  const confirmReplace = (message: string, confirmLabel: string, build: () => ArchModel) =>
    confirm({ message, confirmLabel, onConfirm: () => loadDiagram(build()) });

  return { loadDiagram, confirmReplace };
};
