import {
  SQL_TYPES,
  genSampleRows,
  newTable,
  type SqlNode,
  type SqlTable,
} from "../../engine";
import { useArch } from "../../state/archApi";
import { Collapsible, Field, FieldCaption, Muted, Note, Row, Section, ToolButton } from "../../ui/Controls";
import { BoundArea, BoundCheck, BoundSelect, BoundText } from "./Bound";
import { IndexRows } from "./IndexRows";
import type { Editor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";
import { nextName, useOpenSet, type OpenSet } from "./useOpenSet";

interface Props {
  node: SqlNode;
  editor: Editor;
}

interface TableProps extends Props {
  table: SqlTable;
  tableIndex: number;
}

const foreignKeyOptions = (node: SqlNode, table: SqlTable) => [
  ["", "no foreign key"] as const,
  ...node.cfg.tables
    .filter((other) => other.name !== table.name)
    .flatMap((other) => other.columns.map((c) => `${other.name}.${c.name}`))
    .map((ref) => [ref, `→ ${ref}`] as const),
];

const ColumnRows = ({ node, editor, table, tableIndex }: TableProps) => {
  const base = `cfg.tables.${tableIndex}`;
  return (
    <>
      <FieldCaption>Columns (name, type, primary key, foreign key)</FieldCaption>
      <RowList
        items={table.columns}
        path={`${base}.columns`}
        editor={editor}
        renderRow={(column, _i, rowPath, removeButton) => (
          <Row>
            <BoundText editor={editor} path={`${rowPath}.name`} value={column.name} mono aria-label="Column name" />
            <BoundSelect editor={editor} path={`${rowPath}.type`} value={column.type} options={SQL_TYPES} fixedWidth={82} aria-label="Column type" />
            <BoundCheck editor={editor} path={`${rowPath}.pk`} checked={column.pk} label="PK" fixed />
            <BoundSelect editor={editor} path={`${rowPath}.fk`} value={column.fk} options={foreignKeyOptions(node, table)} aria-label="Foreign key" />
            {removeButton}
          </Row>
        )}
      />
      <AddRowButton label="Add column" editor={editor} path={`${base}.columns`} item={{ name: "column", type: "text", pk: false, fk: "" }} />
    </>
  );
};

const TableDetails = (props: TableProps & { openSet: OpenSet }) => {
  const { node, editor, table, tableIndex, openSet } = props;
  const base = `cfg.tables.${tableIndex}`;
  const key = `${node.id}:${tableIndex}`;
  const generateRows = () =>
    editor.edit<SqlNode>((target) => {
      target.cfg.tables[tableIndex].data = genSampleRows(target, target.cfg.tables[tableIndex]);
    });
  const deleteTable = () =>
    editor.edit<SqlNode>((target) => {
      target.cfg.tables.splice(tableIndex, 1);
    });
  return (
    <Collapsible
      open={openSet.isOpen(key)}
      onToggle={(open) => openSet.setOpen(key, open)}
      summary={
        <>
          {table.name} <Muted>{table.columns.length} columns</Muted>
        </>
      }
    >
      <Field label="Table name">
        <BoundText editor={editor} path={`${base}.name`} value={table.name} />
      </Field>
      <ColumnRows {...props} />
      <IndexRows
        indexes={table.indexes}
        path={`${base}.indexes`}
        editor={editor}
        columnsPlaceholder="col1, col2"
        newIndex={{ name: `idx_${table.name}_col`, columns: "", unique: false }}
        addLabel="Add index"
      />
      <FieldCaption>Sample rows, JSON</FieldCaption>
      <BoundArea editor={editor} path={`${base}.data`} value={table.data} rows={5} json aria-label="Sample rows" />
      <Row>
        <ToolButton small onClick={generateRows}>
          Generate sample rows
        </ToolButton>
        <ToolButton small danger onClick={deleteTable}>
          Delete table
        </ToolButton>
      </Row>
    </Collapsible>
  );
};

export const TablesSection = ({ node, editor, openSet }: Props & { openSet: OpenSet }) => {
  const addTable = () => {
    const name = nextName("table_", node.cfg.tables.map((t) => t.name));
    editor.push("cfg.tables", newTable(name));
    openSet.setOpen(`${node.id}:${node.cfg.tables.length}`, true);
  };
  return (
    <Section
      title="Tables"
      action={
        <ToolButton small onClick={addTable}>
          Add table
        </ToolButton>
      }
    >
      {node.cfg.tables.length ? (
        node.cfg.tables.map((table, tableIndex) => (
          <TableDetails key={tableIndex} node={node} editor={editor} table={table} tableIndex={tableIndex} openSet={openSet} />
        ))
      ) : (
        <Note>No tables yet.</Note>
      )}
    </Section>
  );
};

export const ProceduresSection = ({ node, editor, openSet }: Props & { openSet: OpenSet }) => {
  const addProcedure = () => {
    editor.push("cfg.sps", {
      name: `procedure_${node.cfg.sps.length + 1}`,
      params: "",
      body: "SELECT 1;",
      sample: "[]",
    });
    openSet.setOpen(`${node.id}:sp${node.cfg.sps.length}`, true);
  };
  return (
    <Section
      title="Stored procedures"
      action={
        <ToolButton small onClick={addProcedure}>
          Add procedure
        </ToolButton>
      }
    >
      {node.cfg.sps.length ? (
        node.cfg.sps.map((sp, index) => {
          const key = `${node.id}:sp${index}`;
          const base = `cfg.sps.${index}`;
          return (
            <Collapsible key={index} open={openSet.isOpen(key)} onToggle={(open) => openSet.setOpen(key, open)} summary={`${sp.name}()`}>
              <Field label="Name">
                <BoundText editor={editor} path={`${base}.name`} value={sp.name} mono />
              </Field>
              <Field label="Parameters">
                <BoundText editor={editor} path={`${base}.params`} value={sp.params} mono />
              </Field>
              <Field label="Body">
                <BoundArea editor={editor} path={`${base}.body`} value={sp.body} rows={5} />
              </Field>
              <Field label="Sample result, JSON">
                <BoundArea editor={editor} path={`${base}.sample`} value={sp.sample} rows={3} json />
              </Field>
              <ToolButton small danger onClick={() => editor.remove("cfg.sps", index)}>
                Delete procedure
              </ToolButton>
            </Collapsible>
          );
        })
      ) : (
        <Note>None.</Note>
      )}
    </Section>
  );
};

export const RelationshipsSection = ({ node }: { node: SqlNode }) => {
  const { openDetail } = useArch();
  const foreignKeys = node.cfg.tables.flatMap((t) =>
    t.columns.filter((c) => c.fk).map((c) => `${t.name}.${c.name} → ${c.fk}`),
  );
  return (
    <Section
      title="Relationships"
      action={
        <ToolButton small onClick={() => openDetail(node.id)}>
          Schema diagram
        </ToolButton>
      }
    >
      {foreignKeys.length ? (
        foreignKeys.map((fk) => <div key={fk}>{fk}</div>)
      ) : (
        <Note>Choose a foreign key on a column to define a relationship.</Note>
      )}
    </Section>
  );
};

export const SqlPanel = ({ node, editor }: Props) => {
  const openSet = useOpenSet();
  return (
    <>
      <Section title="Database">
        <Field label="Engine">
          <BoundSelect editor={editor} path="cfg.engine" value={node.cfg.engine} options={["PostgreSQL", "MySQL", "SQLite", "SQL Server"]} />
        </Field>
      </Section>
      <TablesSection node={node} editor={editor} openSet={openSet} />
      <RelationshipsSection node={node} />
      <ProceduresSection node={node} editor={editor} openSet={openSet} />
    </>
  );
};
