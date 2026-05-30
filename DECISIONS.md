# Design Decisions

## Storage

**Chose:** SQLite via `better-sqlite3` with WAL mode.

**Alternatives considered:** PostgreSQL, embedded key-value stores (LevelDB), flat JSON files.

**Why:** The spec explicitly says single process and that SQLite is fine. SQLite in WAL mode gives us ACID transactions, concurrent reads, and zero operational overhead — no separate database process to manage. `better-sqlite3` is synchronous, which simplifies the worker loop and avoids callback complexity. The tradeoff is that writes serialize through a single writer lock, but for a single-process service this is actually a feature: it prevents double-delivery races without needing explicit row-level locks. PostgreSQL would be overkill here and would violate the "local docker-compose or npm start" simplicity goal.

## Concurrency / Worker Model

**Chose:** Single async polling loop with `setTimeout`, processing deliveries synchronously in batches of 10.

**Alternatives considered:** `worker_threads` pool, `setInterval`-based polling, event-driven (process pending immediately on ingest), external job queue (Bull/BullMQ).

**Why:** A polling loop is dead simple to reason about and debug. It processes ready deliveries every second, which is fast enough for this scale. The synchronous approach means we never have two in-flight deliveries to the same subscriber competing for state updates — no race conditions by construction. The main tradeoff is throughput: if a subscriber is slow (say, 5-second response time), we block other deliveries. In production I'd use a bounded concurrency pool (`Promise.all` with a semaphore or `worker_threads`), but for this scope the simplicity wins. The worker picks up pending deliveries where `next_retry_at <= now`, so crash recovery is straightforward — anything left in `pending` gets retried on next tick.

One known gap: deliveries stuck in `in_progress` (process crashed mid-request) aren't automatically recovered. A production system would sweep for stale `in_progress` rows on startup.

## Retry Policy

**Chose:** Exponential backoff starting at 5 seconds, doubling each attempt, with a configurable maximum of 5 attempts. Non-retryable on most 4xx (400, 401, 403, 404, 405, 410, 422); retryable on 408 (timeout), 429 (rate limit), all 5xx, and network errors.

**Alternatives considered:** Fixed interval retries, jittered backoff, subscriber-configurable retry policies, dead letter queue.

**Why:** Exponential backoff is the standard approach for avoiding retry storms when a subscriber is down. The 5s/10s/20s/40s/80s progression gives the subscriber time to recover without waiting too long. I treat 408 and 429 as retryable because they explicitly signal "try again later." Other 4xx codes indicate a permanent problem (bad endpoint, auth failure) where retrying is wasteful. After max attempts, the delivery moves to `exhausted` — it's visible in the dashboard and can be manually retried. Adding jitter would be a natural improvement to prevent thundering herd when many deliveries back off simultaneously.

## Payload Signing

**Chose:** HMAC-SHA256 with a Stripe-style signature header: `X-Webhook-Signature: t=<unix_timestamp>,v1=<hmac>`. The signed payload is `{timestamp}.{body}`.

**Alternatives considered:** Simple HMAC of body only, JWTs, asymmetric signing (RSA/Ed25519).

**Why:** The Stripe pattern is well-understood and solves two problems: authentication (only someone with the shared secret could produce the HMAC) and replay protection (the timestamp is part of the signed payload, so subscribers can reject old signatures). Asymmetric signing would let subscribers verify without holding a secret, but adds key management complexity that's out of scope. The `v1=` prefix allows future algorithm versioning without breaking existing subscribers.

## Dashboard Scope

**Chose:** Server-rendered HTML with inline CSS. Four views: overview (stats), subscription list/detail, event list/detail with delivery drill-down. Manual retry via form POST.

**Alternatives considered:** React SPA, a separate frontend build step, terminal UI.

**Why:** The spec says "plain is fine" and "we're not grading CSS." Server-rendered HTML means zero build tooling, zero client-side JS, and the dashboard works in any browser including curl. The views cover the spec requirements: list subscriptions, browse events, drill into deliveries, retry failed ones. Each delivery row shows status, attempt count, HTTP code, error message, and next retry time — enough to debug webhook failures. A React SPA would add a build step, a bundler, and client-side state management, all for a dashboard that's fundamentally a few database queries rendered as tables.
