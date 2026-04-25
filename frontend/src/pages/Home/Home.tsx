import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  PaperBg,
  StickyNote,
} from "@/shared/components/atoms";
import {
  Navbar,
  CanvasBoard,
  DiagramArea,
  ChatPanel,
  HowItWorksStrip,
  CourseMarquee,
} from "@/shared/components/organisms";
import type {
  ChatMessage,
  DiagramEdge,
  DiagramNodeData,
  Theme,
} from "@/shared/types";
import styles from "./Home.module.css";

const NODES: DiagramNodeData[] = [
  { id: "user",  label: "User",        icon: "✦", sub: "+1 415 ···",       x: 24,  y: 60  },
  { id: "api",   label: "API /request",icon: "→", sub: "POST /otp",        x: 200, y: 30  },
  { id: "redis", label: "Redis",       icon: "◆", sub: "otp:phone → code", tag: "ttl=30s", x: 360, y: 80  },
  { id: "sms",   label: "SMS Gateway", icon: "✉", sub: "Twilio · provider", x: 200, y: 168 },
];

const EDGES: DiagramEdge[] = [
  { from: "user",  to: "api",   color: "var(--ink)",      dashArray: "6 4"  },
  { from: "api",   to: "redis", color: "var(--accent-2)", dashArray: "6 4"  },
  { from: "api",   to: "sms",   color: "var(--accent-3)", dashArray: "2 5"  },
  { from: "sms",   to: "user",  color: "var(--accent-4)", dashArray: "6 4"  },
];

const BOARD_TABS = [
  { label: "otp-from-scratch.canvas", active: true },
  { label: "notes.md" },
  { label: "main.ts" },
];

const INITIAL_USER_MSG: ChatMessage = {
  id: "user-0",
  role: "user",
  text: "Teach me how to build an OTP system. Where do I store the codes?",
};

const AI_RESPONSE: ChatMessage = {
  id: "ai-0",
  role: "ai",
  segments: [
    { type: "text",      value: "Great question. We never store the OTP itself — store a " },
    { type: "code",      value: "hash(otp + phone + secret)" },
    { type: "text",      value: " in " },
    { type: "underline", value: "Redis" },
    { type: "text",      value: " with a short TTL (≈30s). Rate-limit at the API edge before it ever hits the gateway. Here, drag the boxes — see how the path shifts." },
  ],
};

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export const Home = () => {
  const [theme, setTheme] = useState<Theme>("light");
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_USER_MSG]);
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const t = setTimeout(() => {
      setIsTyping(false);
      setMessages([INITIAL_USER_MSG, AI_RESPONSE]);
    }, 1800);
    return () => clearTimeout(t);
  }, []);

  const handleChatSubmit = useCallback((text: string) => {
    const newUser: ChatMessage = { id: `user-${Date.now()}`, role: "user", text };
    setMessages((prev) => [...prev, newUser]);
    setIsTyping(true);
    setTimeout(() => {
      const newAi: ChatMessage = {
        ...AI_RESPONSE,
        id: `ai-${Date.now()}`,
      };
      setIsTyping(false);
      setMessages((prev) => [...prev, newAi]);
    }, 1800);
  }, []);

  const handleThemeToggle = useCallback(
    () => setTheme((p) => (p === "light" ? "dark" : "light")),
    [],
  );

  return (
    <>
      <PaperBg />
      <div className={styles.stage}>
        <Navbar theme={theme} onThemeToggle={handleThemeToggle} />

        <section className={styles.hero} aria-label="Hero">
          {/* ── LEFT COLUMN ── */}
          <div className={styles.heroLeft}>
            <StickyNote rotate={4} className={styles.stickyNote}>
              don&apos;t just<br />watch — <u>build it</u> ✦
            </StickyNote>

            <Badge label="Hands-on coding · System design" />

            <h1 className={styles.headline}>
              Stop watching tutorials.<br />
              <span className={styles.marker}>Build the system</span><br />
              <span className={styles.scribble}>— then understand it.</span>
            </h1>

            <p className={styles.sub}>
              Project Hannibal is a hands-on platform for learning to code and design real
              systems. Our GenUI tutor draws diagrams, drops nodes on a canvas, and codes
              alongside you — so every concept ends in a working artifact, not a finished video.
            </p>

            <div className={styles.ctaRow}>
              <Button variant="primary" href="#" icon={<ArrowRightIcon />} iconPosition="right">
                Start your first build
              </Button>
              <Button variant="ghost" href="#" icon={<PlayIcon />} iconPosition="left">
                Watch a 90-sec demo
              </Button>
            </div>

            <div className={styles.metaRow}>
              <span><strong>200+</strong> guided builds</span>
              <span className={styles.metaSep} aria-hidden="true" />
              <span><strong>0</strong> setup. runs in browser</span>
              <span className={styles.metaSep} aria-hidden="true" />
              <span>free tier · no card</span>
            </div>

            <HowItWorksStrip />
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className={styles.heroRight}>
            <div className={styles.annoLeft} aria-hidden="true">
              diagrams render<br />as it talks ↘
            </div>
            <div className={styles.annoRight} aria-hidden="true">
              ↖ drag any node<br />to rearrange
            </div>

            <CanvasBoard tabs={BOARD_TABS} metaLabel="tutor · live">
              <DiagramArea nodes={NODES} edges={EDGES} />
              <ChatPanel
                messages={messages}
                isTyping={isTyping}
                onSubmit={handleChatSubmit}
                aiAnnotation="↓ I sketched the flow on the canvas above."
              />
            </CanvasBoard>

            <CourseMarquee />
          </div>
        </section>
      </div>
    </>
  );
};
