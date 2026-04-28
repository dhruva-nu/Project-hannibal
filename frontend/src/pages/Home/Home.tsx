import { useEffect } from "react";
import { useCopilotReadable, useCoAgent } from "@copilotkit/react-core";
import { useAuth } from "@/context/AuthContext";
import { PaperBg } from "@/shared/components/atoms";
import { Navbar } from "@/shared/components/organisms";
import { useTheme } from "@/hooks/useTheme";
import { useAiStream } from "./useAiStream";
import { HeroLeft } from "./HeroLeft";
import { HeroRight, type AgentTask } from "./HeroRight";
import styles from "./Home.module.css";

interface AgentState {
  tasks: AgentTask[];
}

export const Home = () => {
  const { logout, user } = useAuth();
  const [theme, setTheme] = useState<Theme>("light");

  useCopilotReadable({
    description: "Current page: Project Hannibal home — hands-on system design and coding platform",
    value: { page: "home", topic: "system design, coding, and building real projects" },
  });

  useCopilotReadable({
    description: "The currently logged-in user",
    value: user ? { id: user.id, email: user.email, provider: user.provider } : null,
  });

  const { state: agentStateRaw } = useCoAgent<AgentState>({
    name: "default",
    initialState: { tasks: [] },
  });
  const agentState: AgentState = agentStateRaw ?? { tasks: [] };
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_USER_MSG]);
  const [isTyping, setIsTyping] = useState(true);
  const [streamingMsg, setStreamingMsg] = useState<ChatMessage | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const cancelStream = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const streamAiResponse = useCallback((msgId: string, onDone?: (completed: ChatMessage) => void) => {
    cancelStream();
    setIsTyping(false);

    let segIdx = 0;
    let charIdx = 0;

    const tick = () => {
      if (segIdx >= AI_SEGMENTS.length) {
        const completed: ChatMessage = { id: msgId, role: "ai", segments: AI_SEGMENTS };
        setStreamingMsg(null);
        onDone?.(completed);
        return;
      }

      const seg = AI_SEGMENTS[segIdx];
      charIdx++;

      if (charIdx > seg.value.length) {
        segIdx++;
        charIdx = 0;
        // move to next segment immediately
        timerRef.current = setTimeout(tick, 0);
        return;
      }

      const partial: ChatSegment[] = [
        ...AI_SEGMENTS.slice(0, segIdx),
        { type: seg.type, value: seg.value.slice(0, charIdx) },
      ];

      setStreamingMsg({ id: msgId, role: "ai", segments: partial });
      timerRef.current = setTimeout(tick, CHAR_SPEED[seg.type]);
    };

    timerRef.current = setTimeout(tick, 0);
  }, [cancelStream]);

  // Initial animation on mount
  useEffect(() => {
    const dotDelay = setTimeout(() => {
      streamAiResponse("ai-0", (completed) => {
        setMessages([INITIAL_USER_MSG, completed]);
      });
    }, 900);

    return () => {
      clearTimeout(dotDelay);
      cancelStream();
    };
  }, [streamAiResponse, cancelStream]);

  const handleChatSubmit = useCallback((text: string) => {
    cancelStream();
    setStreamingMsg(null);

    const newUser: ChatMessage = { id: `user-${Date.now()}`, role: "user", text };
    setMessages((prev) => [...prev, newUser]);
    setIsTyping(true);

    const aiId = `ai-${Date.now()}`;
    timerRef.current = setTimeout(() => {
      streamAiResponse(aiId, (completed) => {
        setMessages((prev) => [...prev, completed]);
      });
    }, 900);
  }, [cancelStream, streamAiResponse]);

  const handleThemeToggle = useCallback(
    () => setTheme((p) => (p === "light" ? "dark" : "light")),
    [],
  );

  const visibleMessages = streamingMsg
    ? [...messages, streamingMsg]
    : messages;

  return (
    <>
      <PaperBg />
      <div className={styles.stage}>
        <Navbar theme={theme} onThemeToggle={toggleTheme} onLogout={logout} />

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
                messages={visibleMessages}
                isTyping={isTyping}
                onSubmit={handleChatSubmit}
                aiAnnotation={streamingMsg ? undefined : "↓ I sketched the flow on the canvas above."}
              />
            </CanvasBoard>

            <CourseMarquee />

            {(agentState.tasks?.length ?? 0) > 0 && (
              <div className={styles.agentTasks}>
                <p className={styles.agentTasksLabel}>AI-suggested tasks</p>
                <ul className={styles.agentTasksList}>
                  {agentState.tasks.map((task, i) => (
                    <li key={i} className={styles.agentTaskItem} data-status={task.status}>
                      <span className={styles.agentTaskStatus}>{task.status.replace("_", " ")}</span>
                      <span>{task.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};
