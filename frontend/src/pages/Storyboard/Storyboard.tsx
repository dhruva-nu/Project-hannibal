import { useCallback, useState } from "react";

import {
  /* atoms */
  Avatar,
  Badge,
  BrandMark,
  Button,
  Checkbox,
  Chip,
  Input,
  LiveDot,
  PaperBg,
  Tag,
  ThemeToggle,
  TypingIndicator,
  /* molecules */
  BoardChrome,
  ChatMessage,
  InputField,
  NavBrand,
  OAuthButton,
  PasswordField,
  StepCard,
  Tabs,
  TrustPillStrip,
  /* organisms */
  AuthFlowDiagram,
  CanvasBoard,
  ChatPanel,
  CourseMarquee,
  DiagramArea,
  HowItWorksStrip,
  LoginForm,
  Navbar,
} from "@/shared/components";

import type {
  ChatMessage as ChatMessageType,
  DiagramEdge,
  DiagramNodeData,
  Theme,
} from "@/shared/types";

import styles from "./Storyboard.module.css";

/* ── Demo data ── */

const DEMO_MESSAGES: ChatMessageType[] = [
  { id: "1", role: "user", text: "Teach me how to build an OTP system." },
  {
    id: "2",
    role: "ai",
    segments: [
      { type: "text", value: "Store a " },
      { type: "code", value: "hash(otp + phone)" },
      { type: "text", value: " in " },
      { type: "underline", value: "Redis" },
      { type: "text", value: " with a short TTL." },
    ],
  },
];

const DEMO_NODES: DiagramNodeData[] = [
  { id: "user",  label: "User",        icon: "✦", sub: "+1 415 ···",          x: 24,  y: 40  },
  { id: "api",   label: "API /request",icon: "→", sub: "POST /otp",           x: 190, y: 16  },
  { id: "redis", label: "Redis",       icon: "◆", sub: "otp:phone → code",   x: 340, y: 60, tag: "ttl=30s" },
  { id: "sms",   label: "SMS Gateway", icon: "✉", sub: "Twilio · provider",  x: 190, y: 140 },
];

const DEMO_EDGES: DiagramEdge[] = [
  { from: "user",  to: "api",   color: "var(--ink)" },
  { from: "api",   to: "redis", color: "var(--accent-2)" },
  { from: "api",   to: "sms",   color: "var(--accent-3)" },
  { from: "sms",   to: "user",  color: "var(--accent-4)" },
];

const AUTH_TABS = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
];

const NAV_SECTIONS = [
  { id: "atoms",     label: "Atoms",     color: "var(--accent-4)" },
  { id: "molecules", label: "Molecules", color: "var(--accent-3)" },
  { id: "organisms", label: "Organisms", color: "var(--accent-2)" },
];

/* ── Story helpers ── */

interface StoryCardProps {
  name: string;
  props?: string;
  preview?: "row" | "column" | "center" | "full";
  children: React.ReactNode;
}

const StoryCard = ({ name, props, preview = "row", children }: StoryCardProps) => {
  const previewClass = [
    styles.preview,
    preview === "column" ? styles.previewColumn : "",
    preview === "center" ? styles.previewCenter : "",
    preview === "full"   ? styles.previewFull   : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{name}</span>
      <div className={previewClass}>{children}</div>
      <div className={styles.cardMeta}>
        <span className={styles.cardName}>{name}</span>
        {props && <span className={styles.cardProps}>{props}</span>}
      </div>
    </div>
  );
};

interface OrgStoryProps {
  name: string;
  dark?: boolean;
  children: React.ReactNode;
}

const OrgStory = ({ name, dark = false, children }: OrgStoryProps) => (
  <div className={styles.orgWrap}>
    <div className={styles.orgLabel}>{name}</div>
    <div className={[styles.orgPreview, dark ? styles.orgPreviewDark : ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  </div>
);

/* ── Storyboard page ── */

export const Storyboard = () => {
  const [theme, setTheme] = useState<Theme>("light");
  const [activeSection, setActiveSection] = useState("atoms");
  const [authTab, setAuthTab] = useState("signin");
  const [messages, setMessages] = useState<ChatMessageType[]>(DEMO_MESSAGES);
  const [cbChecked, setCbChecked] = useState(true);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

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

        {/* ── Sidebar ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarBrand}>
            <NavBrand />
            <div className={styles.divRow} />
            <span className={styles.sidebarTitle}>Component Library</span>
            <span className={styles.sidebarSub}>// atomic design · v1</span>
          </div>

          <nav className={styles.sidebarNav} aria-label="Storyboard sections">
            {NAV_SECTIONS.map((sec) => (
              <div key={sec.id}>
                <div className={styles.navSection}>{sec.label}</div>
                <button
                  className={[
                    styles.navItem,
                    activeSection === sec.id ? styles.navItemActive : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => scrollTo(sec.id)}
                  type="button"
                >
                  <span className={styles.navDot} style={{ background: sec.color }} />
                  {sec.label}
                </button>
              </div>
            ))}
          </nav>

          <div className={styles.themeRow}>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </aside>

        {/* ── Main ── */}
        <main className={styles.main}>
          <header className={styles.pageHeader}>
            <h1 className={styles.pageTitle}>
              Project Hannibal —{" "}
              <span className={styles.marker}>Component Library</span>
            </h1>
            <p className={styles.pageSub}>
              // 12 atoms · 11 molecules · 8 organisms · 1 design system
            </p>
          </header>

          {/* ══════════════════════════════════
              ATOMS
          ══════════════════════════════════ */}
          <section id="atoms" className={styles.section}>
            <div className={styles.sectionHeader} data-label="the primitives">
              <span className={styles.sectionNum}>01</span>
              <h2 className={styles.sectionTitle}>Atoms</h2>
              <span className={styles.sectionDesc}>12 components</span>
            </div>

            <div className={styles.grid}>

              <StoryCard name="Button" props="variant=primary">
                <Button variant="primary" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>}>
                  Start building
                </Button>
              </StoryCard>

              <StoryCard name="Button" props="variant=ghost">
                <Button variant="ghost" icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>} iconPosition="left">
                  Watch demo
                </Button>
              </StoryCard>

              <StoryCard name="Button" props="variant=navCta">
                <Button variant="navCta">Start building →</Button>
              </StoryCard>

              <StoryCard name="Button" props="variant=submit">
                <Button variant="submit">Sign in & continue building
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                </Button>
              </StoryCard>

              <StoryCard name="Badge" props="showDot=true">
                <Badge label="Hands-on coding · System design" />
              </StoryCard>

              <StoryCard name="Badge" props="showDot=false">
                <Badge label="auth · /login" showDot={false} />
              </StoryCard>

              <StoryCard name="Avatar" props="role=user | role=ai">
                <Avatar role="user" />
                <Avatar role="ai" />
              </StoryCard>

              <StoryCard name="BrandMark">
                <BrandMark />
                <BrandMark letters="AI" />
              </StoryCard>

              <StoryCard name="Chip" props="label + color">
                <Chip label="Build an OTP system"   color="oklch(0.66 0.20 28)" />
                <Chip label="Rate limit an API"     color="oklch(0.78 0.18 85)" />
                <Chip label="Caching with Redis"    color="oklch(0.62 0.13 220)" />
              </StoryCard>

              <StoryCard name="LiveDot">
                <LiveDot />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-faint)", marginLeft: 4 }}>tutor · live</span>
              </StoryCard>

              <StoryCard name="Tag">
                <Tag label="system.sketch" />
                <Tag label="tutor.snippet" />
              </StoryCard>

              <StoryCard name="ThemeToggle" props={`theme=${theme}`}>
                <ThemeToggle theme={theme} onToggle={toggleTheme} />
              </StoryCard>

              <StoryCard name="TypingIndicator">
                <TypingIndicator />
              </StoryCard>

              <StoryCard name="Input" props="promptMark=$">
                <Input promptMark="$" placeholder="you@workshop.dev" />
              </StoryCard>

              <StoryCard name="Checkbox" preview="column">
                <Checkbox
                  label="Keep me signed in"
                  checked={cbChecked}
                  onChange={(e) => setCbChecked(e.target.checked)}
                />
                <Checkbox label="Agree to terms" />
              </StoryCard>

            </div>
          </section>

          {/* ══════════════════════════════════
              MOLECULES
          ══════════════════════════════════ */}
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
                <Tabs
                  tabs={AUTH_TABS}
                  activeId={authTab}
                  onChange={setAuthTab}
                />
              </StoryCard>

              <StoryCard name="OAuthButton" preview="column">
                <OAuthButton provider="google" />
                <OAuthButton provider="github" />
              </StoryCard>

              <StoryCard name="TrustPillStrip" preview="column">
                <TrustPillStrip items={[
                  { label: "SSO ready" },
                  { label: "SOC 2 type II" },
                  { label: "2FA" },
                ]} />
              </StoryCard>

            </div>

            <div className={styles.gridWide} style={{ marginTop: 16 }}>

              <StoryCard name="InputField" preview="full">
                <InputField
                  label="Email"
                  type="email"
                  placeholder="you@workshop.dev"
                  promptMark="$"
                />
              </StoryCard>

              <StoryCard name="PasswordField" preview="full">
                <PasswordField hintLabel="Forgot?" />
              </StoryCard>

              <StoryCard name="ChatMessage" preview="full">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <ChatMessage message={{ id: "u1", role: "user", text: "How do I store OTP codes safely?" }} />
                  <ChatMessage
                    message={{
                      id: "a1",
                      role: "ai",
                      segments: [
                        { type: "text", value: "Never store plaintext — hash with " },
                        { type: "code", value: "argon2id" },
                        { type: "text", value: " and keep in " },
                        { type: "underline", value: "Redis" },
                        { type: "text", value: " with a 30s TTL." },
                      ],
                    }}
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
                <BoardChrome
                  tabs={[
                    { label: "otp-from-scratch.canvas", active: true },
                    { label: "notes.md" },
                    { label: "main.ts" },
                  ]}
                />
              </StoryCard>

              <StoryCard name="DiagramNode" preview="full">
                <div style={{ position: "relative", height: 120 }}>
                  <div style={{ position: "absolute", left: 0, top: 16 }}>
                    <div style={{
                      background: "var(--paper-2)",
                      border: "1.5px solid var(--ink)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      minWidth: 110,
                      boxShadow: "3px 3px 0 var(--ink)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: "var(--font-hand)", fontSize: 16, color: "var(--accent-2)" }}>✦</span>
                        User
                      </div>
                      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>+1 415 ···</div>
                    </div>
                  </div>
                  <div style={{ position: "absolute", left: 170, top: 0 }}>
                    <div style={{
                      background: "var(--paper-2)",
                      border: "1.5px solid var(--ink)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      minWidth: 110,
                      boxShadow: "4px 4px 0 var(--accent-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: "var(--font-hand)", fontSize: 16, color: "var(--accent-2)" }}>◆</span>
                        Redis
                      </div>
                      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>otp:phone → code</div>
                    </div>
                  </div>
                  <div style={{
                    position: "absolute", top: -10, left: 289, right: "auto",
                    background: "var(--accent)",
                    color: "oklch(0.2 0.04 80)",
                    fontFamily: "var(--font-hand)",
                    fontSize: 13,
                    fontWeight: 700,
                    padding: "1px 8px",
                    borderRadius: 999,
                    transform: "rotate(6deg)",
                    border: "1px solid var(--ink)",
                    whiteSpace: "nowrap",
                  }}>ttl=30s</div>
                </div>
              </StoryCard>

            </div>
          </section>

          {/* ══════════════════════════════════
              ORGANISMS
          ══════════════════════════════════ */}
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
                <ChatPanel
                  messages={messages}
                  onSubmit={handleChatSubmit}
                />
              </OrgStory>

              <OrgStory name="CanvasBoard — diagram + chat shell" dark>
                <CanvasBoard
                  tabs={[
                    { label: "otp-from-scratch.canvas", active: true },
                    { label: "notes.md" },
                    { label: "main.ts" },
                  ]}
                  metaLabel="tutor · live"
                >
                  <DiagramArea nodes={DEMO_NODES} edges={DEMO_EDGES} />
                  <ChatPanel messages={DEMO_MESSAGES} onSubmit={handleChatSubmit} />
                </CanvasBoard>
              </OrgStory>

              <div className={styles.gridWide}>
                <OrgStory name="LoginForm">
                  <div style={{ maxWidth: 460 }}>
                    <LoginForm
                      mode={authTab as "signin" | "signup"}
                      onSubmit={async () => {}}
                    />
                  </div>
                </OrgStory>

                <OrgStory name="AuthFlowDiagram">
                  <AuthFlowDiagram />
                </OrgStory>
              </div>

            </div>
          </section>

          {/* ── Footer ── */}
          <footer style={{
            borderTop: "1px dashed var(--rule)",
            paddingTop: 28,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--ink-faint)",
            display: "flex",
            gap: 24,
            flexWrap: "wrap" as const,
          }}>
            <span><strong style={{ color: "var(--ink)" }}>12</strong> atoms</span>
            <span><strong style={{ color: "var(--ink)" }}>11</strong> molecules</span>
            <span><strong style={{ color: "var(--ink)" }}>8</strong> organisms</span>
            <span style={{ marginLeft: "auto" }}>project-hannibal · component library · v1</span>
          </footer>
        </main>
      </div>
    </>
  );
};
