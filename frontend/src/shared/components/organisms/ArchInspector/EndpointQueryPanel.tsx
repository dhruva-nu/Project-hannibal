import {
  FILTER_OPERATORS,
  columnRefs,
  autoJoin,
  buildQuery,
  isDbNode,
  parseJsonOr,
  toPrettyJson,
  pruneQuery,
  runQuery,
  schemaOf,
  shapeRows,
  sourceDb,
  switchEndpointDatabase,
  tableNames,
  type DbNode,
  type Endpoint,
  type Params,
  type Row,
  type ServiceNode,
} from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { Callout, CodeBlock, FieldCaption, HintText, InlineCheckbox, MutedText, SelectInput, ToolButton } from "@/shared/components/atoms";
import { FixedCell, FormField, FormRow, PanelSection, SearchableMultiSelect } from "@/shared/components/molecules";
import { BoundJsonArea, BoundCheck, BoundNumber, BoundSelect, BoundText } from "./Bound";
import type { Editor } from "./panelEditor";
import { AddRowButton, RowList } from "./rows";

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
      if (!service) throw new Error(`Service "${serviceId}" no longer exists`);
      switchEndpointDatabase(draft, service, target);
    });
  return (
    <PanelSection title="Data source">
      <FormField label="Queries database">
        <SelectInput value={endpoint.dbId} options={options} onChange={chooseDatabase} />
      </FormField>
      {!endpoint.dbId && <HintText>Pick a database to build this endpoint's query.</HintText>}
    </PanelSection>
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
  const names = tableNames(db);
  return (
    <PanelSection title={sql ? "Tables" : "Collection"}>
      <HintText>
        Available in {db.name}.{" "}
        {sql ? "Tick the tables to read; the first is the base table." : "Pick the collection to read."}
      </HintText>
      {names.length ? (
        <SearchableMultiSelect
          options={names}
          selected={endpoint.q.tables}
          onToggle={toggleTable}
          singleChoice={!sql}
          placeholder={sql ? "Select tables…" : "Select collection…"}
          aria-label={sql ? "Tables" : "Collection"}
        />
      ) : (
        <MutedText>The database has no tables yet.</MutedText>
      )}
    </PanelSection>
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
    <PanelSection
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
            <FormRow>
              <BoundSelect editor={editor} path={`${rowPath}.type`} value={join.type} options={["LEFT", "INNER"]} width={76} aria-label="Join type" />
              <BoundSelect editor={editor} path={`${rowPath}.table`} value={join.table} options={joinable} aria-label="Join table" />
            </FormRow>
            <FormRow>
              <BoundSelect editor={editor} path={`${rowPath}.left`} value={join.left} options={fieldOptions(refs, "left field")} aria-label="Join left field" />
              <FixedCell>=</FixedCell>
              <BoundSelect editor={editor} path={`${rowPath}.right`} value={join.right} options={fieldOptions(refs, "right field")} aria-label="Join right field" />
              {removeButton}
            </FormRow>
          </div>
        )}
      />
    </PanelSection>
  );
};

const FiltersSection = ({ endpoint, editor, refs }: Omit<Props, "db">) => (
  <PanelSection
    title="Filters"
    action={<AddRowButton label="Add" editor={editor} path="q.where" item={{ field: refs[0] ?? "", op: "=", value: "" }} />}
  >
    <HintText>Use :name as the value to bind a request parameter, e.g. :id</HintText>
    <RowList
      items={endpoint.q.where}
      path="q.where"
      editor={editor}
      renderRow={(filter, _i, rowPath, removeButton) => (
        <FormRow>
          <BoundSelect editor={editor} path={`${rowPath}.field`} value={filter.field} options={fieldOptions(refs, "field")} aria-label="Filter field" />
          <BoundSelect editor={editor} path={`${rowPath}.op`} value={filter.op} options={FILTER_OPERATORS} width={84} aria-label="Filter operator" />
          <BoundText editor={editor} path={`${rowPath}.value`} value={filter.value} monospace placeholder=":id" aria-label="Filter value" />
          {removeButton}
        </FormRow>
      )}
    />
  </PanelSection>
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
    <PanelSection title="Projection">
      <HintText>Columns to return. Leave all unticked to return everything.</HintText>
      {refs.map((ref) => {
        const index = select.findIndex((s) => s.field === ref);
        return (
          <FormRow key={ref}>
            <InlineCheckbox label={ref} checked={index >= 0} onChange={() => toggleProjection(ref)} />
            {index >= 0 && (
              <BoundText editor={editor} path={`q.select.${index}.as`} value={select[index].as} monospace placeholder="rename" aria-label={`Rename ${ref}`} />
            )}
          </FormRow>
        );
      })}
    </PanelSection>
  );
};

const AggregationsSection = ({ endpoint, editor, refs }: Omit<Props, "db">) => {
  const q = endpoint.q;
  return (
    <PanelSection
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
          <FormRow>
            <BoundSelect editor={editor} path={`${rowPath}.fn`} value={agg.fn} options={["count", "sum", "avg", "min", "max"]} width={76} aria-label="Aggregate function" />
            <BoundSelect editor={editor} path={`${rowPath}.field`} value={agg.field} options={fieldOptions(refs, "all rows")} aria-label="Aggregate field" />
            <BoundText editor={editor} path={`${rowPath}.as`} value={agg.as} monospace placeholder="as" aria-label="Aggregate alias" />
            {removeButton}
          </FormRow>
        )}
      />
      <RowList
        items={q.group}
        path="q.group"
        editor={editor}
        removeLabel="Remove group by"
        renderRow={(field, _i, rowPath, removeButton) => (
          <FormRow>
            <FixedCell>
              <MutedText>group by</MutedText>
            </FixedCell>
            <BoundSelect editor={editor} path={rowPath} value={field} options={fieldOptions(refs, "field")} aria-label="Group by field" />
            {removeButton}
          </FormRow>
        )}
      />
    </PanelSection>
  );
};

const ResultSection = ({ endpoint, editor, db }: Omit<Props, "refs">) => (
  <>
    <PanelSection title="Result options">
      {db.type === "sqldb" && endpoint.q.tables.length > 1 && (
        <BoundCheck editor={editor} path="q.nest" checked={endpoint.q.nest} label="Nest joined tables under the base rows" />
      )}
      <FormField label="Limit">
        <BoundNumber editor={editor} path="q.limit" value={endpoint.q.limit} />
      </FormField>
    </PanelSection>
    <PreviewSections endpoint={endpoint} editor={editor} />
  </>
);

const PREVIEW_ROW_LIMIT = 3;

const samplePreview = (endpoint: Endpoint, rows: Row[]): { label: string; value: unknown } => {
  if (endpoint.single) return { label: "single object", value: rows[0] ?? null };
  return { label: `${rows.length} rows`, value: rows.slice(0, PREVIEW_ROW_LIMIT) };
};

const PreviewSections = ({ endpoint, editor }: Pick<Props, "endpoint" | "editor">) => {
  const { model } = useArch();
  const params = parseJsonOr(endpoint.sample, {}) as Params;
  const built = buildQuery(model, endpoint, params);
  const result = runQuery(model, endpoint, params);
  const shaped = shapeRows(model, endpoint, result.rows);
  const sample = samplePreview(endpoint, shaped);
  return (
    <>
      <PanelSection title="Sample request parameters, JSON">
        <BoundJsonArea editor={editor} path="sample" value={endpoint.sample} rows={3} aria-label="Sample request parameters" />
      </PanelSection>
      <PanelSection title="Query">
        <CodeBlock>{built.sql}</CodeBlock>
      </PanelSection>
      <PanelSection title="Result structure">
        {result.error ? (
          <Callout tone="warning">{result.error}</Callout>
        ) : (
          <>
            <FieldCaption>Shape</FieldCaption>
            <CodeBlock>{toPrettyJson(schemaOf(shaped))}</CodeBlock>
            <FieldCaption>Sample result ({sample.label})</FieldCaption>
            <CodeBlock>{toPrettyJson(sample.value)}</CodeBlock>
          </>
        )}
      </PanelSection>
    </>
  );
};

export const EndpointQueryPanel = ({ endpoint, editor, serviceId }: { endpoint: Endpoint; editor: Editor; serviceId: string }) => {
  const { model } = useArch();
  const db = sourceDb(model, endpoint);
  if (!db) return <DatabaseSection endpoint={endpoint} editor={editor} serviceId={serviceId} />;
  const refs = columnRefs(db, endpoint.q.tables);
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
