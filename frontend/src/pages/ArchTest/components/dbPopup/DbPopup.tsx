import { useState } from "react";
import type { NosqlNode, SqlNode } from "../../engine";
import { useArch } from "../../state/archApi";
import { ToolButton } from "../../ui/Controls";
import { Modal } from "../overlays/Modal";
import { BoundSelect, BoundText } from "../panel/Bound";
import { ConnectionList } from "../panel/ConnectionList";
import { CollectionsSection } from "../panel/NosqlPanel";
import { useEditor, type Editor } from "../panel/panelEditor";
import { ProceduresSection, RelationshipsSection, TablesSection } from "../panel/SqlPanel";
import { useOpenSet } from "../panel/useOpenSet";
import { Tabs } from "../servicePopup/Tabs";
import styles from "../servicePopup/popup.module.css";

const SQL_ENGINES = ["PostgreSQL", "MySQL", "SQLite", "SQL Server"];
const NOSQL_ENGINES = ["MongoDB", "DynamoDB", "Firestore", "Cassandra"];

type SqlTab = "tables" | "procedures";
const SQL_TABS: ReadonlyArray<readonly [SqlTab, string]> = [
  ["tables", "Tables"],
  ["procedures", "Stored procedures"],
];

const SqlBody = ({ node, editor }: { node: SqlNode; editor: Editor }) => {
  const [tab, setTab] = useState<SqlTab>("tables");
  const openSet = useOpenSet();
  return (
    <>
      <Tabs tabs={SQL_TABS} current={tab} onChange={setTab} />
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
