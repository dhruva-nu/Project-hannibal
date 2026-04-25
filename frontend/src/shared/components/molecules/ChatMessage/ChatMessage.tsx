import React, { useEffect, useRef, useState } from "react";
import { Avatar, TypingIndicator } from "@/shared/components/atoms";
import type { ChatMessage as ChatMessageType, ChatSegment } from "@/shared/types";
import styles from "./ChatMessage.module.css";

interface ChatMessageProps {
  message: ChatMessageType;
  isTyping?: boolean;
  annotation?: string;
}

const CurvedArrow = () => (
  <svg
    className={styles.segmentAnnoArrow}
    width="28" height="22"
    viewBox="0 0 28 22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 4 Q 10 2, 16 10 Q 20 16, 22 20" strokeDasharray="2 2" />
    <path d="M17 18 L 22 20 L 20 14" />
  </svg>
);

const AnnotatedSegment = ({ annotation, children }: { annotation: string; children: React.ReactNode }) => {
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const check = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !wrapRef.current) {
        setVisible(false);
        return;
      }
      const range = sel.getRangeAt(0);
      setVisible(wrapRef.current.contains(range.commonAncestorContainer));
    };
    document.addEventListener("selectionchange", check);
    return () => document.removeEventListener("selectionchange", check);
  }, []);

  return (
    <span ref={wrapRef} className={styles.segmentWrap}>
      {children}
      <span
        className={[styles.segmentAnno, visible ? styles.segmentAnnoVisible : ""].filter(Boolean).join(" ")}
        role="tooltip"
        aria-hidden={!visible}
      >
        {annotation}
        <CurvedArrow />
      </span>
    </span>
  );
};

const renderSegment = (seg: ChatSegment, i: number): React.ReactNode => {
  let inner: React.ReactNode;
  switch (seg.type) {
    case "code":
      inner = <code className={styles.code}>{seg.value}</code>;
      break;
    case "underline":
      inner = <span className={styles.underlineMark}>{seg.value}</span>;
      break;
    default:
      inner = <span>{seg.value}</span>;
  }

  if (!seg.annotation) return <React.Fragment key={i}>{inner}</React.Fragment>;

  return (
    <AnnotatedSegment key={i} annotation={seg.annotation}>
      {inner}
    </AnnotatedSegment>
  );
};

export const ChatMessage = ({ message, isTyping = false, annotation }: ChatMessageProps) => {
  const isUser = message.role === "user";

  const bubbleContent = isTyping
    ? <TypingIndicator />
    : message.segments
      ? message.segments.map(renderSegment)
      : message.text;

  return (
    <div className={styles.msg}>
      <Avatar role={message.role} />
      <div className={[styles.bubble, isUser ? styles.userBubble : ""].filter(Boolean).join(" ")}>
        {bubbleContent}
        {annotation && !isTyping && (
          <div className={styles.annotation}>{annotation}</div>
        )}
      </div>
    </div>
  );
};
