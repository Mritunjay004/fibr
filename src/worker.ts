import { getDb } from "./db";
import { getSubscription } from "./subscriptions";
import { DeliveryAttempt } from "./events";
import { buildSignatureHeader } from "./signing";
import fetch from "node-fetch";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "1000", 10);
const BASE_BACKOFF_MS = parseInt(process.env.BASE_BACKOFF_MS || "5000", 10);

const NON_RETRYABLE_4XX = new Set([400, 401, 403, 404, 405, 410, 422]);

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function startWorker(): void {
  if (running) return;
  running = true;
  tick();
}

export function stopWorker(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function tick(): void {
  if (!running) return;
  try {
    processReadyDeliveries();
  } catch (err) {
    console.error("[worker] tick error:", err);
  }
  timer = setTimeout(tick, POLL_INTERVAL_MS);
}

function processReadyDeliveries(): void {
  const db = getDb();
  const deliveries = db
    .prepare(
      `SELECT * FROM delivery_attempts
       WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
       ORDER BY next_retry_at ASC
       LIMIT 10`
    )
    .all() as DeliveryAttempt[];

  for (const delivery of deliveries) {
    deliverOne(delivery);
  }
}

async function deliverOne(delivery: DeliveryAttempt): Promise<void> {
  const db = getDb();
  const sub = getSubscription(delivery.subscription_id);
  if (!sub || !sub.active) {
    db.prepare(
      `UPDATE delivery_attempts SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
    ).run(delivery.id);
    return;
  }

  const event = db
    .prepare(`SELECT * FROM events WHERE id = ?`)
    .get(delivery.event_id) as { id: string; event_type: string; payload: string } | undefined;
  if (!event) return;

  const attemptNum = delivery.attempt_number + 1;
  db.prepare(
    `UPDATE delivery_attempts SET attempt_number = ?, status = 'in_progress', updated_at = datetime('now') WHERE id = ?`
  ).run(attemptNum, delivery.id);

  const body = JSON.stringify({
    event_id: event.id,
    event_type: event.event_type,
    payload: JSON.parse(event.payload),
    attempt: attemptNum,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": event.event_type,
    "X-Webhook-Delivery": delivery.id,
  };

  if (sub.secret) {
    headers["X-Webhook-Signature"] = buildSignatureHeader(body, sub.secret);
  }

  try {
    const resp = await fetch(sub.url, {
      method: "POST",
      headers,
      body,
      timeout: 10000,
    });

    const statusCode = resp.status;

    if (statusCode >= 200 && statusCode < 300) {
      db.prepare(
        `UPDATE delivery_attempts SET status = 'delivered', last_status_code = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(statusCode, delivery.id);
      return;
    }

    if (statusCode >= 400 && statusCode < 500 && NON_RETRYABLE_4XX.has(statusCode)) {
      db.prepare(
        `UPDATE delivery_attempts SET status = 'failed', last_status_code = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(statusCode, `Non-retryable ${statusCode}`, delivery.id);
      return;
    }

    scheduleRetryOrExhaust(delivery, attemptNum, statusCode, `HTTP ${statusCode}`);
  } catch (err: any) {
    scheduleRetryOrExhaust(delivery, attemptNum, null, err.message || "Network error");
  }
}

function scheduleRetryOrExhaust(
  delivery: DeliveryAttempt,
  attemptNum: number,
  statusCode: number | null,
  errorMsg: string
): void {
  const db = getDb();

  if (attemptNum >= delivery.max_attempts) {
    db.prepare(
      `UPDATE delivery_attempts SET status = 'exhausted', last_status_code = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(statusCode, errorMsg, delivery.id);
    return;
  }

  const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attemptNum - 1);
  const backoffSec = Math.ceil(backoffMs / 1000);

  db.prepare(
    `UPDATE delivery_attempts
     SET status = 'pending', last_status_code = ?, last_error = ?,
         next_retry_at = datetime('now', '+' || ? || ' seconds'),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(statusCode, errorMsg, backoffSec, delivery.id);
}
