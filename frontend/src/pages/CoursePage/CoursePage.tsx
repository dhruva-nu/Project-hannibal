import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import boardStyles from "../DesignBoard/DesignBoard.module.css";
import { BrandMark } from "@/shared/components/atoms/BrandMark/BrandMark";
import { Button } from "@/shared/components/atoms/Button/Button";
import { ThemeToggle } from "@/shared/components/atoms/ThemeToggle/ThemeToggle";
import { PaperBg } from "@/shared/components/atoms/PaperBg/PaperBg";
import { LessonsPanel } from "@/shared/components/organisms/LessonsPanel/LessonsPanel";
import { CourseBoard } from "@/shared/components/organisms/CourseBoard/CourseBoard";
import { useTheme } from "@/hooks/useTheme";
import { useCourseState } from "./useCourseState";
import { getCourseContent, type CourseContent } from "@/services/courseDetail";
import styles from "./CoursePage.module.css";

const EMPTY_CONTENT: CourseContent = { nodes: {}, edges: [], lessons: [] };

export const CoursePage = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const { theme, toggleTheme } = useTheme();
  const [content, setContent] = useState<CourseContent>(EMPTY_CONTENT);

  useEffect(() => {
    if (courseId) getCourseContent(Number(courseId)).then(setContent);
  }, [courseId]);

  const course = useCourseState(content);
  const { state, resetAll, getRevealed } = course;

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
    <div className={boardStyles.stage} data-theme={theme}>
      <PaperBg />

      <header className={boardStyles.topbar}>
        <div className={boardStyles.topLeft}>
          <a className={boardStyles.brand} href="/home" aria-label="Home">
            <BrandMark />
          </a>
          <span className={boardStyles.crumb}>
            /<a href="/courses" style={{ color: "inherit", textDecoration: "none" }}>courses</a>/<b>{courseId}</b>
          </span>
        </div>
        <div className={boardStyles.topRight}>
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
          onSelect={course.openLesson}
          isUnlocked={course.isUnlocked}
        />
        <CourseBoard course={course} />
      </div>
    </div>
  );
};
