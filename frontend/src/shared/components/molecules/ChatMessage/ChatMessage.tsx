import React from "react";
import { Avatar, TypingIndicator } from "@/shared/components/atoms";
import type { ChatMessage as ChatMessageType, ChatSegment } from "@/shared/types";
import styles from "./ChatMessage.module.css";

interface ChatMessageProps {
  message: ChatMessageType;
  isTyping?: boolean;
  annotation?: string;
}

const renderSegment = (seg: ChatSegment, i: number): React.ReactNode => {
  switch (seg.type) {
    case "code":
      return <code key={i} className={styles.code}>{seg.value}</code>;
    case "underline":
      return <span key={i} className={styles.underlineMark}>{seg.value}</span>;
    default:
      return <span key={i}>{seg.value}</span>;
  }
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
