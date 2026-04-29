import {
  CanvasBoard,
  DiagramArea,
  ChatPanel,
  CourseMarquee,
} from "@/shared/components/organisms";
import type { ChatMessage, DiagramEdge, DiagramNodeData } from "@/shared/types";
import styles from "./Home.module.css";

const NODES: DiagramNodeData[] = [
  { id: "user",  label: "User",         icon: "✦", sub: "+1 415 ···",        x: 24,  y: 60  },
  { id: "api",   label: "API /request", icon: "→", sub: "POST /otp",         x: 200, y: 30  },
  { id: "redis", label: "Redis",        icon: "◆", sub: "otp:phone → code",  tag: "ttl=30s", x: 360, y: 80  },
  { id: "sms",   label: "SMS Gateway",  icon: "✉", sub: "Twilio · provider", x: 200, y: 168 },
];

const EDGES: DiagramEdge[] = [
  { from: "user", to: "api",   color: "var(--ink)",      dashArray: "6 4" },
  { from: "api",  to: "redis", color: "var(--accent-2)", dashArray: "6 4" },
  { from: "api",  to: "sms",   color: "var(--accent-3)", dashArray: "2 5" },
  { from: "sms",  to: "user",  color: "var(--accent-4)", dashArray: "6 4" },
];

const BOARD_TABS = [
  { label: "otp-from-scratch.canvas", active: true },
  { label: "notes.md" },
  { label: "main.ts" },
];

export interface AgentTask {
  title: string;
  status: "todo" | "in_progress" | "done";
}

interface HeroRightProps {
  visibleMessages: ChatMessage[];
  isTyping: boolean;
  isStreaming: boolean;
  agentTasks: AgentTask[];
  onChatSubmit: (text: string) => void;
}

export const HeroRight = ({
  visibleMessages,
  isTyping,
  isStreaming,
  agentTasks = [],
  onChatSubmit,
}: HeroRightProps) => (
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
        onSubmit={onChatSubmit}
        aiAnnotation={isStreaming ? undefined : "↓ I sketched the flow on the canvas above."}
      />
    </CanvasBoard>

    <CourseMarquee />

    {agentTasks.length > 0 && (
      <div className={styles.agentTasks}>
        <p className={styles.agentTasksLabel}>AI-suggested tasks</p>
        <ul className={styles.agentTasksList}>
          {agentTasks.map((task, i) => (
            <li key={i} className={styles.agentTaskItem} data-status={task.status}>
              <span className={styles.agentTaskStatus}>{task.status.replace("_", " ")}</span>
              <span>{task.title}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);
