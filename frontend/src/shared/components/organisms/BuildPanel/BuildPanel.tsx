import { useEffect, useRef } from "react";
import type { Lesson } from "@/services/courseDetail";
import type { TestResult } from "@/pages/CoursePage/courseTypes";
import styles from "@/pages/CoursePage/CoursePage.module.css";

interface BuildPanelProps {
  lesson: Lesson | null;
  shown: boolean;
  full?: boolean;
  code: string;
  testResults: TestResult[];
  allPass: boolean;
  onCodeChange: (code: string) => void;
  onRunTests: () => void;
  onReset: () => void;
  onPlace: () => void;
  onClose: () => void;
}

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

function buildGutter(code: string) {
  const count = code.split("\n").length;
  return Array.from({ length: Math.max(count, 1) }, (_, i) => (
    <span key={i + 1}>{i + 1}</span>
  ));
}

function buildSummary(results: TestResult[]) {
  if (results.length === 0 || results.every(r => r.pass === null)) {
    return { text: 'click "run tests" to verify', cls: styles.testsSummary };
  }
  const passCount = results.filter(r => r.pass).length;
  if (results.every(r => r.pass)) {
    return { text: "✓ all green — place on board", cls: [styles.testsSummary, styles.testsSummaryAllPass].join(" ") };
  }
  return { text: `${results.length - passCount} failing — keep going`, cls: [styles.testsSummary, styles.testsSummarySomeFail].join(" ") };
}

export const BuildPanel = ({ lesson, shown, full, code, testResults, allPass, onCodeChange, onRunTests, onReset, onPlace, onClose }: BuildPanelProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if ((shown || full) && textareaRef.current) {
      textareaRef.current.value = code;
    }
  }, [shown, full, code, lesson?.id]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newVal = el.value.slice(0, start) + "  " + el.value.slice(end);
      el.value = newVal;
      el.selectionStart = el.selectionEnd = start + 2;
      onCodeChange(newVal);
    }
  };

  const passCount = testResults.filter(r => r.pass).length;
  const { text: summaryText, cls: summaryCls } = buildSummary(testResults);
  const panelCls = [
    styles.buildPanel,
    full ? styles.buildPanelFull : (shown ? styles.buildPanelShown : ""),
  ].filter(Boolean).join(" ");

  return (
    <div className={panelCls}>
      <div className={styles.buildHead}>
        <div className={styles.buildHeadLeft}>
          <span className={styles.buildHeadNum}>02</span>
          <span className={styles.buildHeadTitle}>{lesson?.title ?? "Code the module"}</span>
          <span className={styles.buildHeadScribble}>— make tests green</span>
        </div>
        <div className={styles.buildHeadRight}>
          <button
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", padding: "6px 10px", borderRadius: "7px", background: "var(--paper)", border: "1px dashed var(--rule)", color: "var(--ink-soft)", cursor: "pointer" }}
            onClick={onReset}
          >reset code</button>
          <button
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", padding: "6px 10px", borderRadius: "7px", background: "var(--paper)", border: "1px dashed var(--rule)", color: "var(--ink-soft)", cursor: "pointer", display: "grid", placeItems: "center" }}
            onClick={onClose}
            title="close"
          ><CloseIcon /></button>
        </div>
      </div>
      <div className={styles.buildBody}>
        <div className={styles.editorWrap}>
          <div className={styles.editorTabs}>
            <button className={[styles.editorTab, styles.editorTabActive].join(" ")}>
              <span className={styles.editorTabDot} />
              <span>{lesson?.code?.file ?? "module.js"}</span>
            </button>
          </div>
          <div className={styles.editorArea}>
            <div className={styles.gutter}>{buildGutter(code)}</div>
            <textarea
              ref={textareaRef}
              className={styles.editorInput}
              spellCheck={false}
              defaultValue={code}
              onChange={e => onCodeChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className={styles.testsPane}>
          <div className={styles.testsHead}>
            <span>tests</span>
            <span>{passCount} / {testResults.length} passing</span>
          </div>
          <div className={styles.testsList}>
            {testResults.map((r, i) => {
              const status = r.pass === null ? "" : (r.pass ? styles.testItemPass : styles.testItemFail);
              return (
                <div key={i} className={[styles.testItem, status].join(" ")}>
                  <div className={styles.testItemIcon}>{r.pass === null ? "·" : (r.pass ? "✓" : "✗")}</div>
                  <div>{r.name}</div>
                </div>
              );
            })}
          </div>
          <div className={styles.testsFoot}>
            <div className={summaryCls}>{summaryText}</div>
            <button
              style={{ fontFamily: "var(--font-mono)", fontSize: "11px", padding: "6px 10px", borderRadius: "7px", background: "var(--ink)", color: "var(--paper)", border: "1px solid var(--ink)", boxShadow: "2px 2px 0 var(--accent-2)", cursor: "pointer" }}
              onClick={onRunTests}
            >▶ run tests</button>
            <button
              style={{ fontFamily: "var(--font-mono)", fontSize: "11px", padding: "6px 10px", borderRadius: "7px", background: allPass ? "var(--accent-4)" : "var(--paper-2)", color: allPass ? "var(--paper)" : "var(--ink-faint)", border: "1px solid", borderColor: allPass ? "var(--accent-4)" : "var(--rule)", boxShadow: allPass ? "2px 2px 0 var(--ink)" : "none", cursor: allPass ? "pointer" : "not-allowed", opacity: allPass ? 1 : 0.45 }}
              disabled={!allPass}
              onClick={onPlace}
            >place on board ↗</button>
          </div>
        </div>
      </div>
    </div>
  );
};
