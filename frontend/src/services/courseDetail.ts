// import { api } from "./api";  ← uncomment and swap mocks when BE is ready

// ── Domain types ────────────────────────────────────────────
export type LessonKind = "theory" | "build";
export type Port = "l" | "r" | "t" | "b";

export interface CourseModule { id: string; label: string; }
export interface CourseNodeDef {
  kind: "node" | "service";
  x: number; y: number; label: string;
  modules?: CourseModule[];
}
export interface CourseEdgeDef {
  id: string; from: string; to: string;
  fromPort: Port; toPort: Port; fromMod?: string;
}
export interface TestCase { name: string; check: (code: string) => boolean; }
export interface LessonCode { file: string; starter: string; tests: TestCase[]; }
export interface LessonTheory { tag: string; body: string; }
export interface LessonDrag { kind: "node" | "module"; id: string; parent?: string; label: string; scribble: string; }
export interface LessonTarget { type: "empty" | "service"; serviceId?: string; }
export interface LessonAdds { nodes: string[]; edges: string[]; modules: string[]; }
export interface Lesson {
  id: string; num: string; kind: LessonKind; title: string; meta: string;
  theory?: LessonTheory; drag?: LessonDrag; target?: LessonTarget;
  code?: LessonCode; adds: LessonAdds; addsExtra?: { nodes: string[] };
}

export interface CourseContent {
  nodes: Record<string, CourseNodeDef>;
  edges: CourseEdgeDef[];
  lessons: Lesson[];
}

// ── Mock data ────────────────────────────────────────────────

const OTP_NODES: Record<string, CourseNodeDef> = {
  client: { kind: "node",    x: 10, y: 50, label: "Client" },
  api:    { kind: "service", x: 38, y: 46, label: "API",
            modules: [
              { id: "otpSvc",  label: "OTP Service" },
              { id: "auth",    label: "Auth Module" },
              { id: "limiter", label: "Rate Limiter" },
            ] },
  redis:  { kind: "node",    x: 68, y: 24, label: "Redis" },
  db:     { kind: "node",    x: 68, y: 50, label: "Postgres" },
  sms:    { kind: "node",    x: 90, y: 24, label: "Twilio" },
  audit:  { kind: "node",    x: 88, y: 74, label: "Audit Log" },
};

const OTP_EDGES: CourseEdgeDef[] = [
  { id: "e_client_api", from: "client", to: "api",   fromPort: "r", toPort: "l" },
  { id: "e_otp_redis",  from: "api",    to: "redis", fromPort: "r", toPort: "l", fromMod: "otpSvc" },
  { id: "e_otp_sms",    from: "api",    to: "sms",   fromPort: "r", toPort: "l", fromMod: "otpSvc" },
  { id: "e_auth_db",    from: "api",    to: "db",    fromPort: "r", toPort: "l", fromMod: "auth" },
  { id: "e_lim_redis",  from: "api",    to: "redis", fromPort: "r", toPort: "b", fromMod: "limiter" },
  { id: "e_lim_audit",  from: "api",    to: "audit", fromPort: "r", toPort: "l", fromMod: "limiter" },
];

const OTP_LESSONS: Lesson[] = [
  {
    id: "l1", num: "01", kind: "theory", title: "Hash a password, properly", meta: "argon2id · 12 min",
    theory: {
      tag: "theory · cryptography",
      body: `
        <p>Before we build anything, get this in your bones: <b>never store a password in plain text.</b> The defense isn't secrecy, it's making the offline-cracking attack so expensive that an attacker with your DB walks away.</p>
        <h4>The 3 properties you need</h4>
        <ul>
          <li><b>Salted</b> — same password, different hash for every user. Defeats rainbow tables.</li>
          <li><b>Slow</b> — tunable cost, ~250ms on your hardware. Defeats brute force.</li>
          <li><b>Memory-hard</b> — needs RAM, not just CPU. Defeats GPU farms.</li>
        </ul>
        <h4>Use this</h4>
        <p><code>argon2id</code> is the answer. Skip <code>bcrypt</code>, skip <code>pbkdf2</code>, skip rolling your own. Tune <code>m=64MB, t=3, p=4</code> on a typical box.</p>
        <blockquote>OTP isn't password storage — but the cost mindset (slow on purpose) carries over to OTP brute-force protection.</blockquote>
      `,
    },
    adds: { nodes: [], edges: [], modules: [] },
  },
  {
    id: "l2", num: "02", kind: "build", title: "Sketch the OTP flow",
    meta: "build · 8 min · place a service",
    drag: { kind: "node", id: "api", label: "API service", scribble: "drop on the empty board area" },
    target: { type: "empty" },
    code: {
      file: "api/server.js",
      starter:
`// minimal API server — the entry point for /otp routes
const express = require('express');
const app = express();
app.use(express.json());

// TODO: wire up routes:
//   POST /otp/request  → generate + send code
//   POST /otp/verify   → check + issue session

app.post('/otp/request', (req, res) => {
  // TODO
});

app.post('/otp/verify', (req, res) => {
  // TODO
});

app.listen(3000);
`,
      tests: [
        { name: "exposes POST /otp/request", check: (c) => /post\(['"\`]\/otp\/request/.test(c) },
        { name: "exposes POST /otp/verify",  check: (c) => /post\(['"\`]\/otp\/verify/.test(c) },
        { name: "uses express.json()",       check: (c) => /express\.json\(\)/.test(c) },
        { name: "listens on port 3000",      check: (c) => /listen\(\s*3000/.test(c) },
      ],
    },
    adds: { nodes: ["client", "api"], edges: ["e_client_api"], modules: [] },
  },
  {
    id: "l3", num: "03", kind: "build", title: "Store OTPs in Redis (with TTL)",
    meta: "build · 30 min · OTP Service",
    drag: { kind: "module", id: "otpSvc", parent: "api", label: "OTP Service", scribble: "into the API service" },
    target: { type: "service", serviceId: "api" },
    code: {
      file: "modules/otp-service.js",
      starter:
`// OTP Service — generate, store (Redis with TTL), and issue codes
const crypto = require('crypto');

const TTL_SECONDS = 300; // 5 min

function generateCode() {
  // 6-digit numeric OTP
  // TODO: use crypto.randomInt
  return '000000';
}

async function issueOtp(redis, phone) {
  const code = generateCode();
  // TODO: redis.set(\`otp:\${phone}\`, code, 'EX', TTL_SECONDS)
  return code;
}

module.exports = { generateCode, issueOtp, TTL_SECONDS };
`,
      tests: [
        { name: "uses crypto.randomInt for the code", check: (c) => /crypto\.randomInt\(/.test(c) },
        { name: "TTL is 300 seconds (5 min)",         check: (c) => /TTL_SECONDS\s*=\s*300/.test(c) },
        { name: "stores under key otp:<phone>",       check: (c) => /otp:\$\{phone\}/.test(c) },
        { name: "uses Redis EX flag for expiry",      check: (c) => /['"]EX['"]/.test(c) && /redis\.set/.test(c) },
      ],
    },
    adds: { nodes: ["redis"], edges: ["e_otp_redis"], modules: ["api:otpSvc"] },
  },
  {
    id: "l4", num: "04", kind: "theory", title: "Why TTL beats cron-cleanup", meta: "theory · 5 min",
    theory: {
      tag: "theory · data lifecycle",
      body: `
        <p>You could store OTPs forever and run a nightly cleanup. Don't. Push the expiry into Redis itself with <code>EX</code>.</p>
        <h4>Three reasons</h4>
        <ul>
          <li><b>Correctness for free</b> — verifying a key that doesn't exist returns null. No "expired?" check in your code.</li>
          <li><b>No race window</b> — between cron runs, expired codes still work. Bad.</li>
          <li><b>Operational simplicity</b> — one less moving part to monitor.</li>
        </ul>
        <blockquote>"If the system can know, the database should know." — every backend after their first incident</blockquote>
        <p>Same logic applies to sessions, password-reset tokens, magic links. TTL all the way down.</p>
      `,
    },
    adds: { nodes: [], edges: [], modules: [] },
  },
  {
    id: "l5", num: "05", kind: "build", title: "Wire SMS delivery (Twilio)",
    meta: "build · 25 min · place Twilio",
    drag: { kind: "node", id: "sms", label: "Twilio", scribble: "external service · drop on board" },
    target: { type: "empty" },
    code: {
      file: "modules/sms.js",
      starter:
`// SMS delivery via Twilio — used by OTP Service to send the code
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

async function sendOtp(phone, code) {
  // TODO: send a text containing the OTP code
  // body must include the code, must NOT include any other PII
  return client.messages.create({
    to: phone,
    from: process.env.TWILIO_NUMBER,
    body: 'your code: ' + code,
  });
}

module.exports = { sendOtp };
`,
      tests: [
        { name: "exports sendOtp",            check: (c) => /module\.exports.*sendOtp/.test(c) },
        { name: "uses Twilio SDK",            check: (c) => /require\(['"]twilio['"]\)/.test(c) },
        { name: "reads creds from env",       check: (c) => /process\.env\.TWILIO_SID/.test(c) && /process\.env\.TWILIO_TOKEN/.test(c) },
        { name: "message body contains code", check: (c) => /body:.*code/.test(c) },
      ],
    },
    adds: { nodes: [], edges: ["e_otp_sms"], modules: [] },
    addsExtra: { nodes: ["sms"] },
  },
  {
    id: "l6", num: "06", kind: "build", title: "Persist users in Postgres",
    meta: "build · 25 min · Auth Module",
    drag: { kind: "module", id: "auth", parent: "api", label: "Auth Module", scribble: "into the API service" },
    target: { type: "service", serviceId: "api" },
    code: {
      file: "modules/auth.js",
      starter:
`// Auth Module — verifies OTPs and issues a session
async function verifyOtp(redis, db, phone, code) {
  const stored = await redis.get(\`otp:\${phone}\`);

  // TODO:
  //  1. constant-time compare stored vs code
  //  2. delete the otp key on success (one-shot)
  //  3. upsert the user in Postgres
  //  4. return a session token

  return null;
}

module.exports = { verifyOtp };
`,
      tests: [
        { name: "constant-time compare (timingSafeEqual)", check: (c) => /timingSafeEqual/.test(c) },
        { name: "deletes the otp key after success",       check: (c) => /redis\.del/.test(c) },
        { name: "upserts the user in Postgres",            check: (c) => /INSERT.+ON CONFLICT/i.test(c) || /upsert/i.test(c) },
        { name: "returns a session token",                 check: (c) => /return\s+\{[^}]*token/.test(c) },
      ],
    },
    adds: { nodes: ["db"], edges: ["e_auth_db"], modules: ["api:auth"] },
  },
  {
    id: "l7", num: "07", kind: "build", title: "Rate-limit with token bucket",
    meta: "build · 25 min · Rate Limiter",
    drag: { kind: "module", id: "limiter", parent: "api", label: "Rate Limiter", scribble: "into the API service" },
    target: { type: "service", serviceId: "api" },
    code: {
      file: "modules/limiter.js",
      starter:
`// Rate Limiter — token bucket, backed by Redis
const CAPACITY = 5;        // 5 requests
const REFILL_PER_SEC = 1;  // 1 token / sec

async function take(redis, key) {
  // TODO:
  //  1. read tokens, lastRefill from Redis
  //  2. refill: tokens += elapsed * REFILL_PER_SEC, capped at CAPACITY
  //  3. if tokens >= 1: tokens -= 1, write back, return true
  //  4. else: return false (HTTP 429 from caller)
  return true;
}

module.exports = { take, CAPACITY, REFILL_PER_SEC };
`,
      tests: [
        { name: "capacity is 5",              check: (c) => /CAPACITY\s*=\s*5/.test(c) },
        { name: "refills 1 token per second", check: (c) => /REFILL_PER_SEC\s*=\s*1/.test(c) },
        { name: "caps tokens at CAPACITY",    check: (c) => /Math\.min\([^)]*CAPACITY/.test(c) },
        { name: "decrements tokens on take",  check: (c) => /tokens\s*-(=|\s*1)/.test(c) || /tokens\s*=\s*tokens\s*-\s*1/.test(c) },
        { name: "returns false when no tokens", check: (c) => /return\s+false/.test(c) },
      ],
    },
    adds: { nodes: [], edges: ["e_lim_redis"], modules: ["api:limiter"] },
  },
  {
    id: "l8", num: "08", kind: "build", title: "Audit & alert on abuse",
    meta: "build · 20 min · place Audit Log",
    drag: { kind: "node", id: "audit", label: "Audit Log", scribble: "sits outside the API" },
    target: { type: "empty" },
    code: {
      file: "modules/audit.js",
      starter:
`// Audit log — fire-and-forget structured events
const fs = require('fs/promises');

async function audit(event, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...fields,
  }) + '\\n';
  // TODO: append to logs/audit.jsonl
}

// emit when rate limit fires
async function alertAbuse(phone, count) {
  // TODO: audit('rate_limit_hit', { phone, count })
}

module.exports = { audit, alertAbuse };
`,
      tests: [
        { name: "writes structured (JSON) lines",  check: (c) => /JSON\.stringify/.test(c) },
        { name: "appends to logs/audit.jsonl",     check: (c) => /fs\.appendFile.*logs\/audit\.jsonl/.test(c) || /appendFile\(['"\`]logs\/audit\.jsonl/.test(c) },
        { name: "alertAbuse calls audit()",        check: (c) => /alertAbuse[\s\S]*audit\(['"\`]rate_limit_hit/.test(c) },
        { name: "events include a timestamp",      check: (c) => /toISOString\(\)/.test(c) },
      ],
    },
    adds: { nodes: ["audit"], edges: ["e_lim_audit"], modules: [] },
  },
  {
    id: "l9", num: "09", kind: "theory", title: "Ship: review your architecture", meta: "theory · 5 min",
    theory: {
      tag: "wrap-up · review",
      body: `
        <p>Step back and look at the right side. That's <b>your</b> system — every box and arrow came from a lesson you finished.</p>
        <h4>Sanity check before deploying</h4>
        <ul>
          <li>OTP keys are written with TTL — confirmed in lesson 3.</li>
          <li>Auth uses constant-time compare — confirmed in lesson 6.</li>
          <li>Rate limiter caps at 5 / sec / phone — confirmed in lesson 7.</li>
          <li>Abuse hits the Audit Log — confirmed in lesson 8.</li>
        </ul>
        <h4>What to add next</h4>
        <ul>
          <li>OTP code length tunable per market (some require 4-digit).</li>
          <li>Phone carrier lookup before send — block VoIP numbers if you must.</li>
          <li>Replace SMS with passkeys when you can. SMS OTP is the worst factor that's better than nothing.</li>
        </ul>
        <blockquote>You didn't read about an OTP system. You built one.</blockquote>
      `,
    },
    adds: { nodes: [], edges: [], modules: [] },
  },
];

const MOCK_CONTENT: Record<string, CourseContent> = {
  "otp-system": { nodes: OTP_NODES, edges: OTP_EDGES, lessons: OTP_LESSONS },
};

// TODO: return api.get<CourseContent>(`/api/v1/courses/${slug}/content`);
export async function getCourseContent(slug: string): Promise<CourseContent> {
  return MOCK_CONTENT[slug] ?? MOCK_CONTENT["otp-system"];
}
