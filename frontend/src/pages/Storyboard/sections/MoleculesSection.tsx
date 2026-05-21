import {
  BoardChrome, ChatMessage, InputField, NavBrand, OAuthButton,
  PasswordField, StepCard, Tabs, TrustPillStrip,
  PaletteItem, BoardNode, ServiceBlock,
} from "@/shared/components";
import { AUTH_TABS } from "../storyboard.data";
import { StoryCard } from "../StoryCard";
import styles from "../Storyboard.module.css";

interface MoleculesSectionProps {
  authTab: string;
  setAuthTab: (id: string) => void;
}

export const MoleculesSection = ({ authTab, setAuthTab }: MoleculesSectionProps) => (
  <section id="molecules" className={styles.section}>
    <div className={styles.sectionHeader} data-label="composed patterns">
      <span className={styles.sectionNum}>02</span>
      <h2 className={styles.sectionTitle}>Molecules</h2>
      <span className={styles.sectionDesc}>11 components</span>
    </div>

    <div className={styles.grid}>
      <StoryCard name="NavBrand">
        <NavBrand />
      </StoryCard>

      <StoryCard name="Tabs" preview="column">
        <Tabs tabs={AUTH_TABS} activeId={authTab} onChange={setAuthTab} />
      </StoryCard>

      <StoryCard name="OAuthButton" preview="column">
        <OAuthButton provider="google" />
        <OAuthButton provider="github" />
      </StoryCard>

      <StoryCard name="TrustPillStrip" preview="column">
        <TrustPillStrip items={[{ label: "SSO ready" }, { label: "SOC 2 type II" }, { label: "2FA" }]} />
      </StoryCard>
    </div>

    <div className={styles.gridWide} style={{ marginTop: 16 }}>
      <StoryCard name="InputField" preview="full">
        <InputField label="Email" type="email" placeholder="you@workshop.dev" promptMark="$" />
      </StoryCard>

      <StoryCard name="PasswordField" preview="full">
        <PasswordField hintLabel="Forgot?" />
      </StoryCard>

      <StoryCard name="ChatMessage" preview="full">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ChatMessage message={{ id: "u1", role: "user", text: "How do I store OTP codes safely?" }} />
          <ChatMessage
            message={{ id: "a1", role: "ai", segments: [
              { type: "text", value: "Never store plaintext — hash with " },
              { type: "code", value: "argon2id" },
              { type: "text", value: " and keep in " },
              { type: "underline", value: "Redis" },
              { type: "text", value: " with a 30s TTL." },
            ]}}
            annotation="↓ I sketched the flow on the canvas."
          />
          <ChatMessage message={{ id: "t1", role: "ai" }} isTyping />
        </div>
      </StoryCard>

      <StoryCard name="StepCard" preview="column">
        <StepCard step={{ num: "01 / PROMPT", title: "Tell the tutor what to build", desc: '"Show me how OTP works." It scopes the build with you.', hasArrow: true }} />
        <StepCard step={{ num: "02 / SKETCH", title: "It draws the system live", desc: "Diagrams, nodes, arrows — generated as you ask questions.", hasArrow: false }} />
      </StoryCard>

      <StoryCard name="BoardChrome" preview="full">
        <BoardChrome tabs={[{ label: "otp-from-scratch.canvas", active: true }, { label: "notes.md" }, { label: "main.ts" }]} />
      </StoryCard>

      <StoryCard name="DiagramNode" preview="full">
        <div style={{ position: "relative", height: "var(--sp-120)" }}>
          <div style={{ position: "absolute", left: 0, top: "var(--fs-xl)" }}>
            <div style={{ background: "var(--paper-2)", border: "var(--bw-2) solid var(--ink)", borderRadius: "var(--r-10)", padding: "var(--sp-10) var(--sp-12)", minWidth: "var(--sp-110)", boxShadow: "var(--sp-3) var(--sp-3) 0 var(--ink)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--ink)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-6)" }}>
                <span style={{ fontFamily: "var(--font-hand)", fontSize: "var(--fs-xl)", color: "var(--accent-2)" }}>✦</span>
                User
              </div>
              <div style={{ fontSize: "var(--fs-2xs)", color: "var(--ink-faint)", marginTop: "var(--sp-2)" }}>+1 415 ···</div>
            </div>
          </div>
        </div>
      </StoryCard>

      <StoryCard name="PaletteItem" props="kind=component|service|module">
        <PaletteItem kind="component" label="DB" />
        <PaletteItem kind="service" label="BE" />
        <PaletteItem kind="module" label="Auth Module" />
      </StoryCard>

      <StoryCard name="BoardNode" props="selected=false|true">
        <div style={{ position: "relative", width: 120, height: 44 }}>
          <BoardNode node={{ id: "demo", type: "component", x: 0, y: 0, label: "Redis" }} selected={false} onSelect={() => {}} onMove={() => {}} onPortPointerDown={() => {}} onPortPointerUp={() => {}} />
        </div>
        <div style={{ position: "relative", width: 120, height: 44 }}>
          <BoardNode node={{ id: "demo2", type: "component", x: 0, y: 0, label: "DB" }} selected={true} onSelect={() => {}} onMove={() => {}} onPortPointerDown={() => {}} onPortPointerUp={() => {}} />
        </div>
      </StoryCard>

      <StoryCard name="ServiceBlock" props="with modules" preview="column">
        <div style={{ position: "relative", width: 240, height: 140 }}>
          <ServiceBlock
            service={{ id: "svc1", type: "service", x: 0, y: 0, w: 220, label: "BE", modules: [{ id: "m1", label: "Auth Module" }, { id: "m2", label: "Gateway" }] }}
            selected={false} onSelect={() => {}} onMove={() => {}} onPortPointerDown={() => {}} onPortPointerUp={() => {}} onAddModule={() => {}}
          />
        </div>
      </StoryCard>
    </div>
  </section>
);
