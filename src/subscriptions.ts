import { getDb } from "./db";
import { v4 as uuidv4 } from "uuid";

export interface Subscription {
  id: string;
  url: string;
  secret: string | null;
  event_filter: string;
  active: number;
  created_at: string;
}

export function createSubscription(
  url: string,
  eventFilter: string,
  secret?: string
): Subscription {
  const id = uuidv4();
  const db = getDb();
  db.prepare(
    `INSERT INTO subscriptions (id, url, secret, event_filter) VALUES (?, ?, ?, ?)`
  ).run(id, url, secret || null, eventFilter);
  return db.prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(id) as Subscription;
}

export function getSubscription(id: string): Subscription | undefined {
  return getDb()
    .prepare(`SELECT * FROM subscriptions WHERE id = ?`)
    .get(id) as Subscription | undefined;
}

export function listSubscriptions(): Subscription[] {
  return getDb()
    .prepare(`SELECT * FROM subscriptions ORDER BY created_at DESC`)
    .all() as Subscription[];
}

export function deleteSubscription(id: string): boolean {
  const result = getDb()
    .prepare(`UPDATE subscriptions SET active = 0 WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

export function matchesFilter(eventType: string, filter: string): boolean {
  const patterns = filter.split(",").map((p) => p.trim());
  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return eventType === prefix || eventType.startsWith(prefix + ".");
    }
    return eventType === pattern;
  });
}

export function findMatchingSubscriptions(eventType: string): Subscription[] {
  const all = getDb()
    .prepare(`SELECT * FROM subscriptions WHERE active = 1`)
    .all() as Subscription[];
  return all.filter((sub) => matchesFilter(eventType, sub.event_filter));
}
