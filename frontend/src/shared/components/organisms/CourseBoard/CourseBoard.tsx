import { useRef, useEffect, useState, useCallback } from "react";
import type { useCourseState } from "@/pages/CoursePage/useCourseState";
import { Button } from "@/shared/components/atoms/Button/Button";
import { TheoryPanel } from "../TheoryPanel/TheoryPanel";
import { BuildPanel } from "../BuildPanel/BuildPanel";
import { CanvasNodes, buildEdgePaths } from "./CanvasNodes";
import styles from "./CourseBoard.module.css";

type CourseHook = ReturnType<typeof useCourseState>;

interface CourseBoardProps {
  course: CourseHook;
  language?: string;
  onLanguageChange?: (lang: string) => void;
}

export const CourseBoard = ({ course, language = "javascript", onLanguageChange }: CourseBoardProps) => {
  const { state, content, markTheoryDone, closeOverlays, runTests, updateCode, resetCode, placeOnBoard } = course;
  const { nodes: nodeDefs, edges: edgeDefs, lessons } = content;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateService, setCelebrateService] = useState("the board");
  const [activeTab, setActiveTab] = useState<"theory" | "build" | "design">("design");
  const [svgPaths, setSvgPaths] = useState<{ id: string; d: string; ghost: boolean }[]>([]);

  const { nodes: revealedNodes, edges: revealedEdges, mods: revealedMods } = course.getRevealed();
  const activeLesson = lessons.find(l => l.id === state.activeId) ?? null;
  const isTheoryShown = state.theoryOpen;
  const isBuildShown = !!activeLesson && activeLesson.kind === "build" && state.buildStep === 2;
  const isTaskRibbonShown = state.buildStep === 2;
  const alreadyDone = !!activeLesson && state.completed.has(activeLesson.id);

  const currentCode = activeLesson ? (state.codeBufs[activeLesson.id] ?? activeLesson.code?.starter ?? "") : "";
  const currentResults = activeLesson
    ? (state.testResults[activeLesson.id] ?? activeLesson.code?.tests.map(t => ({ name: t.name, pass: null })) ?? []) : [];
  const allPass = currentResults.length > 0 && currentResults.every(r => r.pass === true);

  useEffect(() => {
    if (isTheoryShown) setActiveTab("theory");
    else if (isBuildShown) setActiveTab("build");
    else setActiveTab("design");
  }, [isTheoryShown, isBuildShown]);

  const redrawEdges = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSvgPaths(buildEdgePaths(canvas, nodeDefs, edgeDefs, revealedNodes, revealedEdges, revealedMods));
  }, [revealedNodes, revealedEdges, revealedMods, nodeDefs, edgeDefs]);

  useEffect(() => { const t = setTimeout(redrawEdges, 50); return () => clearTimeout(t); }, [redrawEdges]);
  useEffect(() => { window.addEventListener("resize", redrawEdges); return () => window.removeEventListener("resize", redrawEdges); }, [redrawEdges]);

  const handlePlaceOnBoard = () => {
    if (!activeLesson) return;
    const svcId = activeLesson.target?.type === "service" ? activeLesson.target.serviceId : undefined;
    const svcLabel = svcId ? (nodeDefs[svcId]?.label ?? "the board") : "the board";
    placeOnBoard();
    setCelebrateService(svcLabel);
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 1800);
  };

  return (
    <div className={styles.boardArea}>
      <div className={styles.boardToolbar}>
        <div className={styles.boardTag}>
          <span className={styles.liveDot} />
          <span>your build · <b>otp-system</b></span>
        </div>
        <div className={styles.boardActions}>
          {(isTheoryShown || isBuildShown) && (
            <div className={styles.boardTabToggle}>
              <button
                className={[styles.boardTabBtn, activeTab !== "design" && styles.boardTabBtnActive].filter(Boolean).join(" ")}
                onClick={() => setActiveTab(isTheoryShown ? "theory" : "build")}
              >{isTheoryShown ? "theory" : "build"}</button>
              <button
                className={[styles.boardTabBtn, activeTab === "design" && styles.boardTabBtnActive].filter(Boolean).join(" ")}
                onClick={() => setActiveTab("design")}
              >design</button>
            </div>
          )}
          <Button variant="ghost" onClick={() => {
            const data = { course: "otp-system", progress: `${state.completed.size}/${lessons.length}`, revealed: [...revealedNodes] };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "build.json"; a.click();
          }}>export json</Button>
        </div>
      </div>

      <div className={[styles.boardFrame, activeTab !== "design" ? styles.boardCanvasHidden : ""].filter(Boolean).join(" ")} />
      <div className={[styles.boardLabel, activeTab !== "design" ? styles.boardCanvasHidden : ""].filter(Boolean).join(" ")}>System design — OTP</div>

      <div className={[styles.boardCanvas, activeTab !== "design" ? styles.boardCanvasHidden : ""].filter(Boolean).join(" ")} ref={canvasRef}>
        <svg className={styles.edgesSvg}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-3)" />
            </marker>
          </defs>
          {svgPaths.map(p => p.ghost
            ? <path key={p.id} d={p.d} stroke="var(--ink-faint)" strokeWidth={1} strokeDasharray="2 6" fill="none" opacity={0.15} />
            : <path key={p.id} d={p.d} stroke="var(--accent-3)" strokeWidth={1.8} fill="none" strokeDasharray="5 4" markerEnd="url(#arrow)" />
          )}
        </svg>
        {revealedNodes.size === 0 && state.buildStep === 0 && (
          <div className={styles.emptyHint}>
            <div className={styles.emptyHintBig}>empty board</div>
            <div className={styles.emptyHintSmall}>pick a lesson on the left to begin →</div>
          </div>
        )}
        <CanvasNodes
          revealedNodes={revealedNodes} revealedMods={revealedMods}
          nodeDefs={nodeDefs} buildStep={state.buildStep}
          pendingPlacement={state.pendingPlacement} activeLesson={activeLesson}
        />
      </div>

      <div className={[styles.taskRibbon, isTaskRibbonShown && activeTab === "design" ? styles.taskRibbonShown : ""].join(" ")}>
        <span className={styles.taskNum}>01</span>
        <span dangerouslySetInnerHTML={{ __html: `Make the tests green — file <b>${activeLesson?.code?.file ?? ""}</b>` }} />
      </div>

      <TheoryPanel lesson={activeLesson} shown={isTheoryShown} full={activeTab === "theory" && isTheoryShown} alreadyDone={alreadyDone}
        onClose={closeOverlays} onDone={markTheoryDone} />

      <BuildPanel lesson={activeLesson} shown={isBuildShown} full={activeTab === "build" && isBuildShown} code={currentCode}
        testResults={currentResults} allPass={allPass} language={language} onLanguageChange={onLanguageChange ?? (() => {})}
        streamOutput={state.streamOutput} isStreaming={state.isStreaming}
        onCodeChange={code => activeLesson && updateCode(activeLesson.id, code)}
        onRunTests={() => activeLesson && runTests(activeLesson.id, currentCode, language)}
        onReset={() => { if (activeLesson && window.confirm("reset to starter code?")) resetCode(activeLesson.id); }}
        onPlace={handlePlaceOnBoard} onClose={closeOverlays} />

      <div className={[styles.celebrate, celebrate ? styles.celebrateShown : ""].join(" ")}>
        <div className={styles.celebrateBadge}>✓ shipped! module locked into {celebrateService}</div>
      </div>
    </div>
  );
};
