import { buildQuery, isObject, parseJsonOr, toPrettyJson, runQuery, schemaOf, shapeRows, type Endpoint, type Params, type Row } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { CodeBlock, FieldCaption, HintText } from "@/shared/components/atoms";
import { DataTable } from "@/shared/components/molecules";
import styles from "../overlays.module.css";

const MAX_ROWS_SHOWN = 12;

const sampleParams = (sample: string): Params => {
  const parsed = parseJsonOr(sample, {});
  return isObject(parsed) ? parsed : {};
};

const cellText = (value: unknown): string => (typeof value === "object" ? JSON.stringify(value) : String(value));

const columnKeys = (rows: Row[]): string[] => [...new Set(rows.flatMap((r) => Object.keys(r)))];

export const QueryResultView = ({ endpoint }: { endpoint: Endpoint }) => {
  const { model } = useArch();
  const params = sampleParams(endpoint.sample);
  const query = buildQuery(model, endpoint, params);
  const rows = shapeRows(model, endpoint, runQuery(model, endpoint, params).rows);
  const keys = columnKeys(rows);

  return (
    <>
      <FieldCaption>Query</FieldCaption>
      <CodeBlock>{query.sql}</CodeBlock>
      {query.binds.length > 0 && (
        <HintText>Bound: {query.binds.map((b) => `${b.name} = ${JSON.stringify(b.value)}`).join(", ")}</HintText>
      )}
      <FieldCaption>Result structure</FieldCaption>
      <CodeBlock>{toPrettyJson(schemaOf(rows))}</CodeBlock>
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
                    <td key={k}>{cellText(row[k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : (
        <HintText>No rows.</HintText>
      )}
    </>
  );
};
