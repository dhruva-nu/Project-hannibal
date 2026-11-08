import {
  OPS,
  allRefs,
  autoJoin,
  buildQuery,
  connectorDb,
  isDbNode,
  pj,
  pretty,
  pruneConnector,
  runQuery,
  schemaOf,
  shapeConnector,
  switchConnectorDatabase,
  tblNames,
  type ConnectorNode,
  type DbNode,
  type Params,
} from "../../engine";
import { useArch } from "../../state/archApi";
import {
  CheckInput,
  Code,
  Field,
  FieldCaption,
  Fixed,
  Muted,
  Note,
  Row,
  Section,
  SelectInput,
  ToolButton,
  WarnBox,
} from "../../ui/Controls";
import { BoundArea, BoundCheck, BoundNumber, BoundSelect, BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

interface Props {
  node: ConnectorNode;
  editor: Editor;
  db: DbNode;
  refs: string[];
}

const fieldOptions = (refs: string[], emptyLabel: string) => [["", emptyLabel] as const, ...refs.map((r) => [r, r] as const)];

const DatabaseSection = ({ node, editor }: Pick<Props, "node" | "editor">) => {
  const { model } = useArch();
  const databases = model.nodes.filter(isDbNode);
  const options = [
    ["", "Choose a database"] as const,
    ...databases.map((d) => [d.id, `${d.name}${d.type === "sqldb" ? " (SQL)" : " (NoSQL)"}`] as const),
  ];
  const chooseDatabase = (dbId: string) =>
    editor.edit<ConnectorNode>((target, draft) => {
      target.cfg.dbId = dbId;
      switchConnectorDatabase(draft, target);
    });
  return (
    <Section title="Database">
      <Field label="Connected to">
        <SelectInput value={node.cfg.dbId} options={options} onChange={chooseDatabase} />
      </Field>
      {!node.cfg.dbId && <Note>Pick a database, or draw a connection from this connector to one.</Note>}
    </Section>
  );
};

const TablesSection = ({ node, editor, db }: Omit<Props, "refs">) => {
  const sql = db.type === "sqldb";
  const toggleTable = (name: string) =>
    editor.edit<ConnectorNode>((target, draft) => {
      const query = target.cfg.q;
      if (!sql) query.tables = [name];
      else if (query.tables.includes(name)) query.tables = query.tables.filter((t) => t !== name);
      else query.tables.push(name);
      pruneConnector(draft, target);
    });
  const names = tblNames(db);
  return (
    <Section title={sql ? "Tables" : "Collection"}>
      <Note>
        Available in {db.name}.{" "}
        {sql ? "Tick the tables to read; the first is the base table." : "Pick the collection to read."}
      </Note>
      {names.length ? (
        names.map((name) => (
          <CheckInput key={name} label={name} checked={node.cfg.q.tables.includes(name)} onChange={() => toggleTable(name)} />
        ))
      ) : (
        <Muted>The database has no tables yet.</Muted>
      )}
    </Section>
  );
};

const JoinsSection = ({ node, editor, refs }: Omit<Props, "db">) => {
  const q = node.cfg.q;
  const joinable = q.tables.slice(1);
  const runAutoJoin = () =>
    editor.edit<ConnectorNode>((target, draft) => {
      autoJoin(draft, target);
    });
  return (
    <Section
      title="Joins"
      action={
        <span>
          <ToolButton small onClick={runAutoJoin}>
            Auto-join from foreign keys
          </ToolButton>{" "}
          <AddRowButton label="Add join" editor={editor} path="cfg.q.joins" item={{ type: "LEFT", table: joinable[0], left: "", right: "" }} />
        </span>
      }
    >
      <RowList
        items={q.joins}
        path="cfg.q.joins"
        editor={editor}
        emptyNote="No joins yet."
        renderRow={(join, _i, rowPath, removeButton) => (
          <div>
            <Row>
              <BoundSelect editor={editor} path={`${rowPath}.type`} value={join.type} options={["LEFT", "INNER"]} fixedWidth={76} aria-label="Join type" />
              <BoundSelect editor={editor} path={`${rowPath}.table`} value={join.table} options={joinable} aria-label="Join table" />
            </Row>
            <Row>
              <BoundSelect editor={editor} path={`${rowPath}.left`} value={join.left} options={fieldOptions(refs, "left field")} aria-label="Join left field" />
              <Fixed>=</Fixed>
              <BoundSelect editor={editor} path={`${rowPath}.right`} value={join.right} options={fieldOptions(refs, "right field")} aria-label="Join right field" />
              {removeButton}
            </Row>
          </div>
        )}
      />
    </Section>
  );
};

const FiltersSection = ({ node, editor, refs }: Omit<Props, "db">) => (
  <Section
    title="Filters"
    action={<AddRowButton label="Add" editor={editor} path="cfg.q.where" item={{ field: refs[0] ?? "", op: "=", value: "" }} />}
  >
    <Note>Use :name as the value to bind a request parameter, e.g. :id</Note>
    <RowList
      items={node.cfg.q.where}
      path="cfg.q.where"
      editor={editor}
      renderRow={(filter, _i, rowPath, removeButton) => (
        <Row>
          <BoundSelect editor={editor} path={`${rowPath}.field`} value={filter.field} options={fieldOptions(refs, "field")} aria-label="Filter field" />
          <BoundSelect editor={editor} path={`${rowPath}.op`} value={filter.op} options={OPS} fixedWidth={84} aria-label="Filter operator" />
          <BoundText editor={editor} path={`${rowPath}.value`} value={filter.value} mono placeholder=":id" aria-label="Filter value" />
          {removeButton}
        </Row>
      )}
    />
  </Section>
);

const ProjectionSection = ({ node, editor, refs }: Omit<Props, "db">) => {
  const select = node.cfg.q.select;
  const toggleProjection = (field: string) =>
    editor.edit<ConnectorNode>((target) => {
      const list = target.cfg.q.select;
      const index = list.findIndex((s) => s.field === field);
      if (index >= 0) list.splice(index, 1);
      else list.push({ field, as: "" });
    });
  return (
    <Section title="Projection">
      <Note>Columns to return. Leave all unticked to return everything.</Note>
      {refs.map((ref) => {
        const index = select.findIndex((s) => s.field === ref);
        return (
          <Row key={ref}>
            <CheckInput label={ref} checked={index >= 0} onChange={() => toggleProjection(ref)} />
            {index >= 0 && (
              <BoundText editor={editor} path={`cfg.q.select.${index}.as`} value={select[index].as} mono placeholder="rename" aria-label={`Rename ${ref}`} />
            )}
          </Row>
        );
      })}
    </Section>
  );
};

const AggregationsSection = ({ node, editor, refs }: Omit<Props, "db">) => {
  const q = node.cfg.q;
  return (
    <Section
      title="Aggregations"
      action={
        <span>
          <AddRowButton label="Aggregate" editor={editor} path="cfg.q.aggs" item={{ fn: "count", field: "", as: "" }} />{" "}
          <AddRowButton label="Group by" editor={editor} path="cfg.q.group" item={refs[0] ?? ""} />
        </span>
      }
    >
      <RowList
        items={q.aggs}
        path="cfg.q.aggs"
        editor={editor}
        renderRow={(agg, _i, rowPath, removeButton) => (
          <Row>
            <BoundSelect editor={editor} path={`${rowPath}.fn`} value={agg.fn} options={["count", "sum", "avg", "min", "max"]} fixedWidth={76} aria-label="Aggregate function" />
            <BoundSelect editor={editor} path={`${rowPath}.field`} value={agg.field} options={fieldOptions(refs, "all rows")} aria-label="Aggregate field" />
            <BoundText editor={editor} path={`${rowPath}.as`} value={agg.as} mono placeholder="as" aria-label="Aggregate alias" />
            {removeButton}
          </Row>
        )}
      />
      <RowList
        items={q.group}
        path="cfg.q.group"
        editor={editor}
        removeLabel="Remove group by"
        renderRow={(field, _i, rowPath, removeButton) => (
          <Row>
            <Fixed>
              <Muted>group by</Muted>
            </Fixed>
            <BoundSelect editor={editor} path={rowPath} value={field} options={fieldOptions(refs, "field")} aria-label="Group by field" />
            {removeButton}
          </Row>
        )}
      />
    </Section>
  );
};

const ResultSection = ({ node, editor, db }: Omit<Props, "refs">) => (
  <>
    <Section title="Result options">
      {db.type === "sqldb" && node.cfg.q.tables.length > 1 && (
        <BoundCheck editor={editor} path="cfg.q.nest" checked={node.cfg.q.nest} label="Nest joined tables under the base rows" />
      )}
      <Field label="Limit">
        <BoundNumber editor={editor} path="cfg.q.limit" value={node.cfg.q.limit} />
      </Field>
    </Section>
    <PreviewSections node={node} editor={editor} />
  </>
);

const PreviewSections = ({ node, editor }: Pick<Props, "node" | "editor">) => {
  const { model } = useArch();
  const params = pj(node.cfg.sample, {}) as Params;
  const built = buildQuery(model, node, params);
  const result = runQuery(model, node, params);
  const shaped = shapeConnector(model, node, result.rows);
  return (
    <>
      <Section title="Sample request parameters, JSON">
        <BoundArea editor={editor} path="cfg.sample" value={node.cfg.sample} rows={3} json aria-label="Sample request parameters" />
      </Section>
      <Section title="Query">
        <Code>{built.sql}</Code>
      </Section>
      <Section title="Result structure">
        {result.error ? (
          <WarnBox>{result.error}</WarnBox>
        ) : (
          <>
            <FieldCaption>Shape</FieldCaption>
            <Code>{pretty(schemaOf(shaped))}</Code>
            <FieldCaption>
              Sample result ({Array.isArray(shaped) ? `${shaped.length} rows` : "object"})
            </FieldCaption>
            <Code>{pretty(Array.isArray(shaped) ? shaped.slice(0, 3) : shaped)}</Code>
          </>
        )}
      </Section>
    </>
  );
};

export const ConnectorPanel = ({ node, editor }: { node: ConnectorNode; editor: Editor }) => {
  const { model } = useArch();
  const db = connectorDb(model, node);
  if (!db) return <DatabaseSection node={node} editor={editor} />;
  const refs = allRefs(db, node.cfg.q.tables);
  return (
    <>
      <DatabaseSection node={node} editor={editor} />
      <TablesSection node={node} editor={editor} db={db} />
      {db.type === "sqldb" && node.cfg.q.tables.length > 1 && <JoinsSection node={node} editor={editor} refs={refs} />}
      <FiltersSection node={node} editor={editor} refs={refs} />
      <ProjectionSection node={node} editor={editor} refs={refs} />
      <AggregationsSection node={node} editor={editor} refs={refs} />
      <ResultSection node={node} editor={editor} db={db} />
    </>
  );
};
