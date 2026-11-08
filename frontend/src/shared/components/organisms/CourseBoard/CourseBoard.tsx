import { useRef, useEffect, useState, useCallback } from "react";
import type { useCourseState } from "@/pages/CoursePage/useCourseState";
import { Button } from "@/shared/components/atoms/Button/Button";
import { TheoryPanel } from "../TheoryPanel/TheoryPanel";
import { buildEdgePaths } from "./canvasUtils";
import styles from "./CourseBoard.module.css";

type CourseHook = ReturnType<typeof useCourseState>;

interface CourseBoardProps {
  course: CourseHook;
}

export const CourseBoard = ({ course }: CourseBoardProps) => {
  const { state, content, markTheoryDone, closeOverlays } = course;
  const { nodes: nodeDefs, edges: edgeDefs, lessons } = content;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [svgPaths, setSvgPaths] = useState<{ id: string; d: string; ghost: boolean }[]>([]);

  const { nodes: revealedNodes, edges: revealedEdges, mods: revealedMods } = course.getRevealed();
  const activeLesson = lessons.find(l => l.id === state.activeId) ?? null;
  const isTheoryShown = state.theoryOpen;
  const derivedTab: "theory" | "design" = isTheoryShown ? "theory" : "design";
  const [prevDerived, setPrevDerived] = useState(derivedTab);
  const [activeTab, setActiveTab] = useState(derivedTab);
  if (prevDerived !== derivedTab) { setPrevDerived(derivedTab); setActiveTab(derivedTab); }
  const alreadyDone = !!activeLesson && state.completed.has(activeLesson.id);

  const redrawEdges = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSvgPaths(buildEdgePaths(canvas, nodeDefs, edgeDefs, revealedNodes, revealedEdges, revealedMods));
  }, [revealedNodes, revealedEdges, revealedMods, nodeDefs, edgeDefs]);

  useEffect(() => { const t = setTimeout(redrawEdges, 50); return () => clearTimeout(t); }, [redrawEdges]);
  useEffect(() => { window.addEventListener("resize", redrawEdges); return () => window.removeEventListener("resize", redrawEdges); }, [redrawEdges]);

  return (
    <div className={styles.boardArea}>
      <div className={styles.boardToolbar}>
        <div className={styles.boardTag}>
          <span className={styles.liveDot} />
          <span>your build · <b>otp-system</b></span>
        </div>
        <div className={styles.boardActions}>
          {isTheoryShown && (
            <div className={styles.boardTabToggle}>
              <button
                className={[styles.boardTabBtn, activeTab !== "design" && styles.boardTabBtnActive].filter(Boolean).join(" ")}
                onClick={() => setActiveTab("theory")}
              >theory</button>
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
        {revealedNodes.size === 0 && !state.activeId && (
          <div className={styles.emptyHint}>
            <div className={styles.emptyHintBig}>empty board</div>
            <div className={styles.emptyHintSmall}>pick a lesson on the left to begin →</div>
          </div>
        )}
      </div>

      <TheoryPanel lesson={activeLesson} shown={isTheoryShown} full={activeTab === "theory" && isTheoryShown} alreadyDone={alreadyDone}
        onClose={closeOverlays} onDone={markTheoryDone} />

    </div>
  );
};
