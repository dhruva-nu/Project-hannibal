import type { CourseContent } from "@/services/courseDetail";
import { LessonsPanel, TheoryPanel, BuildPanel } from "@/shared/components";
import { CourseBoardDemo } from "../CourseBoardDemo";
import { OrgStory } from "../OrgStory";
import styles from "../Storyboard.module.css";

interface CourseSectionProps {
  courseContent: CourseContent;
  theoryShown: boolean;
  setTheoryShown: (v: boolean) => void;
  buildShown: boolean;
  setBuildShown: (v: boolean) => void;
}

export const CourseSection = ({ courseContent, theoryShown, setTheoryShown, buildShown, setBuildShown }: CourseSectionProps) => (
  <section id="course" className={styles.section}>
    <div className={styles.sectionHeader} data-label="course experience">
      <span className={styles.sectionNum}>04</span>
      <h2 className={styles.sectionTitle}>CoursePage</h2>
      <span className={styles.sectionDesc}>4 components</span>
    </div>

    <div className={styles.gridFull}>
      <OrgStory name="LessonsPanel — lesson list with progress">
        <div style={{ height: 500, overflow: "hidden", display: "grid", gridTemplateColumns: "300px" }}>
          <LessonsPanel
            lessons={courseContent.lessons}
            completed={new Set(["l1", "l2"])}
            activeId="l3"
            onSelect={() => {}}
            isUnlocked={(idx) => idx <= 2}
          />
        </div>
      </OrgStory>

      <OrgStory name="TheoryPanel — full mode (replaces board)">
        <div style={{ position: "relative", height: 420, overflow: "hidden", background: "var(--paper)", border: "1px dashed var(--rule)", borderRadius: "var(--r-8)" }}>
          <TheoryPanel
            lesson={courseContent.lessons[0] ?? null}
            shown={theoryShown}
            full={theoryShown}
            alreadyDone={false}
            onClose={() => setTheoryShown(false)}
            onDone={() => setTheoryShown(false)}
          />
          {!theoryShown && (
            <button
              onClick={() => setTheoryShown(true)}
              style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontFamily: "var(--font-mono)", fontSize: 11, padding: "6px 14px", border: "1px dashed var(--rule)", borderRadius: "var(--r-full)", background: "var(--paper-2)", cursor: "pointer" }}
            >show panel</button>
          )}
        </div>
      </OrgStory>

      <OrgStory name="BuildPanel — full mode (code editor + tests)">
        <div style={{ position: "relative", height: 420, overflow: "hidden", background: "var(--paper)", border: "1px dashed var(--rule)", borderRadius: "var(--r-8)" }}>
          <BuildPanel
            lesson={courseContent.lessons[1] ?? null}
            shown={buildShown}
            full={buildShown}
            code={courseContent.lessons[1]?.code?.starter ?? ""}
            testResults={(courseContent.lessons[1]?.code?.tests ?? []).map(t => ({ name: t.name, pass: null }))}
            allPass={false}
            language="javascript"
            onLanguageChange={() => {}}
            onCodeChange={() => {}}
            onRunTests={() => {}}
            onReset={() => {}}
            onPlace={() => {}}
            onClose={() => setBuildShown(false)}
          />
          {!buildShown && (
            <button
              onClick={() => setBuildShown(true)}
              style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontFamily: "var(--font-mono)", fontSize: 11, padding: "6px 14px", border: "1px dashed var(--rule)", borderRadius: "var(--r-full)", background: "var(--paper-2)", cursor: "pointer" }}
            >show panel</button>
          )}
        </div>
      </OrgStory>

      <OrgStory name="CourseBoard — design canvas with tab toggle">
        <div style={{ height: 500, overflow: "hidden" }}>
          <CourseBoardDemo content={courseContent} />
        </div>
      </OrgStory>
    </div>
  </section>
);
