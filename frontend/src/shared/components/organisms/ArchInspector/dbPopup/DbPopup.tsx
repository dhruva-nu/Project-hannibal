import { useState } from "react";
import type { NosqlNode, SqlNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { ToolButton } from "@/shared/components/atoms";
import { Modal } from "@/shared/components/molecules";
import { BoundSelect, BoundText } from "../Bound";
import { ConnectionList } from "../ConnectionList";
import { CollectionsSection } from "./NosqlSections";
import { useEditor, type Editor } from "../panelEditor";
import { ProceduresSection, RelationshipsSection, TablesSection } from "./SqlSections";
import { useOpenSet } from "../useOpenSet";
import { Tabs } from "@/shared/components/molecules";
import type { TabItem } from "@/shared/types";
import styles from "../servicePopup/popup.module.css";

const SQL_ENGINES = ["PostgreSQL", "MySQL", "SQLite", "SQL Server"];
const NOSQL_ENGINES = ["MongoDB", "DynamoDB", "Firestore", "Cassandra"];

type SqlTab = "tables" | "procedures";
const SQL_TABS: ReadonlyArray<TabItem<SqlTab>> = [
  { id: "tables", label: "Tables" },
  { id: "procedures", label: "Stored procedures" },
];

const SqlBody = ({ node, editor }: { node: SqlNode; editor: Editor }) => {
  const [tab, setTab] = useState<SqlTab>("tables");
  const openSet = useOpenSet();
  return (
    <>
      <Tabs tabs={SQL_TABS} activeId={tab} onChange={setTab} variant="underline" />
      {tab === "tables" ? (
        <>
          <TablesSection node={node} editor={editor} openSet={openSet} />
          <RelationshipsSection node={node} />
        </>
      ) : (
        <ProceduresSection node={node} editor={editor} openSet={openSet} />
      )}
    </>
  );
};

const NosqlBody = ({ node, editor }: { node: NosqlNode; editor: Editor }) => {
  const openSet = useOpenSet();
  return <CollectionsSection node={node} editor={editor} openSet={openSet} />;
};

export const DbPopup = ({ node, onClose }: { node: SqlNode | NosqlNode; onClose: () => void }) => {
  const { askDeleteSelection } = useArch();
  const editor = useEditor("node", node.id);
  const engines = node.type === "sqldb" ? SQL_ENGINES : NOSQL_ENGINES;
  return (
    <Modal title={node.name} wide onClose={onClose}>
      <div className={styles.header}>
        <BoundText editor={editor} path="name" value={node.name} aria-label="Database name" />
        <BoundSelect editor={editor} path="cfg.engine" value={node.cfg.engine} options={engines} aria-label="Engine" />
        <ToolButton small danger onClick={askDeleteSelection}>
          Delete
        </ToolButton>
      </div>
      {node.type === "sqldb" ? <SqlBody node={node} editor={editor} /> : <NosqlBody node={node} editor={editor} />}
      <ConnectionList nodeId={node.id} />
    </Modal>
  );
};
