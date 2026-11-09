import { findNode as findModelNode, findGroup, isSidebarNode } from "@/pages/ArchTest/engine";
import { NO_SELECTION, useArch } from "@/pages/ArchTest/state/archApi";
import { DbPopup } from "./dbPopup/DbPopup";
import { ServicePopup } from "./servicePopup/ServicePopup";
import { ToolButton } from "@/shared/components/atoms";
import { EdgePanel } from "./EdgePanel";
import { GroupPanel } from "./GroupPanel";
import { NodePanel } from "./NodePanel";
import { OverviewEdgePanel } from "./OverviewEdgePanel";
import { PanelHeader } from "./PanelHeader";
import styles from "./panel.module.css";

const MultiSelectHeader = ({ count }: { count: number }) => {
  const { groupSelected, askDeleteSelection } = useArch();
  return (
    <PanelHeader
      title={`${count} components selected`}
      subtitle="Move them together or group them"
      actions={
        <>
          <ToolButton small onClick={groupSelected}>
            Group
          </ToolButton>
          <ToolButton small danger onClick={askDeleteSelection}>
            Delete
          </ToolButton>
        </>
      }
    />
  );
};

const SelectedContent = () => {
  const { model, selection, edgeById } = useArch();
  const firstId = selection.ids[0];
  if (selection.type === "node") {
    if (selection.ids.length > 1) return <MultiSelectHeader count={selection.ids.length} />;
    const selected = findModelNode(model, firstId);
    if (!isSidebarNode(selected)) return null;
    return <NodePanel key={selected.id} node={selected} />;
  }
  if (selection.type === "edge") {
    const edge = edgeById(firstId);
    if (!edge) return null;
    return edge.derived ? <OverviewEdgePanel edge={edge} /> : <EdgePanel key={edge.id} edge={edge} />;
  }
  const group = findGroup(model, firstId);
  return group ? <GroupPanel key={group.id} group={group} /> : null;
};

export const ArchInspector = () => {
  const { model, selection, select } = useArch();
  if (!selection.type || !selection.ids.length) return null;
  const selected = selection.type === "node" && selection.ids.length === 1 ? findModelNode(model, selection.ids[0]) : undefined;
  if (selected?.type === "service") {
    return <ServicePopup key={selected.id} node={selected} onClose={() => select(NO_SELECTION)} />;
  }
  if (selected?.type === "sqldb" || selected?.type === "nosql") {
    return <DbPopup key={selected.id} node={selected} onClose={() => select(NO_SELECTION)} />;
  }
  return (
    <aside className={styles.panel} aria-label="Inspector">
      <SelectedContent />
    </aside>
  );
};
