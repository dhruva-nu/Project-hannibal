import {
  OPS,
  allRefs,
  autoJoin,
  buildQuery,
  isDbNode,
  pj,
  pretty,
  pruneQuery,
  runQuery,
  schemaOf,
  shapeRows,
  sourceDb,
  switchEndpointDatabase,
  tblNames,
  type DbNode,
  type Endpoint,
  type Params,
  type ServiceNode,
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
import { SearchableMultiSelect } from "../../ui/SearchableMultiSelect";

interface Props {
  endpoint: Endpoint;
  /** Scoped to the endpoint: paths are relative to it. */
  editor: Editor;
  db: DbNode;
  refs: string[];
}

const fieldOptions = (refs: string[], emptyLabel: string) => [["", emptyLabel] as const, ...refs.map((r) => [r, r] as const)];

const DatabaseSection = ({ endpoint, editor, serviceId }: Pick<Props, "endpoint" | "editor"> & { serviceId: string }) => {
  const { model } = useArch();
  const databases = model.nodes.filter(isDbNode);
  const options = [
    ["", "None (return the sample response)"] as const,
    ...databases.map((d) => [d.id, `${d.name}${d.type === "sqldb" ? " (SQL)" : " (NoSQL)"}`] as const),
  ];
  const chooseDatabase = (dbId: string) =>
    editor.edit<Endpoint>((target, draft) => {
      target.dbId = dbId;
      const service = draft.nodes.find((n): n is ServiceNode => n.id === serviceId && n.type === "service");
      if (service) switchEndpointDatabase(draft, service, target);
    });
  return (
    <Section title="Data source">
      <Field label="Queries database">
        <SelectInput value={endpoint.dbId} options={options} onChange={chooseDatabase} />
      </Field>
      {!endpoint.dbId && <Note>Pick a database to build this endpoint's query.</Note>}
    </Section>
  );
};

const TablesSection = ({ endpoint, editor, db }: Omit<Props, "refs">) => {
  const sql = db.type === "sqldb";
  const toggleTable = (name: string) =>
    editor.edit<Endpoint>((target, draft) => {
      const query = target.q;
      if (!sql) query.tables = [name];
      else if (query.tables.includes(name)) query.tables = query.tables.filter((t) => t !== name);
      else query.tables.push(name);
      pruneQuery(draft, target);
    });
  const names = tblNames(db);
  return (
    <Section title={sql ? "Tables" : "Collection"}>
      <Note>
        Available in {db.name}.{" "}
        {sql ? "Tick the tables to read; the first is the base table." : "Pick the collection to read."}
      </Note>
      {names.length ? (
        <SearchableMultiSelect
          options={names}
          selected={endpoint.q.tables}
          onToggle={toggleTable}
          single={!sql}
          placeholder={sql ? "Select tables…" : "Select collection…"}
          aria-label={sql ? "Tables" : "Collection"}
        />
      ) : (
        <Muted>The database has no tables yet.</Muted>
      )}
    </Section>
  );
};

const JoinsSection = ({ endpoint, editor, refs }: Omit<Props, "db">) => {
  const q = endpoint.q;
  const joinable = q.tables.slice(1);
  const runAutoJoin = () =>
    editor.edit<Endpoint>((target, draft) => {
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
          <AddRowButton label="Add join" editor={editor} path="q.joins" item={{ type: "LEFT", table: joinable[0], left: "", right: "" }} />
        </span>
      }
    >
      <RowList
        items={q.joins}
        path="q.joins"
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

const FiltersSection = ({ endpoint, editor, refs }: Omit<Props, "db">) => (
  <Section
    title="Filters"
    action={<AddRowButton label="Add" editor={editor} path="q.where" item={{ field: refs[0] ?? "", op: "=", value: "" }} />}
  >
    <Note>Use :name as the value to bind a request parameter, e.g. :id</Note>
    <RowList
      items={endpoint.q.where}
      path="q.where"
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

const ProjectionSection = ({ endpoint, editor, refs }: Omit<Props, "db">) => {
  const select = endpoint.q.select;
  const toggleProjection = (field: string) =>
    editor.edit<Endpoint>((target) => {
      const list = target.q.select;
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
              <BoundText editor={editor} path={`q.select.${index}.as`} value={select[index].as} mono placeholder="rename" aria-label={`Rename ${ref}`} />
            )}
          </Row>
        );
      })}
    </Section>
  );
};

const AggregationsSection = ({ endpoint, editor, refs }: Omit<Props, "db">) => {
  const q = endpoint.q;
  return (
    <Section
      title="Aggregations"
      action={
        <span>
          <AddRowButton label="Aggregate" editor={editor} path="q.aggs" item={{ fn: "count", field: "", as: "" }} />{" "}
          <AddRowButton label="Group by" editor={editor} path="q.group" item={refs[0] ?? ""} />
        </span>
      }
    >
      <RowList
        items={q.aggs}
        path="q.aggs"
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
        path="q.group"
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

const ResultSection = ({ endpoint, editor, db }: Omit<Props, "refs">) => (
  <>
    <Section title="Result options">
      {db.type === "sqldb" && endpoint.q.tables.length > 1 && (
        <BoundCheck editor={editor} path="q.nest" checked={endpoint.q.nest} label="Nest joined tables under the base rows" />
      )}
      <Field label="Limit">
        <BoundNumber editor={editor} path="q.limit" value={endpoint.q.limit} />
      </Field>
    </Section>
    <PreviewSections endpoint={endpoint} editor={editor} />
  </>
);

const PreviewSections = ({ endpoint, editor }: Pick<Props, "endpoint" | "editor">) => {
  const { model } = useArch();
  const params = pj(endpoint.sample, {}) as Params;
  const built = buildQuery(model, endpoint, params);
  const result = runQuery(model, endpoint, params);
  const shaped = shapeRows(model, endpoint, result.rows);
  return (
    <>
      <Section title="Sample request parameters, JSON">
        <BoundArea editor={editor} path="sample" value={endpoint.sample} rows={3} json aria-label="Sample request parameters" />
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

export const EndpointQueryPanel = ({ endpoint, editor, serviceId }: { endpoint: Endpoint; editor: Editor; serviceId: string }) => {
  const { model } = useArch();
  const db = sourceDb(model, endpoint);
  if (!db) return <DatabaseSection endpoint={endpoint} editor={editor} serviceId={serviceId} />;
  const refs = allRefs(db, endpoint.q.tables);
  return (
    <>
      <DatabaseSection endpoint={endpoint} editor={editor} serviceId={serviceId} />
      <TablesSection endpoint={endpoint} editor={editor} db={db} />
      {db.type === "sqldb" && endpoint.q.tables.length > 1 && <JoinsSection endpoint={endpoint} editor={editor} refs={refs} />}
      <FiltersSection endpoint={endpoint} editor={editor} refs={refs} />
      <ProjectionSection endpoint={endpoint} editor={editor} refs={refs} />
      <AggregationsSection endpoint={endpoint} editor={editor} refs={refs} />
      <ResultSection endpoint={endpoint} editor={editor} db={db} />
    </>
  );
};
