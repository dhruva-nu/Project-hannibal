import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatSegment } from "@/shared/types";

const INITIAL_USER_MSG: ChatMessage = {
  id: "user-0",
  role: "user",
  text: "Teach me how to build an OTP system. Where do I store the codes?",
};

const AI_SEGMENTS: ChatSegment[] = [
  { type: "text",      value: "Great question. We never store the OTP itself — store a " },
  { type: "code",      value: "hash(otp + phone + secret)", annotation: "learn how to prevent it" },
  { type: "text",      value: " in " },
  { type: "underline", value: "Redis" },
  { type: "text",      value: " with a short TTL (≈30s). Rate-limit at the API edge before it ever hits the gateway. Here, drag the boxes — see how the path shifts." },
];

const CHAR_SPEED: Record<ChatSegment["type"], number> = {
  text: 18,
  code: 32,
  underline: 28,
};

export const useAiStream = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_USER_MSG]);
  const [isTyping, setIsTyping] = useState(true);
  const [streamingMsg, setStreamingMsg] = useState<ChatMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelStream = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const streamAiResponse = useCallback(
    (msgId: string, onDone?: (completed: ChatMessage) => void) => {
      cancelStream();
      setIsTyping(false);

      let segmentIndex = 0;
      let charIndex = 0;

      const tick = () => {
        if (segmentIndex >= AI_SEGMENTS.length) {
          const completed: ChatMessage = { id: msgId, role: "ai", segments: AI_SEGMENTS };
          setStreamingMsg(null);
          onDone?.(completed);
          return;
        }

        const seg = AI_SEGMENTS[segmentIndex];
        charIndex++;

        if (charIndex > seg.value.length) {
          segmentIndex++;
          charIndex = 0;
          timerRef.current = setTimeout(tick, 0);
          return;
        }

        const partial: ChatSegment[] = [
          ...AI_SEGMENTS.slice(0, segmentIndex),
          { type: seg.type, value: seg.value.slice(0, charIndex) },
        ];

        setStreamingMsg({ id: msgId, role: "ai", segments: partial });
        timerRef.current = setTimeout(tick, CHAR_SPEED[seg.type]);
      };

      timerRef.current = setTimeout(tick, 0);
    },
    [cancelStream],
  );

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

  const handleChatSubmit = useCallback(
    (text: string) => {
      cancelStream();
      setStreamingMsg(null);

      const newUserMsg: ChatMessage = { id: `user-${Date.now()}`, role: "user", text };
      setMessages((prev) => [...prev, newUserMsg]);
      setIsTyping(true);

      const aiMsgId = `ai-${Date.now()}`;
      timerRef.current = setTimeout(() => {
        streamAiResponse(aiMsgId, (completed) => {
          setMessages((prev) => [...prev, completed]);
        });
      }, 900);
    },
    [cancelStream, streamAiResponse],
  );

  const visibleMessages = streamingMsg ? [...messages, streamingMsg] : messages;

  return { visibleMessages, isTyping, isStreaming: streamingMsg !== null, handleChatSubmit };
};
