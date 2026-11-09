import { buildQuery, isObject, pj, pretty, runQuery, schemaOf, shapeRows, type Endpoint, type Params } from "../../../engine";
import { useArch } from "../../../state/archApi";
import { Code, DataTable, FieldCaption, Note } from "../../../ui/Controls";
import styles from "../overlays.module.css";

const MAX_ROWS_SHOWN = 12;

const sampleParams = (sample: string): Params => {
  const parsed = pj(sample, {});
  return isObject(parsed) ? parsed : {};
};

const cellText = (value: unknown): string => (typeof value === "object" ? JSON.stringify(value) : String(value));

const columnKeys = (rows: unknown[]): string[] => [
  ...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : []))),
];

export const QueryResultView = ({ endpoint }: { endpoint: Endpoint }) => {
  const { model } = useArch();
  const params = sampleParams(endpoint.sample);
  const query = buildQuery(model, endpoint, params);
  const shaped = shapeRows(model, endpoint, runQuery(model, endpoint, params).rows);
  const rows: unknown[] = Array.isArray(shaped) ? shaped : [shaped];
  const keys = columnKeys(rows);

  return (
    <>
      <FieldCaption>Query</FieldCaption>
      <Code>{query.sql}</Code>
      {query.binds.length > 0 && (
        <Note>Bound: {query.binds.map((b) => `${b.name} = ${JSON.stringify(b.value)}`).join(", ")}</Note>
      )}
      <FieldCaption>Result structure</FieldCaption>
      <Code>{pretty(schemaOf(shaped))}</Code>
      <FieldCaption>Result rows</FieldCaption>
      {keys.length ? (
        <div className={styles.scroll}>
          <DataTable>
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_ROWS_SHOWN).map((row, i) => (
                <tr key={i}>
                  {keys.map((k) => (
                    <td key={k}>{cellText((row as Record<string, unknown>)[k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : (
        <Note>No rows.</Note>
      )}
    </>
  );
};
