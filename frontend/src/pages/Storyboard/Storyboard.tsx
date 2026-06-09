import { useState, useEffect } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { PaperBg } from "@/shared/components";
import type { ChatMessage as ChatMessageType } from "@/shared/types";
import { useTheme } from "@/hooks/useTheme";
import { getCourseContent, type CourseContent } from "@/services/courseDetail";
import { DEMO_MESSAGES } from "./storyboard.data";
import { StoryboardSidebar } from "./StoryboardSidebar";
import { AtomsSection } from "./sections/AtomsSection";
import { MoleculesSection } from "./sections/MoleculesSection";
import { OrganismsSection } from "./sections/OrganismsSection";
import { CourseSection } from "./sections/CourseSection";
import styles from "./Storyboard.module.css";

const EMPTY_CONTENT: CourseContent = { nodes: {}, edges: [], lessons: [] };

export const Storyboard = () => {
  const { theme, toggleTheme } = useTheme();

  useCopilotReadable({
    description: "Current page: Storyboard — design-system reference (atoms, molecules, organisms)",
    value: { page: "storyboard", route: "/storyboard" },
  });

  const [activeSection, setActiveSection] = useState("atoms");
  const [authTab, setAuthTab] = useState("signin");
  const [messages, setMessages] = useState<ChatMessageType[]>(DEMO_MESSAGES);
  const [cbChecked, setCbChecked] = useState(true);
  const [courseContent, setCourseContent] = useState<CourseContent>(EMPTY_CONTENT);
  const [theoryShown, setTheoryShown] = useState(true);
  const [buildShown, setBuildShown] = useState(true);

  useEffect(() => { getCourseContent(1).then(setCourseContent); }, []);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleChatSubmit = (text: string) => {
    const userMsg: ChatMessageType = { id: Date.now().toString(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
  };

  return (
    <>
      <PaperBg />
      <div className={styles.root}>
        <StoryboardSidebar activeSection={activeSection} theme={theme} toggleTheme={toggleTheme} onScrollTo={scrollTo} />

        <main className={styles.main}>
          <header className={styles.pageHeader}>
            <h1 className={styles.pageTitle}>
              Project Hannibal —{" "}
              <span className={styles.marker}>Component Library</span>
            </h1>
            <p className={styles.pageSub}>
              // 13 atoms · 14 molecules · 11 organisms · 1 design system
            </p>
          </header>

          <AtomsSection theme={theme} toggleTheme={toggleTheme} cbChecked={cbChecked} setCbChecked={setCbChecked} />
          <MoleculesSection authTab={authTab} setAuthTab={setAuthTab} />
          <OrganismsSection theme={theme} toggleTheme={toggleTheme} authTab={authTab} messages={messages} handleChatSubmit={handleChatSubmit} />
          <CourseSection courseContent={courseContent} theoryShown={theoryShown} setTheoryShown={setTheoryShown} buildShown={buildShown} setBuildShown={setBuildShown} />

          <footer style={{
            borderTop: "var(--bw-1) dashed var(--rule)",
            paddingTop: "var(--sp-28)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-xs)",
            color: "var(--ink-faint)",
            display: "flex",
            gap: "var(--sp-24)",
            flexWrap: "wrap" as const,
          }}>
            <span><strong style={{ color: "var(--ink)" }}>13</strong> atoms</span>
            <span><strong style={{ color: "var(--ink)" }}>14</strong> molecules</span>
            <span><strong style={{ color: "var(--ink)" }}>15</strong> organisms</span>
            <span style={{ marginLeft: "auto" }}>project-hannibal · component library · v1</span>
          </footer>
        </main>
      </div>
    </>
  );
};
