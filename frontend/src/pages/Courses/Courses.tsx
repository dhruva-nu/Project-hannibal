import { useState, useEffect, ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { PaperBg, Badge, Input } from "@/shared/components/atoms";
import { CourseCard, CourseModal } from "@/shared/components/molecules";
import { Navbar, LearningPath } from "@/shared/components/organisms";
import { useTheme } from "@/hooks/useTheme";
import type { CourseCardProps } from "@/shared/components/molecules/CourseCard/CourseCard";
import {
  getFeaturedCourses,
  getRecommendedCourses,
  getLearningPath,
  type Course,
  type LearningPathStep,
} from "@/services/courses";
import styles from "./Courses.module.css";

type RegularCourse = Extract<CourseCardProps, { isGenUi?: false }>;

// ── Illustrations live here — they are UI, not data ──────
const ILLUSTRATIONS: Record<string, ReactNode> = {
  "course.001": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="100" y="30" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="100" y="80" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="180" y="50" width="40" height="30" rx="6" fill="var(--paper)" />
        <path d="M70 65 L 100 45" strokeDasharray="3 3" />
        <path d="M70 65 L 100 95" strokeDasharray="3 3" />
        <path d="M150 45 L 180 65" strokeDasharray="3 3" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="32" y="70">user</text>
        <text x="110" y="50">api</text>
        <text x="108" y="100">redis</text>
        <text x="186" y="70">sms</text>
      </g>
    </svg>
  ),
  "course.002": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <circle cx="40" cy="65" r="20" fill="var(--paper)" />
        <circle cx="200" cy="65" r="20" fill="var(--paper)" />
        <rect x="100" y="45" width="50" height="40" rx="6" fill="var(--paper)" />
        <path d="M60 55 Q 90 35 100 55" strokeDasharray="3 3" />
        <path d="M60 75 Q 90 95 100 75" strokeDasharray="3 3" />
        <path d="M150 55 Q 175 45 180 55" strokeDasharray="3 3" />
        <path d="M150 75 Q 175 85 180 75" strokeDasharray="3 3" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="30" y="68">you</text>
        <text x="113" y="68">app</text>
        <text x="186" y="68">google</text>
      </g>
    </svg>
  ),
  "course.003": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="55" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="20" y="80" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="20" y="30" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="100" y="50" width="60" height="30" rx="6" fill="var(--paper)" />
        <rect x="190" y="50" width="40" height="30" rx="6" fill="var(--paper)" />
        <path d="M60 40 L 100 60" strokeDasharray="3 3" />
        <path d="M60 65 L 100 65" strokeDasharray="3 3" />
        <path d="M60 90 L 100 70" strokeDasharray="3 3" stroke="var(--accent-2)" />
        <path d="M160 65 L 190 65" strokeDasharray="3 3" />
        <text x="68" y="98" fontFamily="Caveat" fontSize="12" fill="var(--accent-2)">429!</text>
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="115" y="68">limiter</text>
        <text x="200" y="68">api</text>
      </g>
    </svg>
  ),
  "course.004": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="40" height="30" rx="4" fill="var(--paper)" />
        <rect x="80" y="40" width="80" height="50" rx="4" fill="var(--paper)" />
        <line x1="100" y1="40" x2="100" y2="90" strokeDasharray="2 2" />
        <line x1="120" y1="40" x2="120" y2="90" strokeDasharray="2 2" />
        <line x1="140" y1="40" x2="140" y2="90" strokeDasharray="2 2" />
        <rect x="180" y="35" width="40" height="22" rx="4" fill="var(--paper)" />
        <rect x="180" y="73" width="40" height="22" rx="4" fill="var(--paper)" />
        <path d="M60 65 L 80 65" strokeDasharray="3 3" />
        <path d="M160 50 L 180 46" strokeDasharray="3 3" />
        <path d="M160 80 L 180 84" strokeDasharray="3 3" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="28" y="68">job</text>
        <text x="106" y="68">queue</text>
        <text x="186" y="50">w1</text>
        <text x="186" y="89">w2</text>
      </g>
    </svg>
  ),
  "course.005": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="170" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="100" y="20" width="40" height="20" rx="4" fill="var(--paper)" strokeDasharray="3 3" />
        <rect x="100" y="55" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="100" y="90" width="40" height="20" rx="4" fill="var(--paper)" strokeDasharray="3 3" />
        <path d="M70 65 L 100 30" strokeDasharray="3 3" />
        <path d="M70 65 L 100 65" />
        <path d="M70 65 L 100 100" strokeDasharray="3 3" />
        <path d="M140 65 L 170 65" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="32" y="68">us</text>
        <text x="180" y="68">you</text>
        <text x="108" y="68">retry</text>
      </g>
    </svg>
  ),
  "picked.001": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="60" y="40" width="50" height="50" rx="6" fill="var(--paper)" />
        <rect x="140" y="40" width="50" height="50" rx="6" fill="var(--paper)" />
        <path d="M110 65 L 140 65" strokeDasharray="3 3" />
        <text x="78" y="68" fontFamily="Caveat" fontSize="14" fill="var(--accent-2)">2FA</text>
        <text x="158" y="68" fontFamily="Caveat" fontSize="14" fill="var(--accent-3)">TOTP</text>
      </g>
    </svg>
  ),
  "picked.002": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <circle cx="60" cy="65" r="20" fill="var(--paper)" />
        <circle cx="120" cy="40" r="14" fill="var(--paper)" />
        <circle cx="120" cy="90" r="14" fill="var(--paper)" />
        <circle cx="180" cy="65" r="20" fill="var(--paper)" />
        <path d="M80 60 L 108 45" strokeDasharray="3 3" />
        <path d="M80 75 L 108 88" strokeDasharray="3 3" />
        <path d="M132 45 L 162 60" strokeDasharray="3 3" />
        <path d="M132 88 L 162 75" strokeDasharray="3 3" />
      </g>
    </svg>
  ),
  "picked.003": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="60" height="30" rx="4" fill="var(--paper)" />
        <rect x="100" y="50" width="60" height="30" rx="4" fill="var(--paper)" />
        <rect x="180" y="50" width="40" height="30" rx="4" fill="var(--paper)" />
        <path d="M80 65 L 100 65" />
        <path d="M160 65 L 180 65" />
        <path d="M50 50 Q 50 30, 130 30 Q 200 30, 200 50" strokeDasharray="3 3" stroke="var(--accent-2)" />
        <text x="116" y="26" fontFamily="Caveat" fontSize="12" fill="var(--accent-2)">cache</text>
      </g>
    </svg>
  ),
};

function toCardProps(course: Course): RegularCourse {
  return {
    ...course,
    illustration: ILLUSTRATIONS[course.code] ?? null,
  };
}

const FILTER_CATEGORIES = [
  "Auth & Identity",
  "Distributed systems",
  "Databases",
  "APIs & Networking",
  "Frontend systems",
  "DevOps",
] as const;

const AI_SUGGESTIONS = ["add OTP to my app", "understand consensus", "I'm prepping for FAANG"];

const NAV_LINKS = [
  { label: "Courses", href: "/courses" },
  { label: "Tracks", href: "#" },
  { label: "For teams", href: "#" },
  { label: "Sign in", href: "#" },
];

export const Courses = () => {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [aiQuery, setAiQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [selection, setSelection] = useState<{ course: RegularCourse; originRect: DOMRect } | null>(null);

  const [featuredCourses, setFeaturedCourses] = useState<Course[]>([]);
  const [recommendedCourses, setRecommendedCourses] = useState<Course[]>([]);
  const [pathSteps, setPathSteps] = useState<LearningPathStep[]>([]);

  useEffect(() => {
    getFeaturedCourses().then(setFeaturedCourses);
    getRecommendedCourses().then(setRecommendedCourses);
    getLearningPath().then(setPathSteps);
  }, []);

  const handleAiSubmit = () => {
    if (!aiQuery.trim()) return;
    setSubmitted(true);
  };

  const handleSuggestion = (text: string) => {
    setAiQuery(text);
    setSubmitted(false);
  };

  const openCourse = (course: Course, e: React.MouseEvent<HTMLElement>) => {
    setSelection({ course: toCardProps(course), originRect: e.currentTarget.getBoundingClientRect() });
  };

  return (
    <>
      <PaperBg />
      <div className={styles.stage}>
        <Navbar
          links={NAV_LINKS}
          theme={theme}
          onThemeToggle={toggleTheme}
          onLogout={logout}
        />

        {/* ── Page header ── */}
        <header className={styles.pageHeader}>
          <div className={styles.headerLeft}>
            <Badge label="/courses · genUI" showDot />
            <h1 className={styles.title}>
              <span className={styles.marker}>Build</span>, don&apos;t browse.
              <br />
              <span className={styles.scribble}>— pick something to make today.</span>
            </h1>
            <p className={styles.lede}>
              Every course is a real artifact you ship. Or —{" "}
              <strong>ask the tutor</strong> to design a custom path for what you&apos;re trying to build.
            </p>
          </div>

          <div className={styles.aiBar}>
            <span className={styles.aiBarTag}>tutor.prompt</span>
            <Input
              promptMark="$"
              placeholder="describe what you want to build…"
              value={aiQuery}
              onChange={(e) => {
                setAiQuery(e.target.value);
                setSubmitted(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleAiSubmit()}
              aria-label="Describe what you want to build"
              suffix={
                <button
                  className={styles.sendBtn}
                  onClick={handleAiSubmit}
                  aria-label="Submit prompt"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </button>
              }
            />
            {submitted && aiQuery && (
              <p className={styles.aiResponse}>
                Curating courses for: &ldquo;{aiQuery}&rdquo; — refining picks…
              </p>
            )}
            {!submitted && (
              <div className={styles.aiSuggestions}>
                {AI_SUGGESTIONS.map((s) => (
                  <button key={s} className={styles.suggestion} onClick={() => handleSuggestion(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* ── Filter bar ── */}
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>filter →</span>
          <button
            className={[styles.filterChip, activeFilter === "All" && styles.filterChipActive].filter(Boolean).join(" ")}
            onClick={() => setActiveFilter("All")}
          >
            All <span className={styles.filterX}>·</span> 24
          </button>
          {FILTER_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={[styles.filterChip, activeFilter === cat && styles.filterChipActive].filter(Boolean).join(" ")}
              onClick={() => setActiveFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <main className={styles.main}>
          {/* ── Section: Continue your build ── */}
          <section className={styles.section} aria-labelledby="section-continue">
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}>
                <h2 id="section-continue">Continue your build</h2>
                <span className={styles.scribble}>— picking up where you left off</span>
                <span className={styles.count}>02 in progress</span>
              </div>
              <div className={styles.sectionActions}>
                <button className={styles.actionBtn}>view all</button>
              </div>
            </div>
            <LearningPath steps={pathSteps} stickyNote="tutor said: skip step 4 if you already know JWTs ✦" />
          </section>

          {/* ── Section: Featured builds ── */}
          <section className={styles.section} aria-labelledby="section-featured">
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}>
                <h2 id="section-featured">Featured builds</h2>
                <span className={styles.scribble}>— most started this week</span>
                <span className={styles.count}>06 / 24</span>
              </div>
              <div className={styles.sectionActions}>
                <button className={styles.actionBtn}>sort: popular ▾</button>
                <button className={[styles.actionBtn, styles.aiAction].join(" ")}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 3v18M3 12h18" />
                  </svg>
                  curate for me
                </button>
              </div>
            </div>
            <div className={styles.grid}>
              {featuredCourses.map((course, i) => (
                <CourseCard key={course.code} {...toCardProps(course)} onClick={(e) => openCourse(course, e)} />
              ))}
              <CourseCard
                isGenUi
                genUiLabel="Don't see what you need?"
                genUiHint={"tell the tutor — it'll generate\na custom course in this slot"}
              />
            </div>
          </section>

          {/* ── Section: AI recommended ── */}
          <section className={styles.section} aria-labelledby="section-recommended">
            <div className={styles.genuiBanner}>
              <div className={styles.aiIcon}>PH</div>
              <div className={styles.bannerText}>
                <strong>Tutor synthesized this section just now</strong> — based on your last build (OTP) and what&apos;s trending in your team. Tap any card to refine.
              </div>
              <div className={styles.bannerMeta}>
                <span className={styles.liveDot} aria-hidden="true" />
                <span>fresh · 12s ago</span>
              </div>
            </div>

            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}>
                <h2 id="section-recommended">What to learn next</h2>
                <span className={styles.scribble}>— recommended for you</span>
                <span className={styles.count}>04 picks</span>
              </div>
              <div className={styles.sectionActions}>
                <button className={[styles.actionBtn, styles.aiAction].join(" ")}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 12a9 9 0 1 0 9-9M3 3v6h6" />
                  </svg>
                  regenerate
                </button>
                <button className={styles.actionBtn}>pin section</button>
              </div>
            </div>

            <div className={styles.grid}>
              {recommendedCourses.map((course, i) => (
                <CourseCard key={course.code} {...toCardProps(course)} onClick={(e) => openCourse(course, e)} />
              ))}
              <CourseCard
                isGenUi
                genUiSymbol="⌘ K"
                genUiLabel="Generate a path for what you're building"
                genUiHint={"\"add billing\", \"make it real-time\",\n\"design a feed\"…"}
              />
            </div>
          </section>
        </main>
      </div>

      {selection && (
        <CourseModal course={selection.course} originRect={selection.originRect} onClose={() => setSelection(null)} />
      )}
    </>
  );
};
