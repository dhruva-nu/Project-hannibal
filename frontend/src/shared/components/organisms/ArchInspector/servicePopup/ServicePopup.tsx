import type { TabItem } from "@/shared/types";
import { useState } from "react";
import { FRAMEWORKS, type ServiceNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { ToolButton } from "@/shared/components/atoms";
import { BoundSelect, BoundText } from "../Bound";
import { ConnectionList } from "../ConnectionList";
import { useEditor } from "../panelEditor";
import { Modal } from "@/shared/components/molecules";
import { ControllerTab } from "./ControllerTab";
import { ServiceLayerTab } from "./ServiceLayerTab";
import { Tabs } from "@/shared/components/molecules";
import styles from "./popup.module.css";

type TabId = "controller" | "service";

const TABS: ReadonlyArray<TabItem<TabId>> = [
  { id: "controller", label: "Controller" },
  { id: "service", label: "Service layer" },
];

export const ServicePopup = ({ node, onClose }: { node: ServiceNode; onClose: () => void }) => {
  const { askDeleteSelection } = useArch();
  const editor = useEditor("node", node.id);
  const [tab, setTab] = useState<TabId>("controller");
  return (
    <Modal title={node.name} wide onClose={onClose}>
      <div className={styles.header}>
        <BoundText editor={editor} path="name" value={node.name} aria-label="Service name" />
        <BoundSelect editor={editor} path="cfg.framework" value={node.cfg.framework} options={FRAMEWORKS} aria-label="Framework" />
        <ToolButton small danger onClick={askDeleteSelection}>
          Delete
        </ToolButton>
      </div>
      <Tabs tabs={TABS} activeId={tab} onChange={setTab} variant="underline" />
      {tab === "controller" ? <ControllerTab node={node} editor={editor} /> : <ServiceLayerTab node={node} editor={editor} />}
      <ConnectionList nodeId={node.id} />
    </Modal>
  );
};
