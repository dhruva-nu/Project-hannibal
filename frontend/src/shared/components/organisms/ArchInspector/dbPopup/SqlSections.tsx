import {
  SQL_TYPES,
  generateSampleRows,
  newTable,
  type SqlNode,
  type SqlTable,
} from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { FieldCaption, HintText, MutedText, ToolButton } from "@/shared/components/atoms";
import { Collapsible, FormField, FormRow, PanelSection } from "@/shared/components/molecules";
import { BoundCheck, BoundJsonArea, BoundTextArea, BoundSelect, BoundText } from "../Bound";
import { IndexRows } from "../IndexRows";
import type { Editor } from "../panelEditor";
import { AddRowButton, RowList } from "../rows";
import { nextName, type OpenSet } from "../useOpenSet";

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
          <FormRow>
            <BoundText editor={editor} path={`${rowPath}.name`} value={column.name} monospace aria-label="Column name" />
            <BoundSelect editor={editor} path={`${rowPath}.type`} value={column.type} options={SQL_TYPES} width={82} aria-label="Column type" />
            <BoundCheck editor={editor} path={`${rowPath}.pk`} checked={column.pk} label="PK" keepWidth />
            <BoundSelect editor={editor} path={`${rowPath}.fk`} value={column.fk} options={foreignKeyOptions(node, table)} aria-label="Foreign key" />
            {removeButton}
          </FormRow>
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
      target.cfg.tables[tableIndex].data = generateSampleRows(target, target.cfg.tables[tableIndex]);
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
          {table.name} <MutedText>{table.columns.length} columns</MutedText>
        </>
      }
    >
      <FormField label="Table name">
        <BoundText editor={editor} path={`${base}.name`} value={table.name} />
      </FormField>
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
      <BoundJsonArea editor={editor} path={`${base}.data`} value={table.data} rows={5} aria-label="Sample rows" />
      <FormRow>
        <ToolButton small onClick={generateRows}>
          Generate sample rows
        </ToolButton>
        <ToolButton small danger onClick={deleteTable}>
          Delete table
        </ToolButton>
      </FormRow>
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
    <PanelSection
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
        <HintText>No tables yet.</HintText>
      )}
    </PanelSection>
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
    <PanelSection
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
              <FormField label="Name">
                <BoundText editor={editor} path={`${base}.name`} value={sp.name} monospace />
              </FormField>
              <FormField label="Parameters">
                <BoundText editor={editor} path={`${base}.params`} value={sp.params} monospace />
              </FormField>
              <FormField label="Body">
                <BoundTextArea editor={editor} path={`${base}.body`} value={sp.body} rows={5} />
              </FormField>
              <FormField label="Sample result, JSON">
                <BoundJsonArea editor={editor} path={`${base}.sample`} value={sp.sample} rows={3} />
              </FormField>
              <ToolButton small danger onClick={() => editor.remove("cfg.sps", index)}>
                Delete procedure
              </ToolButton>
            </Collapsible>
          );
        })
      ) : (
        <HintText>None.</HintText>
      )}
    </PanelSection>
  );
};

export const RelationshipsSection = ({ node }: { node: SqlNode }) => {
  const { openDetail } = useArch();
  const foreignKeys = node.cfg.tables.flatMap((t) =>
    t.columns.filter((c) => c.fk).map((c) => `${t.name}.${c.name} → ${c.fk}`),
  );
  return (
    <PanelSection
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
        <HintText>Choose a foreign key on a column to define a relationship.</HintText>
      )}
    </PanelSection>
  );
};
