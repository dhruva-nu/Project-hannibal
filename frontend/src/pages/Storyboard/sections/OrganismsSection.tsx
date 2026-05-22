import type { ChatMessage as ChatMessageType, Theme } from "@/shared/types";
import {
  AuthFlowDiagram, CanvasBoard, ChatPanel, CourseMarquee, DiagramArea,
  HowItWorksStrip, LoginForm, Navbar, DesignPalette, DesignInspector,
} from "@/shared/components";
import { DEMO_NODES, DEMO_EDGES, DEMO_MESSAGES } from "../storyboard.data";
import { OrgStory } from "../OrgStory";
import styles from "../Storyboard.module.css";

interface OrganismsSectionProps {
  theme: Theme;
  toggleTheme: () => void;
  authTab: string;
  messages: ChatMessageType[];
  handleChatSubmit: (text: string) => void;
}

export const OrganismsSection = ({ theme, toggleTheme, authTab, messages, handleChatSubmit }: OrganismsSectionProps) => (
  <section id="organisms" className={styles.section}>
    <div className={styles.sectionHeader} data-label="full UI sections">
      <span className={styles.sectionNum}>03</span>
      <h2 className={styles.sectionTitle}>Organisms</h2>
      <span className={styles.sectionDesc}>8 components</span>
    </div>

    <div className={styles.gridFull}>
      <OrgStory name="Navbar">
        <Navbar theme={theme} onThemeToggle={toggleTheme} />
      </OrgStory>

      <OrgStory name="HowItWorksStrip">
        <HowItWorksStrip />
      </OrgStory>

      <OrgStory name="CourseMarquee">
        <CourseMarquee />
      </OrgStory>

      <OrgStory name="DiagramArea — draggable nodes + SVG edges" dark>
        <DiagramArea nodes={DEMO_NODES} edges={DEMO_EDGES} />
      </OrgStory>

      <OrgStory name="ChatPanel — live tutor stream" dark>
        <ChatPanel messages={messages} onSubmit={handleChatSubmit} />
      </OrgStory>

      <OrgStory name="CanvasBoard — diagram + chat shell" dark>
        <CanvasBoard tabs={[{ label: "otp-from-scratch.canvas", active: true }, { label: "notes.md" }, { label: "main.ts" }]} metaLabel="tutor · live">
          <DiagramArea nodes={DEMO_NODES} edges={DEMO_EDGES} />
          <ChatPanel messages={DEMO_MESSAGES} onSubmit={handleChatSubmit} />
        </CanvasBoard>
      </OrgStory>

      <div className={styles.gridWide}>
        <OrgStory name="LoginForm">
          <div style={{ maxWidth: "var(--sp-460)" }}>
            <LoginForm mode={authTab as "signin" | "signup"} onSubmit={async () => {}} />
          </div>
        </OrgStory>

        <OrgStory name="AuthFlowDiagram">
          <AuthFlowDiagram />
        </OrgStory>

        <OrgStory name="DesignPalette — component / service / module palette">
          <div style={{ width: 200, height: 400, overflow: "auto", border: "1px dashed var(--rule)", borderRadius: "var(--r-8)" }}>
            <DesignPalette
              sections={[
                { title: "Components", items: [{ kind: "component", label: "DB" }, { kind: "component", label: "Redis" }] },
                { title: "Services", items: [{ kind: "service", label: "BE" }], tip: "drag onto board ↘" },
                { title: "Modules", items: [{ kind: "module", label: "Auth Module" }], tip: "drop inside a service" },
              ]}
              onAddCustom={() => {}}
            />
          </div>
        </OrgStory>

        <OrgStory name="DesignInspector — empty state">
          <div style={{ width: 240, height: 200, border: "1px dashed var(--rule)", borderRadius: "var(--r-8)" }}>
            <DesignInspector nodes={{}} edges={[]} selected={null} onUpdateLabel={() => {}} onDeleteNode={() => {}} onDeleteModule={() => {}} onDeleteEdge={() => {}} />
          </div>
        </OrgStory>

        <OrgStory name="DesignInspector — node selected">
          <div style={{ width: 240, height: 260, border: "1px dashed var(--rule)", borderRadius: "var(--r-8)" }}>
            <DesignInspector
              nodes={{ n1: { id: "n1", type: "component", x: 0, y: 0, label: "Redis" } }}
              edges={[]} selected={{ kind: "node", id: "n1" }}
              onUpdateLabel={() => {}} onDeleteNode={() => {}} onDeleteModule={() => {}} onDeleteEdge={() => {}}
            />
          </div>
        </OrgStory>
      </div>
    </div>
  </section>
);
