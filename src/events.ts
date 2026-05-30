import { getDb } from "./db";
import { v4 as uuidv4 } from "uuid";
import { findMatchingSubscriptions } from "./subscriptions";

export interface Event {
  id: string;
  event_type: string;
  payload: string;
  received_at: string;
}

export interface DeliveryAttempt {
  id: string;
  event_id: string;
  subscription_id: string;
  status: string;
  attempt_number: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || "5", 10);

export function ingestEvent(eventType: string, payload: object): { event: Event; deliveries: number } {
  const db = getDb();
  const eventId = uuidv4();
  const payloadStr = JSON.stringify(payload);

  db.prepare(`INSERT INTO events (id, event_type, payload) VALUES (?, ?, ?)`).run(
    eventId,
    eventType,
    payloadStr
  );

  const subs = findMatchingSubscriptions(eventType);

  const insertDelivery = db.prepare(
    `INSERT INTO delivery_attempts (id, event_id, subscription_id, status, max_attempts, next_retry_at)
     VALUES (?, ?, ?, 'pending', ?, datetime('now'))`
  );

  const insertAll = db.transaction(() => {
    for (const sub of subs) {
      insertDelivery.run(uuidv4(), eventId, sub.id, DEFAULT_MAX_ATTEMPTS);
    }
  });
  insertAll();

  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId) as Event;
  return { event, deliveries: subs.length };
}

export function getEvent(id: string): Event | undefined {
  return getDb().prepare(`SELECT * FROM events WHERE id = ?`).get(id) as Event | undefined;
}

export function listEvents(limit = 50, offset = 0): Event[] {
  return getDb()
    .prepare(`SELECT * FROM events ORDER BY received_at DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as Event[];
}

export function getDeliveriesForEvent(eventId: string): DeliveryAttempt[] {
  return getDb()
    .prepare(`SELECT * FROM delivery_attempts WHERE event_id = ? ORDER BY created_at`)
    .all(eventId) as DeliveryAttempt[];
}

export function getDelivery(id: string): DeliveryAttempt | undefined {
  return getDb()
    .prepare(`SELECT * FROM delivery_attempts WHERE id = ?`)
    .get(id) as DeliveryAttempt | undefined;
}

export function getDeliveriesForSubscription(subscriptionId: string): DeliveryAttempt[] {
  return getDb()
    .prepare(`SELECT * FROM delivery_attempts WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(subscriptionId) as DeliveryAttempt[];
}

export function resetDeliveryForRetry(deliveryId: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE delivery_attempts SET status = 'pending', next_retry_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND status IN ('failed', 'exhausted')`
    )
    .run(deliveryId);
  return result.changes > 0;
}

export function countEvents(): number {
  const row = getDb().prepare(`SELECT COUNT(*) as cnt FROM events`).get() as { cnt: number };
  return row.cnt;
}
