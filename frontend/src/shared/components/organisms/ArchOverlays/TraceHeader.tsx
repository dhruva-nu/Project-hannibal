import { useArch, type TraceView } from "@/pages/ArchTest/state/archApi";
import { Pill, SelectInput, ToolButton } from "@/shared/components/atoms";
import styles from "./overlays.module.css";

const ALL_FUNCTIONS = "";

export const FunctionOrderStrip = ({ trace }: { trace: TraceView }) => (
  <div className={styles.functionStrip}>
    {trace.result.fnOrder.length ? (
      <>
        Functions triggered, in order:
        {trace.result.fnOrder.map((fn, i) => (
          <Pill key={fn.id} emphasis>
            {i + 1}. {fn.trigger} ({fn.name})
          </Pill>
        ))}
      </>
    ) : (
      "No function is attached, so requests go straight from the component."
    )}
  </div>
);

export const TraceHeader = ({ trace, componentName }: { trace: TraceView; componentName: string }) => {
  const api = useArch();
  const functionOptions = [
    [ALL_FUNCTIONS, "All functions in lifecycle order"] as const,
    ...trace.result.fnOrder.map((fn) => [fn.id, `${fn.trigger}: ${fn.name}`] as const),
  ];
  return (
    <div className={styles.drawerHeader}>
      <strong>Trace: {componentName}</strong>
      <SelectInput value={trace.only} options={functionOptions} onChange={api.traceSetOnly} aria-label="Trigger" />
      <span className={styles.segment} role="group" aria-label="Cache state">
        <button type="button" aria-pressed={!trace.warm} onClick={() => api.traceSetWarm(false)}>
          Cold cache
        </button>
        <button type="button" aria-pressed={trace.warm} onClick={() => api.traceSetWarm(true)}>
          Warm cache
        </button>
      </span>
      <ToolButton small onClick={() => api.traceGo(trace.index - 1)}>
        Prev
      </ToolButton>
      <ToolButton small onClick={api.traceTogglePlay}>
        {trace.playing ? "Pause" : "Play"}
      </ToolButton>
      <ToolButton small onClick={() => api.traceGo(trace.index + 1)}>
        Next
      </ToolButton>
      <span>
        Step {trace.index + 1} of {trace.result.steps.length}
      </span>
      <span className={styles.spacer} />
      <ToolButton small onClick={api.closeTrace}>
        Close trace
      </ToolButton>
    </div>
  );
};
