#!/usr/bin/env node
// Blessed-client compatibility suite: `ioredis`, unmodified, against the emulator.
//
// The Node twin of `cache_aside.py` — same scenario, same op-log grading, different
// client library. Nothing here is emulator-aware apart from the control-plane calls
// the *harness* makes; the cache itself is reached over a plain redis:// connection.

import Redis from "ioredis";

import { HOST, arm, expect, ops, port, reset, seed } from "./harness.mjs";

const PORT = port("CANNAE_PORT", 6379);

// Client libraries chatter on connect (ioredis issues `INFO` for its ready check).
// That is real traffic and the log records it faithfully; a grader filters to the
// data ops the student's own code issued.
const LESSON_OPS = new Set([
  "GET", "MGET", "SET", "SETNX", "SETEX", "DEL",
  "EXISTS", "EXPIRE", "TTL", "INCR", "INCRBY",
]);

const lessonOps = () => ops("cache", LESSON_OPS);

/**
 * Reset the emulator, seed it, arm any rules — *then* connect.
 *
 * Order matters and mirrors the lesson flow: `/reset` retires every live socket, so a
 * client created before it would find its connection dropped. The harness always sets
 * the scene before the student's code runs.
 *
 * `maxRetriesPerRequest: 0` makes a `kill_connection` fault surface as an error
 * instead of a silent retry — a lesson must see the failure its code caused.
 */
const OPEN_CLIENTS = [];

async function freshCache(keys = {}, faults = []) {
  await reset();
  await seed("cache", { keys });
  for (const rule of faults) {
    await arm("cache", rule);
  }
  const cache = new Redis({ host: HOST, port: PORT, maxRetriesPerRequest: 0 });
  OPEN_CLIENTS.push(cache);
  return cache;
}

/** The store the cache sits in front of. Its read count is the whole point. */
class BackingStore {
  constructor(rows) {
    this.rows = rows;
    this.reads = 0;
  }

  read(userId) {
    this.reads += 1;
    return this.rows[userId] ?? null;
  }
}

/** The lesson's target implementation — plain cache-aside, no emulator awareness. */
async function getUserProfile(cache, store, userId) {
  const key = `user:${userId}`;
  const cached = await cache.get(key);
  if (cached !== null) return cached;
  const profile = store.read(userId);
  if (profile === null) return null;
  await cache.set(key, profile, "EX", 60);
  return profile;
}

/** The command surface a caching lesson needs, driven through the real client. */
async function smoke() {
  const cache = await freshCache();
  expect(await cache.ping(), "PONG", "PING");
  expect(await cache.set("a", "1"), "OK", "SET");
  expect(await cache.get("a"), "1", "GET");
  expect(await cache.exists("a", "b"), 1, "EXISTS");
  expect(await cache.setnx("a", "2"), 0, "SETNX on an existing key");
  expect(await cache.get("a"), "1", "SETNX did not overwrite");
  expect(await cache.incr("hits"), 1, "INCR");
  expect(await cache.incrby("hits", 9), 10, "INCRBY");
  expect(await cache.expire("a", 30), 1, "EXPIRE");
  expect(await cache.ttl("a"), 30, "TTL");
  expect(await cache.mget("a", "missing", "hits"), ["1", null, "10"], "MGET");
  expect(await cache.setex("s", 5, "v"), "OK", "SETEX");
  expect(await cache.ttl("s"), 5, "TTL after SETEX");
  expect(await cache.set("nx", "v", "NX"), "OK", "SET NX on a free key");
  expect(await cache.set("nx", "w", "NX"), null, "SET NX on a taken key");
  expect(await cache.set("nx", "w", "XX"), "OK", "SET XX on a taken key");
  expect(await cache.del("a", "hits"), 2, "DEL");
  expect(await cache.get("a"), null, "GET after DEL is a miss");
}

/** The milestone lesson, graded from the op log. */
async function cacheAside() {
  const cache = await freshCache();
  const store = new BackingStore({ 1: '{"name":"Ada"}' });

  expect(await getUserProfile(cache, store, "1"), '{"name":"Ada"}', "first call returns the profile");
  expect(await lessonOps(), ["GET", "SET"], "the cache is read BEFORE the store, written AFTER the miss");
  expect(store.reads, 1, "the miss read the backing store once");

  expect(await getUserProfile(cache, store, "1"), '{"name":"Ada"}', "second call returns the profile");
  expect(await lessonOps(), ["GET", "SET", "GET"], "a hit issues no SET");
  expect(store.reads, 1, "a hit does not touch the backing store");

  // Forced expiry — a scripted clock advance, not a 61-second sleep.
  await arm("cache", { action: "advance_clock", params: { seconds: 61 } });
  expect(await getUserProfile(cache, store, "1"), '{"name":"Ada"}', "fallback after expiry");
  expect(await lessonOps(), ["GET", "SET", "GET", "GET", "SET"], "an expired entry is repopulated");
  expect(store.reads, 2, "the expiry sent the student back to the store");
}

/** The same fallback, forced by a fault rule targeting one key. */
async function forcedExpiryFault() {
  const cache = await freshCache({ "user:1": "ada", "user:2": "grace" }, [
    { action: "expire_key", after: { op_matches: "read", count: 1 }, params: { key: "user:1" } },
  ]);
  expect(await cache.get("user:2"), "grace", "an unrelated key does not consume the rule");
  expect(await cache.get("user:1"), null, "the fault turns the read into a miss");
  expect(await cache.get("user:1"), null, "and the key is really gone");
}

/** A student's mistake must reject with the same error a real Redis would. */
async function errorHandling() {
  const cache = await freshCache();
  await expectRejection(cache.call("FLUSHALL"), "unknown command 'FLUSHALL'", "an unknown command rejects");
  await cache.set("name", "ada");
  await expectRejection(cache.incr("name"), "value is not an integer or out of range", "INCR on text rejects");
  expect(await cache.ping(), "PONG", "the connection is still usable after errors");
}

async function expectRejection(promise, fragment, what) {
  try {
    await promise;
  } catch (error) {
    if (!error.message.includes(fragment)) {
      throw new Error(`FAIL ${what}\n  expected message containing: ${fragment}\n  actual: ${error.message}`);
    }
    console.log(`  ok  ${what}`);
    return;
  }
  throw new Error(`FAIL ${what} — it resolved instead of rejecting`);
}

async function main() {
  console.log(`ioredis → redis://${HOST}:${PORT}`);
  try {
    for (const stage of [smoke, cacheAside, forcedExpiryFault, errorHandling]) {
      console.log(`${stage.name}:`);
      await stage();
    }
  } finally {
    // Otherwise the open sockets keep the event loop alive and the run never exits.
    OPEN_CLIENTS.forEach((cache) => cache.disconnect());
  }
  console.log("ioredis compatibility suite passed");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
