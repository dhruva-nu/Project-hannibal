import type { StateVar } from "@/pages/ArchTest/engine";
import type { TraceView } from "@/pages/ArchTest/state/archApi";
import styles from "./ArchStateLine.module.css";

const VALUE_PREVIEW_CHARS = 24;

const tracedValue = (trace: TraceView | null, variable: StateVar): string | null => {
  if (!trace) return null;
  const latest = trace.result.writes.filter((w) => w.varId === variable.id && (w.stepI ?? 0) <= trace.index).at(-1);
  return latest ? JSON.stringify(latest.value) : null;
};

export const ArchStateLine = ({ variable, trace }: { variable: StateVar; trace: TraceView | null }) => {
  const value = tracedValue(trace, variable);
  return (
    <div className={styles.stateLine} data-changed={value !== null}>
      <span className={styles.name}>{variable.name}</span>
      <span className={styles.type}>{variable.type}</span>
      <span className={styles.value}>{(value ?? variable.init).slice(0, VALUE_PREVIEW_CHARS)}</span>
    </div>
  );
};
