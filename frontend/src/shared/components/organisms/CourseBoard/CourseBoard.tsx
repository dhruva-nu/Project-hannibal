import { useRef, useEffect, useState, useCallback } from "react";
import type { Lesson, CourseNodeDef, CourseEdgeDef } from "@/services/courseDetail";
import type { TestResult } from "@/pages/CoursePage/courseTypes";
import type { useCourseState } from "@/pages/CoursePage/useCourseState";
import { Button } from "@/shared/components/atoms/Button/Button";
import { TheoryPanel } from "../TheoryPanel/TheoryPanel";
import { BuildPanel } from "../BuildPanel/BuildPanel";
import styles from "@/pages/CoursePage/CoursePage.module.css";

type CourseHook = ReturnType<typeof useCourseState>;
interface Anchor { x: number; y: number; }

function getAnchor(canvas: HTMLElement, nodeId: string, modId: string | undefined, port: string): Anchor | null {
  const sel = modId
    ? `.service[data-nodeid="${nodeId}"] .module[data-modid="${nodeId}:${modId}"]`
    : `[data-nodeid="${nodeId}"]`;
  const el = canvas.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const cr = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const x = r.left - cr.left;
  const y = r.top - cr.top;
  if (port === "l") return { x, y: y + r.height / 2 };
  if (port === "r") return { x: x + r.width, y: y + r.height / 2 };
  if (port === "t") return { x: x + r.width / 2, y };
  if (port === "b") return { x: x + r.width / 2, y: y + r.height };
  return { x: x + r.width / 2, y: y + r.height / 2 };
}

function ghostAnchor(
  canvas: HTMLElement,
  nodeDefs: Record<string, CourseNodeDef>,
  nodeId: string,
  modId: string | undefined,
  port: string,
): Anchor | null {
  const real = getAnchor(canvas, nodeId, modId, port);
  if (real) return real;
  const n = nodeDefs[nodeId];
  if (!n) return null;
  return { x: (n.x / 100) * canvas.clientWidth, y: (n.y / 100) * canvas.clientHeight };
}

function buildPath(a: Anchor, b: Anchor): string {
  const dx = (b.x - a.x) * 0.4;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

interface CanvasNodesProps {
  revealedNodes: Set<string>;
  revealedMods: Set<string>;
  nodeDefs: Record<string, CourseNodeDef>;
  buildStep: number;
  pendingPlacement: CourseHook["state"]["pendingPlacement"];
  activeLesson: Lesson | null;
}

function CanvasNodes({ revealedNodes, revealedMods, nodeDefs, pendingPlacement }: CanvasNodesProps) {
  return (
    <>
      {Object.entries(nodeDefs).map(([id, n]) => {
        if (revealedNodes.has(id)) return null;
        return (
          <div
            key={`ghost-${id}`}
            className={[styles.ghost, n.kind === "service" ? styles.serviceGhost : ""].join(" ")}
            style={{ left: `${n.x}%`, top: `${n.y}%`, minWidth: n.kind !== "service" ? "70px" : undefined }}
          >?</div>
        );
      })}
      {Object.entries(nodeDefs).map(([id, n]) => {
        if (!revealedNodes.has(id)) return null;
        if (n.kind === "node") {
          return (
            <div key={id} className={[styles.node, styles.nodeShown].join(" ")}
              style={{ left: `${n.x}%`, top: `${n.y}%` }} data-nodeid={id}>
              {n.label}
            </div>
          );
        }
        return (
          <div key={id}
            className={[styles.service, styles.serviceShown].join(" ")}
            style={{ left: `${n.x}%`, top: `${n.y}%` }} data-nodeid={id}>
            <div className={styles.serviceModules}>
              {(n.modules ?? []).map(m => {
                const key = `${id}:${m.id}`;
                if (!revealedMods.has(key)) return null;
                const isPending = pendingPlacement?.kind === "module" && pendingPlacement.id === m.id && pendingPlacement.parent === id;
                return (
                  <div key={m.id}
                    className={[styles.module, styles.moduleShown, isPending ? styles.modulePending : ""].join(" ")}
                    data-modid={key}>{m.label}</div>
                );
              })}
            </div>
            <div className={styles.serviceLabel}>{n.label}</div>
          </div>
        );
      })}
    </>
  );
}

export const CourseBoard = ({ course }: { course: CourseHook }) => {
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

  const currentCode = activeLesson
    ? (state.codeBufs[activeLesson.id] ?? activeLesson.code?.starter ?? "") : "";
  const currentResults: TestResult[] = activeLesson
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
    const paths: { id: string; d: string; ghost: boolean }[] = [];
    edgeDefs.forEach(e => {
      if (revealedEdges.has(e.id)) return;
      if (!revealedNodes.has(e.from) && !revealedNodes.has(e.to)) return;
      const a = ghostAnchor(canvas, nodeDefs, e.from, e.fromMod, e.fromPort);
      const b = ghostAnchor(canvas, nodeDefs, e.to, undefined, e.toPort);
      if (a && b) paths.push({ id: `ghost-${e.id}`, d: buildPath(a, b), ghost: true });
    });
    edgeDefs.forEach(e => {
      if (!revealedEdges.has(e.id) || !revealedNodes.has(e.from) || !revealedNodes.has(e.to)) return;
      if (e.fromMod && !revealedMods.has(`${e.from}:${e.fromMod}`)) return;
      const a = getAnchor(canvas, e.from, e.fromMod, e.fromPort);
      const b = getAnchor(canvas, e.to, undefined, e.toPort);
      if (a && b) paths.push({ id: e.id, d: buildPath(a, b), ghost: false });
    });
    setSvgPaths(paths);
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
        testResults={currentResults} allPass={allPass}
        onCodeChange={code => activeLesson && updateCode(activeLesson.id, code)}
        onRunTests={() => activeLesson && runTests(activeLesson.id, currentCode)}
        onReset={() => { if (activeLesson && window.confirm("reset to starter code?")) resetCode(activeLesson.id); }}
        onPlace={handlePlaceOnBoard} onClose={closeOverlays} />

      <div className={[styles.celebrate, celebrate ? styles.celebrateShown : ""].join(" ")}>
        <div className={styles.celebrateBadge}>✓ shipped! module locked into {celebrateService}</div>
      </div>
    </div>
  );
};
