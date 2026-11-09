import { allVars, diffPayload, toPrettyJson, warnText, type PayloadDiff, type TraceStep } from "@/pages/ArchTest/engine";
import { findNode } from "@/pages/ArchTest/engine";
import { useArch, type TraceView } from "@/pages/ArchTest/state/archApi";
import { Callout, CodeBlock, FieldCaption, HintText } from "@/shared/components/atoms";
import styles from "./overlays.module.css";

const MAX_DIFF_LINES = 24;
const MAX_WRITE_LENGTH = 160;

const previousSameDirection = (steps: TraceStep[], index: number): TraceStep | null => {
  for (let j = index - 1; j >= 0; j--) {
    if (steps[j].dir === steps[index].dir && steps[j].payload !== undefined) return steps[j];
  }
  return null;
};

const DIFF_CLASS: Record<PayloadDiff["t"], string> = {
  add: styles.diffAdd,
  rem: styles.diffRem,
  chg: styles.diffChg,
};

const diffLineText = (d: PayloadDiff): string => {
  if (d.t === "add") return `+ ${d.k}: ${JSON.stringify(d.to)}`;
  if (d.t === "rem") return `− ${d.k}`;
  return `~ ${d.k}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`;
};

const StateUpdates = ({ step }: { step: TraceStep }) => {
  const { model } = useArch();
  const writes = step.meta.writes ?? [];
  if (!writes.length) return null;
  const variables = allVars(model);
  return (
    <>
      <FieldCaption>State updates</FieldCaption>
      {writes.map((w, i) => (
        <div key={`${w.varId}-${i}`} className={`${styles.diffLine} ${styles.diffAdd}`}>
          {variables.find((v) => v.id === w.varId)?.name ?? "?"} = {String(JSON.stringify(w.value)).slice(0, MAX_WRITE_LENGTH)}
        </div>
      ))}
    </>
  );
};

const CacheNote = ({ cache }: { cache: "HIT" | "MISS" }) =>
  cache === "HIT" ? (
    <Callout tone="success">Cache HIT: this response came from the cache, not from the database.</Callout>
  ) : (
    <HintText>Cache MISS: this request continues downstream.</HintText>
  );

export const StepInspector = ({ trace }: { trace: TraceView }) => {
  const { model } = useArch();
  const steps = trace.result.steps;
  const step = steps[trace.index];
  const previous = previousSameDirection(steps, trace.index);
  const diff = previous && step.payload !== undefined ? diffPayload(previous.payload, step.payload).slice(0, MAX_DIFF_LINES) : [];
  const isRequest = step.dir === "req";

  return (
    <div className={styles.inspector}>
      <h5>
        {isRequest ? "→ Request" : "← Response"} at {findNode(model, step.node)?.name ?? ""}
      </h5>
      <HintText>{step.title}</HintText>
      {step.meta.cache && <CacheNote cache={step.meta.cache} />}
      {step.meta.status && <HintText>HTTP status {step.meta.status}</HintText>}
      {step.meta.notes.filter(Boolean).map((note, i) => (
        <HintText key={`${note}-${i}`}>{note}</HintText>
      ))}
      {step.meta.sql && (
        <>
          <FieldCaption>Database query</FieldCaption>
          <CodeBlock>{step.meta.sql}</CodeBlock>
        </>
      )}
      {step.warns.length > 0 && (
        <Callout tone="warning">
          <b>Schema mismatch</b>
          {step.warns.map((w) => (
            <div key={w.path + w.kind}>{warnText(w)}</div>
          ))}
        </Callout>
      )}
      <StateUpdates step={step} />
      {step.meta.pre !== undefined && (
        <>
          <FieldCaption>Before the connection mapping</FieldCaption>
          <CodeBlock>{toPrettyJson(step.meta.pre)}</CodeBlock>
        </>
      )}
      <FieldCaption>{isRequest ? "Request payload" : "Response payload"}</FieldCaption>
      <CodeBlock>{toPrettyJson(step.payload)}</CodeBlock>
      {diff.length > 0 && (
        <>
          <FieldCaption>Changes since the previous {isRequest ? "request" : "response"} step</FieldCaption>
          {diff.map((d) => (
            <div key={d.k} className={`${styles.diffLine} ${DIFF_CLASS[d.t]}`}>
              {diffLineText(d)}
            </div>
          ))}
        </>
      )}
    </div>
  );
};
