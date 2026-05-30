import assert from "assert";
import path from "path";
import fs from "fs";

const TEST_DB = path.join(__dirname, "test.db");
process.env.DB_PATH = TEST_DB;

function cleanup() {
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}
}

cleanup();

import { getDb, closeDb } from "../src/db";
import {
  createSubscription,
  listSubscriptions,
  getSubscription,
  deleteSubscription,
  matchesFilter,
  findMatchingSubscriptions,
} from "../src/subscriptions";
import {
  ingestEvent,
  listEvents,
  getEvent,
  getDeliveriesForEvent,
  resetDeliveryForRetry,
} from "../src/events";
import { signPayload, buildSignatureHeader } from "../src/signing";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

console.log("\n=== Subscription Tests ===");

test("create and retrieve subscription", () => {
  const sub = createSubscription("https://example.com/hook", "order.*", "secret123");
  assert(sub.id);
  assert.strictEqual(sub.url, "https://example.com/hook");
  assert.strictEqual(sub.event_filter, "order.*");
  assert.strictEqual(sub.secret, "secret123");
  assert.strictEqual(sub.active, 1);

  const fetched = getSubscription(sub.id);
  assert(fetched);
  assert.strictEqual(fetched!.id, sub.id);
});

test("list subscriptions", () => {
  const subs = listSubscriptions();
  assert(subs.length >= 1);
});

test("deactivate subscription", () => {
  const sub = createSubscription("https://example.com/del", "test.*");
  assert(deleteSubscription(sub.id));
  const fetched = getSubscription(sub.id);
  assert.strictEqual(fetched!.active, 0);
});

console.log("\n=== Filter Matching Tests ===");

test("exact match", () => {
  assert(matchesFilter("order.created", "order.created"));
  assert(!matchesFilter("order.updated", "order.created"));
});

test("wildcard match", () => {
  assert(matchesFilter("order.created", "order.*"));
  assert(matchesFilter("order.updated", "order.*"));
  assert(!matchesFilter("user.created", "order.*"));
});

test("global wildcard", () => {
  assert(matchesFilter("anything", "*"));
});

test("comma-separated filters", () => {
  assert(matchesFilter("order.created", "order.created, user.*"));
  assert(matchesFilter("user.deleted", "order.created, user.*"));
  assert(!matchesFilter("payment.failed", "order.created, user.*"));
});

test("find matching subscriptions", () => {
  createSubscription("https://example.com/orders", "order.*", "s1");
  createSubscription("https://example.com/all", "*", "s2");
  createSubscription("https://example.com/users", "user.*", "s3");

  const matches = findMatchingSubscriptions("order.created");
  assert(matches.length >= 2); // order.* and *
  const urls = matches.map(m => m.url);
  assert(urls.includes("https://example.com/orders"));
  assert(urls.includes("https://example.com/all"));
});

console.log("\n=== Event Tests ===");

test("ingest event creates event and deliveries", () => {
  const result = ingestEvent("order.created", { orderId: "123", amount: 99.99 });
  assert(result.event.id);
  assert.strictEqual(result.event.event_type, "order.created");
  assert(result.deliveries > 0);

  const fetched = getEvent(result.event.id);
  assert(fetched);
  assert.strictEqual(fetched!.event_type, "order.created");
});

test("deliveries created for matching subscriptions", () => {
  const result = ingestEvent("order.updated", { orderId: "456" });
  const deliveries = getDeliveriesForEvent(result.event.id);
  assert(deliveries.length > 0);
  assert(deliveries.every(d => d.status === "pending"));
});

test("list events returns recent events", () => {
  const events = listEvents(10, 0);
  assert(events.length >= 2);
});

test("reset delivery for retry", () => {
  const result = ingestEvent("order.test", { test: true });
  const deliveries = getDeliveriesForEvent(result.event.id);
  const d = deliveries[0];
  // Mark as failed first
  getDb().prepare(`UPDATE delivery_attempts SET status = 'failed' WHERE id = ?`).run(d.id);
  const ok = resetDeliveryForRetry(d.id);
  assert(ok);
});

console.log("\n=== Signing Tests ===");

test("signPayload produces consistent HMAC", () => {
  const sig1 = signPayload("hello", "secret");
  const sig2 = signPayload("hello", "secret");
  assert.strictEqual(sig1, sig2);
  assert.strictEqual(sig1.length, 64); // hex sha256
});

test("different secrets produce different signatures", () => {
  const sig1 = signPayload("hello", "secret1");
  const sig2 = signPayload("hello", "secret2");
  assert.notStrictEqual(sig1, sig2);
});

test("buildSignatureHeader has correct format", () => {
  const header = buildSignatureHeader('{"test":true}', "mysecret");
  assert(header.startsWith("t="));
  assert(header.includes(",v1="));
});

console.log("\n=== Persistence Test ===");

test("data survives db close and reopen", () => {
  const eventsBefore = listEvents(100, 0);
  closeDb();
  // Force re-init
  (require("../src/db") as any).db = undefined;
  // Re-require won't work easily, but getDb() creates a new connection
  const eventsAfter = listEvents(100, 0);
  assert.strictEqual(eventsAfter.length, eventsBefore.length);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

closeDb();
cleanup();

process.exit(failed > 0 ? 1 : 0);
