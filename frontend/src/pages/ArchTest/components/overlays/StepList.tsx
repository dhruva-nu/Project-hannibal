import { useEffect, useRef } from "react";
import { findNode, useArch, type TraceView } from "../../state/archApi";
import styles from "./overlays.module.css";

const stepClassName = (isCurrent: boolean, isResponse: boolean) =>
  [styles.step, isCurrent && styles.stepOn, isResponse && styles.stepRes].filter(Boolean).join(" ");

export const StepList = ({ trace }: { trace: TraceView }) => {
  const api = useArch();
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [trace.index]);

  return (
    <div className={styles.stepList}>
      {trace.result.steps.map((step, i) => {
        const isCurrent = i === trace.index;
        return (
          <button
            type="button"
            key={step.i}
            ref={isCurrent ? currentRef : undefined}
            className={stepClassName(isCurrent, step.dir === "res")}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => api.traceGo(i)}
          >
            <span className={styles.stepIndex}>{i + 1}</span>
            <span className={styles.stepArrow}>{step.dir === "res" ? "←" : "→"}</span>
            <span className={styles.stepName}>{findNode(api.model, step.node)?.name ?? ""}</span>
            <span className={styles.stepTitle}>{step.title}</span>
            {step.meta.cache && (
              <b className={`${styles.badge} ${step.meta.cache === "HIT" ? styles.badgeHit : styles.badgeMiss}`}>
                {step.meta.cache}
              </b>
            )}
            {step.warns.length > 0 && <b className={`${styles.badge} ${styles.badgeWarn}`}>!</b>}
          </button>
        );
      })}
    </div>
  );
};
