import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { BrandMark, Button, ThemeToggle, PaperBg } from "@/shared/components/atoms";
import { LessonsPanel } from "@/shared/components/organisms/LessonsPanel/LessonsPanel";
import { CourseBoard } from "@/shared/components/organisms/CourseBoard/CourseBoard";
import { useTheme } from "@/hooks/useTheme";
import { useCourseState, type InitialProgress } from "./useCourseState";
import { getCourseContent, translateBuildBlock, type CourseContent } from "@/services/courseDetail";
import { getCourseProgress } from "@/services/progress";
import { getNodePlacement, type PlacedNode } from "@/services/nodes";
import styles from "./CoursePage.module.css";

const EMPTY_CONTENT: CourseContent = { nodes: {}, edges: [], lessons: [] };

export const CoursePage = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const { theme, toggleTheme } = useTheme();
  const [content, setContent] = useState<CourseContent>(EMPTY_CONTENT);
  const [initialProgress, setInitialProgress] = useState<InitialProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);

  useEffect(() => {
    if (courseId) getCourseContent(Number(courseId)).then(setContent);
  }, [courseId]);

  useEffect(() => {
    if (!courseId) return;
    const id = Number(courseId);
    setProgressLoading(true);
    getCourseProgress(id).then(async progress => {
      if (!progress) return;
      const placedNodes = await rehydratePlacedNodes(progress.placedNodeIds);
      setInitialProgress({
        completedLessonIds: progress.completedLessonIds.map(String),
        activeLessonId: progress.activeLessonId !== null ? String(progress.activeLessonId) : null,
        placedNodes,
      });
    }).catch(err => {
      console.error("load progress failed:", err);
    }).finally(() => {
      setProgressLoading(false);
    });
  }, [courseId]);

  const [language, setLanguage] = useState("python");
  const course = useCourseState(content, {
    courseId: courseId ? Number(courseId) : undefined,
    initialProgress,
  });
  const { state, resetAll, getRevealed, openLesson, updateCode, initBuildTests } = course;

  const handleOpenLesson = useCallback((id: string) => {
    openLesson(id);
    const lesson = content.lessons.find(l => l.id === id);
    if (!lesson || lesson.kind !== "build") return;
    translateBuildBlock(lesson.nosqlId, language)
      .then(code => updateCode(lesson.id, code))
      .catch(() => { });
    initBuildTests(lesson.id, lesson.nosqlId).catch(() => { });
  }, [content.lessons, language, openLesson, updateCode, initBuildTests]);

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang);
    const lesson = content.lessons.find(l => l.id === state.activeId);
    if (!lesson || lesson.kind !== "build") return;
    translateBuildBlock(lesson.nosqlId, lang)
      .then(code => updateCode(lesson.id, code))
      .catch(() => { });
  }, [content.lessons, state.activeId, updateCode]);

  const completedCount = state.completed.size;
  const total = content.lessons.length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  const handleReset = () => {
    if (window.confirm("reset all progress?")) resetAll();
  };

  const handleExport = () => {
    const data = {
      course: courseId,
      progress: `${completedCount}/${total}`,
      revealed: [...getRevealed().nodes],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "build.json";
    a.click();
  };

  return (
    <div className={styles.stage} data-theme={theme}>
      <PaperBg />

      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <a className={styles.brand} href="/home" aria-label="Home">
            <BrandMark />
          </a>
          <span className={styles.crumb}>
            /<a href="/courses" style={{ color: "inherit", textDecoration: "none" }}>courses</a>/<b>{courseId}</b>
          </span>
        </div>
        <div className={styles.topRight}>
          <div className={styles.progressPill}>
            <span>{completedCount} / {total} lessons</span>
            <div className={styles.progressBar}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
          <Button variant="ghost" onClick={handleReset}>reset</Button>
          <Button variant="ghost" onClick={handleExport}>export json</Button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <div className={styles.main}>
        <LessonsPanel
          lessons={content.lessons}
          completed={state.completed}
          activeId={state.activeId}
          onSelect={handleOpenLesson}
          isUnlocked={course.isUnlocked}
          progressLoading={progressLoading}
        />
        <CourseBoard course={course} language={language} onLanguageChange={handleLanguageChange} />
      </div>
    </div>
  );
};

async function rehydratePlacedNodes(rootIds: string[]): Promise<PlacedNode[]> {
  if (rootIds.length === 0) return [];
  const groups = await Promise.all(
    rootIds.map(id => getNodePlacement(id).catch(() => [] as PlacedNode[])),
  );
  const seen = new Set<string>();
  const merged: PlacedNode[] = [];
  for (const group of groups) {
    for (const node of group) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      merged.push(node);
    }
  }
  return merged;
}
