// import { api } from "./api";  ← uncomment and swap mocks when BE is ready

export type CourseLevel = "beginner" | "intermediate" | "advanced" | "next-step";
export type LessonType = "concept" | "project" | "challenge";

export interface CourseLesson {
  title: string;
  type: LessonType;
}

export interface Course {
  code: string;
  title: string;
  description: string;
  level: CourseLevel;
  lessons?: number;
  duration: string;
  buildCount?: number;
  stack?: string[];
  ribbon?: string;
  pin?: string;
  what?: string;
  learns?: string[];
  prerequisites?: string[];
  curriculum?: CourseLesson[];
}

export interface LearningPathStep {
  num: string;
  title: string;
  meta: string;
  status?: "complete" | "current" | "upcoming";
}

// ─────────────────────────────────────────────────────────
// Mock data — replace each function body with the api call
// shown in the comment above it when the BE endpoint exists
// ─────────────────────────────────────────────────────────

const MOCK_FEATURED: Course[] = [
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

const MOCK_RECOMMENDED: Course[] = [
  {
    code: "picked.001",
    title: "Layer 2FA on top of your OTP flow",
    description: "You just shipped OTP — extend it with TOTP / push approval, the way Authy does.",
    level: "next-step",
    duration: "~90 min",
    stack: ["otpauth", "node"],
    pin: "because: OTP",
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
    code: "picked.002",
    title: "Distribute auth across services",
    description: "Move from a monolith to JWT-with-claims across an internal mesh, without breaking sessions.",
    level: "advanced",
    duration: "~4 hrs",
    stack: ["jwt", "mtls"],
    pin: "trending @ team",
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
    code: "picked.003",
    title: "Cache invalidation, the hard way",
    description: "Read-through, write-through, write-back. Learn the trade-offs by breaking each pattern in turn.",
    level: "intermediate",
    duration: "~2 hrs",
    stack: ["redis", "node"],
    pin: "your weak spot",
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

const MOCK_PATH: LearningPathStep[] = [
  { num: "STEP 01", title: "Hash a password, properly", meta: "argon2id · 12 min", status: "complete" },
  { num: "STEP 02", title: "Sessions vs. tokens", meta: "concept · 8 min", status: "complete" },
  { num: "STEP 03", title: "Build the OTP system", meta: "project · 45 min", status: "current" },
  { num: "STEP 04", title: "JWT signing & rotation", meta: "concept · 14 min" },
  { num: "STEP 05", title: "Add 3rd-party login (OAuth 2.1)", meta: "project · 60 min" },
  { num: "STEP 06", title: "Ship: rate-limit your auth", meta: "project · 30 min" },
];

// TODO: return api.get<Course[]>("/api/v1/courses/featured");
export async function getFeaturedCourses(): Promise<Course[]> {
  return MOCK_FEATURED;
}

// TODO: return api.get<Course[]>("/api/v1/courses/recommended");
export async function getRecommendedCourses(): Promise<Course[]> {
  return MOCK_RECOMMENDED;
}

// TODO: return api.get<LearningPathStep[]>("/api/v1/courses/path");
export async function getLearningPath(): Promise<LearningPathStep[]> {
  return MOCK_PATH;
}
