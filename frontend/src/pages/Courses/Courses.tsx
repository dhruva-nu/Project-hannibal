import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { PaperBg, Badge, Input } from "@/shared/components/atoms";
import { CourseCard, CourseModal } from "@/shared/components/molecules";
import { Navbar, LearningPath } from "@/shared/components/organisms";
import { useTheme } from "@/hooks/useTheme";
import type { PathStep } from "@/shared/components/organisms/LearningPath/LearningPath";
import type { CourseCardProps } from "@/shared/components/molecules/CourseCard/CourseCard";

type RegularCourse = Extract<CourseCardProps, { isGenUi?: false }>;
import styles from "./Courses.module.css";

const FILTER_CATEGORIES = [
  "Auth & Identity",
  "Distributed systems",
  "Databases",
  "APIs & Networking",
  "Frontend systems",
  "DevOps",
] as const;

const PATH_STEPS: PathStep[] = [
  { num: "STEP 01", title: "Hash a password, properly", meta: "argon2id · 12 min", status: "complete" },
  { num: "STEP 02", title: "Sessions vs. tokens", meta: "concept · 8 min", status: "complete" },
  { num: "STEP 03", title: "Build the OTP system", meta: "project · 45 min", status: "current" },
  { num: "STEP 04", title: "JWT signing & rotation", meta: "concept · 14 min" },
  { num: "STEP 05", title: "Add 3rd-party login (OAuth 2.1)", meta: "project · 60 min" },
  { num: "STEP 06", title: "Ship: rate-limit your auth", meta: "project · 30 min" },
];

const OTP_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <rect x="20" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
      <rect x="100" y="30" width="50" height="30" rx="6" fill="var(--paper)" />
      <rect x="100" y="80" width="50" height="30" rx="6" fill="var(--paper)" />
      <rect x="180" y="50" width="40" height="30" rx="6" fill="var(--paper)" />
      <path d="M70 65 L 100 45" strokeDasharray="3 3" />
      <path d="M70 65 L 100 95" strokeDasharray="3 3" />
      <path d="M150 45 L 180 65" strokeDasharray="3 3" />
    </g>
    <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
      <text x="32" y="70">user</text>
      <text x="110" y="50">api</text>
      <text x="108" y="100">redis</text>
      <text x="186" y="70">sms</text>
    </g>
  </svg>
);

const OAUTH_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <circle cx="40" cy="65" r="20" fill="var(--paper)" />
      <circle cx="200" cy="65" r="20" fill="var(--paper)" />
      <rect x="100" y="45" width="50" height="40" rx="6" fill="var(--paper)" />
      <path d="M60 55 Q 90 35 100 55" strokeDasharray="3 3" />
      <path d="M60 75 Q 90 95 100 75" strokeDasharray="3 3" />
      <path d="M150 55 Q 175 45 180 55" strokeDasharray="3 3" />
      <path d="M150 75 Q 175 85 180 75" strokeDasharray="3 3" />
    </g>
    <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
      <text x="30" y="68">you</text>
      <text x="113" y="68">app</text>
      <text x="186" y="68">google</text>
    </g>
  </svg>
);

const RATE_LIMIT_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <rect x="20" y="55" width="40" height="20" rx="4" fill="var(--paper)" />
      <rect x="20" y="80" width="40" height="20" rx="4" fill="var(--paper)" />
      <rect x="20" y="30" width="40" height="20" rx="4" fill="var(--paper)" />
      <rect x="100" y="50" width="60" height="30" rx="6" fill="var(--paper)" />
      <rect x="190" y="50" width="40" height="30" rx="6" fill="var(--paper)" />
      <path d="M60 40 L 100 60" strokeDasharray="3 3" />
      <path d="M60 65 L 100 65" strokeDasharray="3 3" />
      <path d="M60 90 L 100 70" strokeDasharray="3 3" stroke="var(--accent-2)" />
      <path d="M160 65 L 190 65" strokeDasharray="3 3" />
      <text x="68" y="98" fontFamily="Caveat" fontSize="12" fill="var(--accent-2)">429!</text>
    </g>
    <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
      <text x="115" y="68">limiter</text>
      <text x="200" y="68">api</text>
    </g>
  </svg>
);

const JOB_QUEUE_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <rect x="20" y="50" width="40" height="30" rx="4" fill="var(--paper)" />
      <rect x="80" y="40" width="80" height="50" rx="4" fill="var(--paper)" />
      <line x1="100" y1="40" x2="100" y2="90" strokeDasharray="2 2" />
      <line x1="120" y1="40" x2="120" y2="90" strokeDasharray="2 2" />
      <line x1="140" y1="40" x2="140" y2="90" strokeDasharray="2 2" />
      <rect x="180" y="35" width="40" height="22" rx="4" fill="var(--paper)" />
      <rect x="180" y="73" width="40" height="22" rx="4" fill="var(--paper)" />
      <path d="M60 65 L 80 65" strokeDasharray="3 3" />
      <path d="M160 50 L 180 46" strokeDasharray="3 3" />
      <path d="M160 80 L 180 84" strokeDasharray="3 3" />
    </g>
    <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
      <text x="28" y="68">job</text>
      <text x="106" y="68">queue</text>
      <text x="186" y="50">w1</text>
      <text x="186" y="89">w2</text>
    </g>
  </svg>
);

const WEBHOOK_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <rect x="20" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
      <rect x="170" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
      <rect x="100" y="20" width="40" height="20" rx="4" fill="var(--paper)" strokeDasharray="3 3" />
      <rect x="100" y="55" width="40" height="20" rx="4" fill="var(--paper)" />
      <rect x="100" y="90" width="40" height="20" rx="4" fill="var(--paper)" strokeDasharray="3 3" />
      <path d="M70 65 L 100 30" strokeDasharray="3 3" />
      <path d="M70 65 L 100 65" />
      <path d="M70 65 L 100 100" strokeDasharray="3 3" />
      <path d="M140 65 L 170 65" />
    </g>
    <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
      <text x="32" y="68">us</text>
      <text x="180" y="68">you</text>
      <text x="108" y="68">retry</text>
    </g>
  </svg>
);

const TWO_FA_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <rect x="60" y="40" width="50" height="50" rx="6" fill="var(--paper)" />
      <rect x="140" y="40" width="50" height="50" rx="6" fill="var(--paper)" />
      <path d="M110 65 L 140 65" strokeDasharray="3 3" />
      <text x="78" y="68" fontFamily="Caveat" fontSize="14" fill="var(--accent-2)">2FA</text>
      <text x="158" y="68" fontFamily="Caveat" fontSize="14" fill="var(--accent-3)">TOTP</text>
    </g>
  </svg>
);

const MESH_AUTH_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <circle cx="60" cy="65" r="20" fill="var(--paper)" />
      <circle cx="120" cy="40" r="14" fill="var(--paper)" />
      <circle cx="120" cy="90" r="14" fill="var(--paper)" />
      <circle cx="180" cy="65" r="20" fill="var(--paper)" />
      <path d="M80 60 L 108 45" strokeDasharray="3 3" />
      <path d="M80 75 L 108 88" strokeDasharray="3 3" />
      <path d="M132 45 L 162 60" strokeDasharray="3 3" />
      <path d="M132 88 L 162 75" strokeDasharray="3 3" />
    </g>
  </svg>
);

const CACHE_SVG = (
  <svg viewBox="0 0 240 130" preserveAspectRatio="none">
    <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
      <rect x="20" y="50" width="60" height="30" rx="4" fill="var(--paper)" />
      <rect x="100" y="50" width="60" height="30" rx="4" fill="var(--paper)" />
      <rect x="180" y="50" width="40" height="30" rx="4" fill="var(--paper)" />
      <path d="M80 65 L 100 65" />
      <path d="M160 65 L 180 65" />
      <path d="M50 50 Q 50 30, 130 30 Q 200 30, 200 50" strokeDasharray="3 3" stroke="var(--accent-2)" />
      <text x="116" y="26" fontFamily="Caveat" fontSize="12" fill="var(--accent-2)">cache</text>
    </g>
  </svg>
);

const FEATURED_CARDS: CourseCardProps[] = [
  {
    code: "course.001",
    title: "Build an OTP system from scratch",
    description: "Hash, store, expire, rate-limit. Ship a working one-time-password flow that survives a real audit.",
    level: "intermediate",
    lessons: 9,
    duration: "~2.5 hrs",
    buildCount: 4210,
    stack: ["node", "redis", "twilio"],
    ribbon: "★ favourite",
    pin: "otp ✦",
    illustration: OTP_SVG,
    what: "A production-ready OTP microservice with argon2id hashing, Redis TTL expiry, and SMS delivery via Twilio.",
    learns: [
      "Why argon2id beats bcrypt for OTP hashing",
      "Redis TTL patterns for automatic code expiry",
      "Sliding window rate-limiting to block brute force",
      "Replay attack prevention with nonce tracking",
      "Timing-safe comparison to avoid oracle attacks",
    ],
    prerequisites: ["Basic Node.js / Express", "Familiarity with async/await"],
    curriculum: [
      { title: "OTP threat model — what can go wrong?", type: "concept" },
      { title: "Hash the code with argon2id", type: "project" },
      { title: "Store and expire codes in Redis", type: "project" },
      { title: "Rate-limit: sliding window counter", type: "project" },
      { title: "Send SMS via Twilio", type: "project" },
      { title: "Break it: replay attacks", type: "challenge" },
      { title: "Break it: timing oracle attacks", type: "challenge" },
      { title: "Ship: security audit checklist", type: "concept" },
      { title: "Final: full integration test", type: "project" },
    ],
  },
  {
    code: "course.002",
    title: "Add 3rd-party login (OAuth 2.1)",
    description: "Sign in with Google, GitHub, Apple — without leaking refresh tokens or breaking on PKCE.",
    level: "intermediate",
    lessons: 11,
    duration: "~3 hrs",
    buildCount: 2840,
    stack: ["node", "oauth", "pkce"],
    pin: "oauth ↻",
    illustration: OAUTH_SVG,
    what: "A working OAuth 2.1 flow with Google, GitHub, and PKCE — no leaked tokens, no state fixation.",
    learns: [
      "OAuth 2.1 vs 2.0 — what changed and why",
      "PKCE code challenge / verifier flow",
      "State parameter for CSRF prevention",
      "Refresh token rotation and revocation",
      "Secure token storage: HttpOnly cookies vs memory",
    ],
    prerequisites: ["HTTP sessions and cookies", "Basic understanding of redirects"],
    curriculum: [
      { title: "OAuth 2.0 vs 2.1 — the security fixes", type: "concept" },
      { title: "Build the authorization code flow", type: "project" },
      { title: "Add PKCE challenge/verifier", type: "project" },
      { title: "State param and CSRF prevention", type: "project" },
      { title: "Handle refresh token rotation", type: "project" },
      { title: "Add GitHub as a second provider", type: "project" },
      { title: "Break it: token leakage via referrer", type: "challenge" },
      { title: "Break it: state fixation attack", type: "challenge" },
      { title: "Add Apple Sign-In (SIWA)", type: "project" },
      { title: "Ship: provider security checklist", type: "concept" },
      { title: "Final: end-to-end flow test", type: "project" },
    ],
  },
  {
    code: "course.003",
    title: "Rate-limit an API (token bucket)",
    description: "Token bucket, sliding window, leaky bucket — implement all three, then break them on purpose.",
    level: "beginner",
    lessons: 7,
    duration: "~1.5 hrs",
    buildCount: 5120,
    stack: ["node", "redis"],
    pin: "rate-limit",
    illustration: RATE_LIMIT_SVG,
    what: "Three production rate limiters wired into a real Express API, each deliberately broken to show failure modes.",
    learns: [
      "Token bucket internals — refill rate vs capacity",
      "Sliding window log vs counter trade-offs",
      "Leaky bucket for smoothing bursty traffic",
      "Atomic Redis ops with Lua scripts",
      "RFC-correct 429 + Retry-After headers",
    ],
    prerequisites: ["Basic Express.js", "Redis fundamentals"],
    curriculum: [
      { title: "Why rate limiting? Threat model", type: "concept" },
      { title: "Build token bucket in Redis", type: "project" },
      { title: "Build sliding window counter", type: "project" },
      { title: "Build leaky bucket", type: "project" },
      { title: "Atomic ops with Lua scripts", type: "project" },
      { title: "Break it: burst attack against each limiter", type: "challenge" },
      { title: "Ship: 429 + Retry-After headers", type: "project" },
    ],
  },
  {
    code: "course.004",
    title: "Build a job queue, retry-correctly",
    description: "Idempotency keys, dead-letter queues, backoff. Learn what BullMQ does, by writing it.",
    level: "intermediate",
    lessons: 10,
    duration: "~3 hrs",
    stack: ["node", "redis", "postgres"],
    pin: "queue",
    illustration: JOB_QUEUE_SVG,
    what: "A job queue with dead-letter queue, exponential backoff, and idempotency keys — built from scratch, then compared with BullMQ internals.",
    learns: [
      "Idempotency key patterns for safe retries",
      "Dead-letter queues and poison message handling",
      "Exponential backoff with full jitter",
      "At-least-once vs exactly-once delivery guarantees",
      "Worker concurrency and distributed locking",
    ],
    prerequisites: ["Redis basics", "Async patterns in Node.js"],
    curriculum: [
      { title: "Queue guarantees — what can you promise?", type: "concept" },
      { title: "Basic push/pop with Redis lists", type: "project" },
      { title: "Add idempotency keys", type: "project" },
      { title: "Retry with exponential backoff + jitter", type: "project" },
      { title: "Dead-letter queue for poison messages", type: "project" },
      { title: "Worker concurrency and locking", type: "project" },
      { title: "Break it: duplicate processing", type: "challenge" },
      { title: "Break it: worker crash mid-job", type: "challenge" },
      { title: "Observability: job state dashboards", type: "concept" },
      { title: "Final: compare with BullMQ internals", type: "project" },
    ],
  },
  {
    code: "course.005",
    title: "Webhooks, retried correctly",
    description: "Signed payloads, exponential retries, replay protection. Build the kind Stripe ships.",
    level: "advanced",
    lessons: 8,
    duration: "~2 hrs",
    stack: ["node", "hmac"],
    ribbon: "new!",
    pin: "webhooks",
    illustration: WEBHOOK_SVG,
    what: "A webhook delivery system with HMAC-SHA256 signing, exponential retries, and nonce-based replay protection.",
    learns: [
      "HMAC-SHA256 signature generation and verification",
      "Replay attack prevention with timestamps + nonces",
      "Exponential retry with per-endpoint circuit breaker",
      "Idempotent event handlers on the receiver side",
      "Webhook security checklist (the Stripe standard)",
    ],
    prerequisites: ["HTTPS and HTTP headers", "Node.js streams", "Basic crypto concepts"],
    curriculum: [
      { title: "How Stripe's webhook system works", type: "concept" },
      { title: "Sign payloads with HMAC-SHA256", type: "project" },
      { title: "Verify signatures on the receiver", type: "project" },
      { title: "Replay protection: timestamp + nonce", type: "project" },
      { title: "Retry with exponential backoff", type: "project" },
      { title: "Break it: replay the same event", type: "challenge" },
      { title: "Break it: signature forgery attempt", type: "challenge" },
      { title: "Ship: circuit breaker for dead endpoints", type: "project" },
    ],
  },
];

const RECOMMENDED_CARDS: CourseCardProps[] = [
  {
    code: "picked.for.you",
    title: "Layer 2FA on top of your OTP flow",
    description: "You just shipped OTP — extend it with TOTP / push approval, the way Authy does.",
    level: "next-step",
    duration: "~90 min",
    stack: ["otpauth", "node"],
    pin: "because: OTP",
    illustration: TWO_FA_SVG,
    what: "TOTP-based 2FA layered on an existing auth flow, with QR enrollment, time-window tolerance, and backup codes.",
    learns: [
      "TOTP algorithm internals (RFC 6238)",
      "HOTP vs TOTP — counter vs time",
      "QR code enrollment with otpauth URI",
      "Backup code generation and single-use storage",
      "Recovery flow design without weakening security",
    ],
    prerequisites: ["Completed OTP course or equivalent", "Basic cryptography (hashing, HMAC)"],
    curriculum: [
      { title: "HOTP vs TOTP — how the math works", type: "concept" },
      { title: "Generate and enroll TOTP secrets", type: "project" },
      { title: "Verify TOTP with time-window tolerance", type: "project" },
      { title: "QR code enrollment flow", type: "project" },
      { title: "Generate and store backup codes", type: "project" },
      { title: "Recovery flow without weakening 2FA", type: "project" },
      { title: "Break it: time-skew attack", type: "challenge" },
    ],
  },
  {
    code: "picked.for.you",
    title: "Distribute auth across services",
    description: "Move from a monolith to JWT-with-claims across an internal mesh, without breaking sessions.",
    level: "advanced",
    duration: "~4 hrs",
    stack: ["jwt", "mtls"],
    pin: "trending @ team",
    illustration: MESH_AUTH_SVG,
    what: "JWT-with-claims auth distributed across three services, with mTLS for internal calls and zero-trust between them.",
    learns: [
      "JWT claims design for multi-service authorization",
      "mTLS for service-to-service trust (no shared secrets)",
      "Token introspection vs local validation trade-offs",
      "Session propagation across a mesh without re-auth",
      "Zero-trust principles applied to real service topology",
    ],
    prerequisites: ["JWT fundamentals", "Basic microservices concepts", "TLS basics"],
    curriculum: [
      { title: "Monolith auth vs distributed auth — the gap", type: "concept" },
      { title: "Design JWT claims for multiple services", type: "project" },
      { title: "Set up mTLS between two services", type: "project" },
      { title: "Propagate sessions without re-authentication", type: "project" },
      { title: "Token introspection endpoint", type: "project" },
      { title: "Break it: token reuse across service boundaries", type: "challenge" },
      { title: "Zero-trust: never trust, always verify", type: "concept" },
    ],
  },
  {
    code: "picked.for.you",
    title: "Cache invalidation, the hard way",
    description: "Read-through, write-through, write-back. Learn the trade-offs by breaking each pattern in turn.",
    level: "intermediate",
    duration: "~2 hrs",
    stack: ["redis", "node"],
    pin: "your weak spot",
    illustration: CACHE_SVG,
    what: "All three caching patterns implemented and deliberately broken — plus stale-while-revalidate and cache warming on deploy.",
    learns: [
      "Read-through vs write-through vs write-back trade-offs",
      "Cache stampede and the mutex lock fix",
      "Stale-while-revalidate for read-heavy endpoints",
      "TTL design for different data freshness requirements",
      "Cache warming strategies for cold-start deploys",
    ],
    prerequisites: ["Redis basics", "Database read/write patterns"],
    curriculum: [
      { title: "Why cache invalidation is hard", type: "concept" },
      { title: "Read-through: build it", type: "project" },
      { title: "Read-through: break it", type: "challenge" },
      { title: "Write-through: build and break it", type: "project" },
      { title: "Write-back: build and break it", type: "project" },
      { title: "Cache stampede and mutex lock solution", type: "challenge" },
      { title: "Stale-while-revalidate pattern", type: "project" },
      { title: "TTL design for different data types", type: "concept" },
      { title: "Ship: cache warming on deploy", type: "project" },
    ],
  },
];

const AI_SUGGESTIONS = ["add OTP to my app", "understand consensus", "I'm prepping for FAANG"];

const NAV_LINKS = [
  { label: "Courses", href: "/courses" },
  { label: "Tracks", href: "#" },
  { label: "For teams", href: "#" },
  { label: "Sign in", href: "#" },
];

export const Courses = () => {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [aiQuery, setAiQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<RegularCourse | null>(null);

  const handleAiSubmit = () => {
    if (!aiQuery.trim()) return;
    setSubmitted(true);
  };

  const handleSuggestion = (text: string) => {
    setAiQuery(text);
    setSubmitted(false);
  };

  return (
    <>
      <PaperBg />
      <div className={styles.stage}>
        <Navbar
          links={NAV_LINKS}
          theme={theme}
          onThemeToggle={toggleTheme}
          onLogout={logout}
        />

        {/* ── Page header ── */}
        <header className={styles.pageHeader}>
          <div className={styles.headerLeft}>
            <Badge label="/courses · genUI" showDot />
            <h1 className={styles.title}>
              <span className={styles.marker}>Build</span>, don&apos;t browse.
              <br />
              <span className={styles.scribble}>— pick something to make today.</span>
            </h1>
            <p className={styles.lede}>
              Every course is a real artifact you ship. Or —{" "}
              <strong>ask the tutor</strong> to design a custom path for what you&apos;re trying to build.
            </p>
          </div>

          <div className={styles.aiBar}>
            <span className={styles.aiBarTag}>tutor.prompt</span>
            <Input
              promptMark="$"
              placeholder="describe what you want to build…"
              value={aiQuery}
              onChange={(e) => {
                setAiQuery(e.target.value);
                setSubmitted(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleAiSubmit()}
              aria-label="Describe what you want to build"
              suffix={
                <button
                  className={styles.sendBtn}
                  onClick={handleAiSubmit}
                  aria-label="Submit prompt"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </button>
              }
            />
            {submitted && aiQuery && (
              <p className={styles.aiResponse}>
                Curating courses for: &ldquo;{aiQuery}&rdquo; — refining picks…
              </p>
            )}
            {!submitted && (
              <div className={styles.aiSuggestions}>
                {AI_SUGGESTIONS.map((s) => (
                  <button key={s} className={styles.suggestion} onClick={() => handleSuggestion(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* ── Filter bar ── */}
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>filter →</span>
          <button
            className={[styles.filterChip, activeFilter === "All" && styles.filterChipActive].filter(Boolean).join(" ")}
            onClick={() => setActiveFilter("All")}
          >
            All <span className={styles.filterX}>·</span> 24
          </button>
          {FILTER_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={[styles.filterChip, activeFilter === cat && styles.filterChipActive].filter(Boolean).join(" ")}
              onClick={() => setActiveFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <main className={styles.main}>
          {/* ── Section: Continue your build ── */}
          <section className={styles.section} aria-labelledby="section-continue">
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}>
                <h2 id="section-continue">Continue your build</h2>
                <span className={styles.scribble}>— picking up where you left off</span>
                <span className={styles.count}>02 in progress</span>
              </div>
              <div className={styles.sectionActions}>
                <button className={styles.actionBtn}>view all</button>
              </div>
            </div>
            <LearningPath steps={PATH_STEPS} stickyNote="tutor said: skip step 4 if you already know JWTs ✦" />
          </section>

          {/* ── Section: Featured builds ── */}
          <section className={styles.section} aria-labelledby="section-featured">
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}>
                <h2 id="section-featured">Featured builds</h2>
                <span className={styles.scribble}>— most started this week</span>
                <span className={styles.count}>06 / 24</span>
              </div>
              <div className={styles.sectionActions}>
                <button className={styles.actionBtn}>sort: popular ▾</button>
                <button className={[styles.actionBtn, styles.aiAction].join(" ")}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 3v18M3 12h18" />
                  </svg>
                  curate for me
                </button>
              </div>
            </div>
            <div className={styles.grid}>
              {FEATURED_CARDS.map((card, i) => (
                <CourseCard key={i} {...card} onClick={() => setSelectedCourse(card)} />
              ))}
              <CourseCard
                isGenUi
                genUiLabel="Don't see what you need?"
                genUiHint={"tell the tutor — it'll generate\na custom course in this slot"}
              />
            </div>
          </section>

          {/* ── Section: AI recommended ── */}
          <section className={styles.section} aria-labelledby="section-recommended">
            <div className={styles.genuiBanner}>
              <div className={styles.aiIcon}>PH</div>
              <div className={styles.bannerText}>
                <strong>Tutor synthesized this section just now</strong> — based on your last build (OTP) and what&apos;s trending in your team. Tap any card to refine.
              </div>
              <div className={styles.bannerMeta}>
                <span className={styles.liveDot} aria-hidden="true" />
                <span>fresh · 12s ago</span>
              </div>
            </div>

            <div className={styles.sectionHead}>
              <div className={styles.sectionTitle}>
                <h2 id="section-recommended">What to learn next</h2>
                <span className={styles.scribble}>— recommended for you</span>
                <span className={styles.count}>04 picks</span>
              </div>
              <div className={styles.sectionActions}>
                <button className={[styles.actionBtn, styles.aiAction].join(" ")}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 12a9 9 0 1 0 9-9M3 3v6h6" />
                  </svg>
                  regenerate
                </button>
                <button className={styles.actionBtn}>pin section</button>
              </div>
            </div>

            <div className={styles.grid}>
              {RECOMMENDED_CARDS.map((card, i) => (
                <CourseCard key={i} {...card} onClick={() => setSelectedCourse(card)} />
              ))}
              <CourseCard
                isGenUi
                genUiSymbol="⌘ K"
                genUiLabel="Generate a path for what you're building"
                genUiHint={"\"add billing\", \"make it real-time\",\n\"design a feed\"…"}
              />
            </div>
          </section>
        </main>
      </div>

      {selectedCourse && (
        <CourseModal course={selectedCourse} onClose={() => setSelectedCourse(null)} />
      )}
    </>
  );
};
