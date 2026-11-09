import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { PaperBg } from "@/shared/components/atoms/PaperBg/PaperBg";
import { useTheme } from "@/hooks/useTheme";
import type { PlacedType, Snapshot } from "./engine";
import { Canvas } from "./components/canvas/Canvas";
import { ArchMenu, type OpenMenu } from "./components/menus/ArchMenu";
import { ModalHost } from "./components/overlays/ModalHost";
import { TraceDrawer } from "./components/overlays/TraceDrawer";
import { InspectorPanel } from "./components/panel/Panel";
import { StorePanel } from "./components/store/StorePanel";
import { Toast } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { ArchContext } from "./state/archApi";
import { modelFromImport } from "./state/importModel";
import { useArchController } from "./state/useArchController";
import styles from "./ArchTest.module.css";

const DEFAULT_STAGE = { width: 900, height: 600 };
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export const ArchTest = () => {
  const stageRef = useRef<HTMLDivElement>(null);
  const getStageSize = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { width: rect?.width || DEFAULT_STAGE.width, height: rect?.height || DEFAULT_STAGE.height };
  }, []);
  const controller = useArchController(getStageSize);
  const { api, view } = controller;
  const { theme, toggleTheme } = useTheme();
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const openMenu = (kind: OpenMenu["kind"], anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setMenu((current) => (current?.anchorElement === anchor ? null : { kind, anchorElement: anchor, left: rect.left, bottom: rect.bottom }));
  };

  const connectDragged = (fromId: string, toId: string, endpointId?: string) => {
    const involvesLayer = [fromId, toId].some((id) => api.model.lnodes.some((n) => n.id === id));
    if (involvesLayer) api.openModal({ kind: "picker", fromId, toId });
    else api.connect(fromId, toId, true, endpointId);
  };

  const addNode = (type: PlacedType) => {
    setMenu(null);
    controller.addNode(type);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (controller.modal) return;
      if (menu) setMenu(null);
      else controller.closeOrDeselect();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && TYPING_TAGS.has(target.tagName)) return;
    const isModifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (isModifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) controller.redo();
      else api.undo();
    } else if (isModifier && key === "y") {
      event.preventDefault();
      controller.redo();
    } else if ((event.key === "Delete" || event.key === "Backspace") && api.selection.type) {
      event.preventDefault();
      api.askDeleteSelection();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const importDiagram = (diagram: Snapshot) => controller.loadDiagram(modelFromImport(diagram, api.model.name));

  return (
    <ArchContext.Provider value={api}>
      <div className={styles.page} data-theme-root={theme}>
        <PaperBg />
        <TopBar
          title={api.model.name}
          zoomPercent={Math.round(view.view.k * 100)}
          theme={theme}
          showFlow={controller.showFlow}
          showStateLinks={controller.showStateLinks}
          showStore={controller.showStore}
          canUndo={controller.canUndo}
          canRedo={controller.canRedo}
          onTitleChange={controller.setName}
          onOpenMenu={openMenu}
          onGroup={api.groupSelected}
          onToggleFlow={controller.toggleFlow}
          onToggleStateLinks={controller.toggleStateLinks}
          onToggleStore={controller.toggleStore}
          onUndo={api.undo}
          onRedo={controller.redo}
          onZoom={view.zoomFromCenter}
          onFit={view.fit}
          onToggleTheme={toggleTheme}
        />
        <div className={styles.main}>
          {controller.showStore && <StorePanel onClose={controller.toggleStore} />}
          <div className={styles.center}>
            <Canvas
              stageRef={stageRef}
              controller={controller}
              onOpenInsertMenu={(anchor) => openMenu("insert", anchor)}
              onConnect={connectDragged}
            />
            <TraceDrawer />
          </div>
          <InspectorPanel />
        </div>
        <ArchMenu
          menu={menu}
          scope={api.scope}
          onClose={() => setMenu(null)}
          onAdd={addNode}
          onInsert={(type) => {
            const edgeId = api.selection.type === "edge" ? api.selection.ids[0] : null;
            setMenu(null);
            if (edgeId) api.insertOnEdge(edgeId, type);
          }}
          onLoadExample={() => {
            setMenu(null);
            controller.loadExample();
          }}
          onNewBlank={() => {
            setMenu(null);
            controller.newBlank();
          }}
          onOpenIo={() => {
            setMenu(null);
            api.openModal({ kind: "io" });
          }}
        />
        <ModalHost modal={controller.modal} onClose={api.closeModal} onLoadDiagram={importDiagram} />
        <Toast notice={controller.notice} onDismiss={controller.dismissNotice} />
      </div>
    </ArchContext.Provider>
  );
};
