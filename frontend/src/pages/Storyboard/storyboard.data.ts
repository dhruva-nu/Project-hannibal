import type { ChatMessage, DiagramEdge, DiagramNodeData } from "@/shared/types";

export const DEMO_MESSAGES: ChatMessage[] = [
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

export const DEMO_NODES: DiagramNodeData[] = [
  { id: "user",  label: "User",        icon: "✦", sub: "+1 415 ···",         x: 24,  y: 40  },
  { id: "api",   label: "API /request", icon: "→", sub: "POST /otp",          x: 190, y: 16  },
  { id: "redis", label: "Redis",        icon: "◆", sub: "otp:phone → code",  x: 340, y: 60, tag: "ttl=30s" },
  { id: "sms",   label: "SMS Gateway",  icon: "✉", sub: "Twilio · provider", x: 190, y: 140 },
];

export const DEMO_EDGES: DiagramEdge[] = [
  { from: "user",  to: "api",   color: "var(--ink)" },
  { from: "api",   to: "redis", color: "var(--accent-2)" },
  { from: "api",   to: "sms",   color: "var(--accent-3)" },
  { from: "sms",   to: "user",  color: "var(--accent-4)" },
];

export const AUTH_TABS = [
  { id: "signin", label: "Sign in" },
  { id: "signup", label: "Create account" },
];

export const NAV_SECTIONS = [
  { id: "atoms",     label: "Atoms",      color: "var(--accent-4)" },
  { id: "molecules", label: "Molecules",  color: "var(--accent-3)" },
  { id: "organisms", label: "Organisms",  color: "var(--accent-2)" },
  { id: "course",    label: "CoursePage", color: "var(--accent)" },
];
