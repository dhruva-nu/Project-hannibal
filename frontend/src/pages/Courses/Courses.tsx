import { useState, useEffect } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useAuth } from "@/context/AuthContext";
import { PaperBg } from "@/shared/components/atoms";
import { CourseModal } from "@/shared/components/molecules";
import { Navbar } from "@/shared/components/organisms";
import { useTheme } from "@/hooks/useTheme";
import type { CourseCardProps } from "@/shared/components/molecules/CourseCard/CourseCard";
import {
  getFeaturedCourses, getRecommendedCourses, getLearningPath,
  type Course, type LearningPathStep,
} from "@/services/courses";
import { ILLUSTRATIONS } from "./illustrations";
import { NAV_LINKS } from "./courses.constants";
import { CoursesHeader } from "./CoursesHeader";
import { CoursesFilterBar } from "./CoursesFilterBar";
import { ContinueSection } from "./sections/ContinueSection";
import { FeaturedSection } from "./sections/FeaturedSection";
import { RecommendedSection } from "./sections/RecommendedSection";
import styles from "./Courses.module.css";

type RegularCourse = Extract<CourseCardProps, { isGenUi?: false }>;

function toCardProps(course: Course): RegularCourse {
  return { ...course, illustration: ILLUSTRATIONS[course.code] ?? null };
}

export const Courses = () => {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useCopilotReadable({
    description: "Current page: Courses — browse, filter and pick a course",
    value: { page: "courses", route: "/courses" },
  });
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [aiQuery, setAiQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [selection, setSelection] = useState<{ course: RegularCourse; originRect: DOMRect } | null>(null);
  const [featuredCourses, setFeaturedCourses] = useState<Course[]>([]);
  const [recommendedCourses, setRecommendedCourses] = useState<Course[]>([]);
  const [pathSteps, setPathSteps] = useState<LearningPathStep[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const failedSections: string[] = [];
    const load = <T,>(fetcher: () => Promise<T>, apply: (data: T) => void, section: string) =>
      fetcher()
        .then((data) => { if (!cancelled) apply(data); })
        .catch((err: unknown) => {
          console.error(`load ${section} failed:`, err);
          failedSections.push(section);
          if (!cancelled) setLoadError(`couldn't load ${failedSections.join(", ")} — check your connection and reload`);
        });
    load(getFeaturedCourses, setFeaturedCourses, "featured courses");
    load(getRecommendedCourses, setRecommendedCourses, "recommendations");
    load(getLearningPath, setPathSteps, "your learning path");
    return () => { cancelled = true; };
  }, []);

  const handleAiSubmit = () => { if (aiQuery.trim()) setSubmitted(true); };
  const handleSuggestion = (text: string) => { setAiQuery(text); setSubmitted(false); };
  const handleQueryChange = (val: string) => { setAiQuery(val); setSubmitted(false); };

  const openCourse = (course: Course, e: React.MouseEvent<HTMLElement>) => {
    setSelection({ course: toCardProps(course), originRect: e.currentTarget.getBoundingClientRect() });
  };

  return (
    <>
      <PaperBg />
      <div className={styles.stage}>
        <Navbar links={NAV_LINKS} theme={theme} onThemeToggle={toggleTheme} onLogout={logout} />

        <CoursesHeader
          aiQuery={aiQuery}
          submitted={submitted}
          onQueryChange={handleQueryChange}
          onSubmit={handleAiSubmit}
          onSuggestion={handleSuggestion}
        />

        <CoursesFilterBar activeFilter={activeFilter} onFilter={setActiveFilter} />

        <main className={styles.main}>
          {loadError && <p className={styles.loadError} role="alert">{loadError}</p>}
          <ContinueSection pathSteps={pathSteps} />
          <FeaturedSection courses={featuredCourses} openCourse={openCourse} />
          <RecommendedSection courses={recommendedCourses} openCourse={openCourse} />
        </main>
      </div>

      {selection && (
        <CourseModal course={selection.course} originRect={selection.originRect} onClose={() => setSelection(null)} />
      )}
    </>
  );
};
