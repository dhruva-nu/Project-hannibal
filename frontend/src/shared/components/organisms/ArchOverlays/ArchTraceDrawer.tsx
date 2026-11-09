import { findNode } from "@/pages/ArchTest/engine";
import { useArch } from "@/pages/ArchTest/state/archApi";
import { StepInspector } from "./StepInspector";
import { StepList } from "./StepList";
import { FunctionOrderStrip, TraceHeader } from "./TraceHeader";
import styles from "./overlays.module.css";

export const ArchTraceDrawer = () => {
  const api = useArch();
  const trace = api.trace;
  const component = trace && findNode(api.model, trace.compId);
  if (!trace || !component) return null;
  return (
    <section className={styles.drawer} aria-label="Request trace">
      <TraceHeader trace={trace} componentName={component.name} />
      <FunctionOrderStrip trace={trace} />
      <div className={styles.drawerBody}>
        <StepList trace={trace} />
        <StepInspector trace={trace} />
      </div>
    </section>
  );
};
