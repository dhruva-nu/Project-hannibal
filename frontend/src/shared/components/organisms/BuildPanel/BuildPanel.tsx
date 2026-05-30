import { useEffect, useRef } from "react";
import type { Lesson } from "@/services/courseDetail";
import type { TestResult } from "@/pages/CoursePage/courseTypes";
import { RunError } from "@/shared/components/molecules/RunError/RunError";
import styles from "./BuildPanel.module.css";

const LANGUAGES = ["javascript", "python", "zig", "go"] as const;

interface BuildPanelProps {
  lesson: Lesson | null;
  shown: boolean;
  full?: boolean;
  code: string;
  testResults: TestResult[];
  allPass: boolean;
  language: string;
  streamOutput: string[];
  isStreaming: boolean;
  runError: string | null;
  onLanguageChange: (lang: string) => void;
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
  const failCount = results.filter(r => r.pass === false).length;
  if (results.every(r => r.pass === true)) {
    return { text: "✓ all green — place on board", cls: [styles.testsSummary, styles.testsSummaryAllPass].join(" ") };
  }
  if (failCount === 0) {
    return { text: 'click "run tests" to verify', cls: styles.testsSummary };
  }
  return { text: `${failCount} failing — keep going`, cls: [styles.testsSummary, styles.testsSummarySomeFail].join(" ") };
}

export const BuildPanel = ({ lesson, shown, full, code, testResults, allPass, language, streamOutput, isStreaming, runError, onLanguageChange, onCodeChange, onRunTests, onReset, onPlace, onClose }: BuildPanelProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ((shown || full) && textareaRef.current) {
      textareaRef.current.value = code;
    }
  }, [shown, full, code, lesson?.id]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamOutput]);

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

  const passCount = testResults.filter(r => r.pass === true).length;
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
          <select
            value={language}
            onChange={e => onLanguageChange(e.target.value)}
            className={styles.selectInput}
          >
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button className={styles.ghostBtn} onClick={onReset}>reset code</button>
          <button className={styles.iconBtn} onClick={onClose} title="close"><CloseIcon /></button>
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
          <div
            ref={outputRef}
            className={[styles.outputPane, (isStreaming || streamOutput.length > 0) ? styles.outputPaneActive : ""].filter(Boolean).join(" ")}
          >
            {isStreaming && streamOutput.length === 0 && (
              <span className={styles.outputRunning}>▶ running...</span>
            )}
            {streamOutput.map((line, i) => (
              <div key={i} className={styles.outputLine}>{line}</div>
            ))}
            {!isStreaming && streamOutput.length > 0 && (
              <div className={styles.outputDone}>— done —</div>
            )}
          </div>
        </div>
        <div className={styles.testsPane}>
          <div className={styles.testsHead}>
            <span>tests</span>
            <span>{passCount} / {testResults.length} passing</span>
          </div>
          {runError && <RunError message={runError} />}
          <div className={styles.testsList}>
            {testResults.map((r, i) => {
              const status = r.pass === null ? "" : (r.pass ? styles.testItemPass : styles.testItemFail);
              return (
                <div key={i} className={[styles.testItem, status].join(" ")}>
                  <div className={styles.testItemIcon}>{r.pass === null ? "·" : (r.pass ? "✓" : "✗")}</div>
                  <div>
                    <div>{r.name}</div>
                    {r.description && <div className={styles.testItemDesc}>{r.description}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className={styles.testsFoot}>
            <div className={summaryCls}>{summaryText}</div>
            <button className={styles.runBtn} onClick={onRunTests} disabled={isStreaming}>
              {isStreaming ? "▶ running..." : "▶ run tests"}
            </button>
            <button
              className={[styles.placeBtn, allPass ? styles.placeBtnReady : styles.placeBtnWaiting].join(" ")}
              disabled={!allPass}
              onClick={onPlace}
            >place on board ↗</button>
          </div>
        </div>
      </div>
    </div>
  );
};
