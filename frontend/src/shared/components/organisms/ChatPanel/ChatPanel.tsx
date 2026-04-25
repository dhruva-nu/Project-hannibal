import { useRef, useState } from "react";
import { ChatMessage } from "@/shared/components/molecules";
import type { ChatMessage as ChatMessageType } from "@/shared/types";
import styles from "./ChatPanel.module.css";

const SendIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);

interface ChatPanelProps {
  messages: ChatMessageType[];
  isTyping?: boolean;
  aiAnnotation?: string;
  placeholder?: string;
  onSubmit: (text: string) => void;
}

export const ChatPanel = ({
  messages,
  isTyping = false,
  aiAnnotation,
  placeholder = "ask the tutor — try: how does 3rd-party login work?",
  onSubmit,
}: ChatPanelProps) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const text = inputValue.trim();
    if (!text) return;
    onSubmit(text);
    setInputValue("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <div className={styles.chat} role="log" aria-label="Chat with tutor" aria-live="polite">
      <div className={styles.stream}>
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isTyping && messages.length > 0 && (
          <ChatMessage
            key="typing"
            message={{ id: "typing", role: "ai" }}
            isTyping
            annotation={aiAnnotation}
          />
        )}
      </div>

      <div className={styles.inputRow}>
        <span className={styles.promptMark} aria-hidden="true">$</span>
        <input
          ref={inputRef}
          className={styles.textInput}
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Message to tutor"
        />
        <button
          type="button"
          className={styles.sendBtn}
          onClick={handleSubmit}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
};
