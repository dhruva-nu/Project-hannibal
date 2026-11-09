import { useState } from "react";
import { FRAMEWORKS, type ServiceNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { ToolButton } from "../../ui/Controls";
import { BoundSelect, BoundText } from "../panel/Bound";
import { ConnectionList } from "../panel/ConnectionList";
import { useEditor } from "../panel/panelEditor";
import { Modal } from "../overlays/Modal";
import { ControllerTab } from "./ControllerTab";
import { ServiceLayerTab } from "./ServiceLayerTab";
import { Tabs } from "./Tabs";
import styles from "./popup.module.css";

type TabId = "controller" | "service";

const TABS: ReadonlyArray<readonly [TabId, string]> = [
  ["controller", "Controller"],
  ["service", "Service layer"],
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
      <Tabs tabs={TABS} current={tab} onChange={setTab} />
      {tab === "controller" ? <ControllerTab node={node} editor={editor} /> : <ServiceLayerTab node={node} editor={editor} />}
      <ConnectionList nodeId={node.id} />
    </Modal>
  );
};
