// The harness half of a compatibility suite: the control plane, and the assertions.
//
// Every script in this directory plays two roles at once. It is the **harness** —
// seeding state, arming fault rules, and grading from `/state` and the op log — and it is
// the **student**, whose code runs against the data plane through a real, unmodified
// client library.
//
// This module is the harness half, and it is shared because it is identical for every
// client and every emulator. The student half is what differs, and that is the half worth
// writing once per client. See `harness.py` for the Python twin.
//
// Nothing here touches a data plane. That asymmetry is the point — the control plane is
// reachable only from the harness network, never from a student's sandbox.

export const CONTROL = process.env.CANNAE_CONTROL ?? "http://127.0.0.1:9900";
export const HOST = process.env.CANNAE_HOST ?? "127.0.0.1";

/** A data-plane port, overridable so a suite can run beside the real thing. */
export function port(variable, fallback) {
  return Number(process.env[variable] ?? fallback);
}

/**
 * Call the harness-only control plane. A rejection throws rather than returning: a suite
 * that seeded badly must fail where it seeded, not three assertions later.
 */
export async function control(method, path, body) {
  const response = await fetch(`${CONTROL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`control ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const reset = () => control("POST", "/reset");
export const seed = (emulator, body) => control("POST", "/seed", { emulator, ...body });
export const arm = (emulator, rule) => control("POST", "/faults", { emulator, ...rule });
export const log = (emulator) => control("GET", `/log?emulator=${emulator}`);
export const state = (emulator) => control("GET", `/state?emulator=${emulator}`);

/**
 * The ops the student's own code issued, in order. Client libraries chatter, and the op
 * log records all of it faithfully — so a grader filters to the ops the lesson is about.
 */
export async function ops(emulator, lessonOps) {
  return (await log(emulator)).filter((record) => lessonOps.has(record.op)).map((r) => r.op);
}

export function expect(actual, wanted, what) {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `FAIL ${what}\n  expected: ${JSON.stringify(wanted)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
  console.log(`  ok  ${what}`);
}

/** Run each stage in order, announcing it, and exit non-zero on the first failure. */
export async function runStages(banner, stages, name) {
  try {
    console.log(banner);
    for (const stage of stages) {
      console.log(`${stage.name}:`);
      await stage();
    }
    console.log(`${name} compatibility suite passed`);
  } catch (error) {
    console.error(error.message ?? error);
    process.exit(1);
  }
}
