# Fibr — Webhook Delivery Service

A single-process webhook delivery service that accepts events, fans them out to matching subscriptions, and delivers them reliably with retries and exponential backoff. Persists all state in SQLite so nothing is lost across restarts.

## Quick Start

```bash
npm install
npm start
```

The service starts on `http://localhost:3000`. Dashboard at `/dashboard`, API at `/api`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `ADMIN_KEY` | `dev-admin-key` | Shared admin key for API auth |
| `MAX_ATTEMPTS` | `5` | Default max delivery attempts |
| `BASE_BACKOFF_MS` | `5000` | Base backoff interval (doubles each retry) |
| `POLL_INTERVAL_MS` | `1000` | Worker poll interval |
| `DB_PATH` | `./webhooks.db` | SQLite database path |

## API

All API endpoints require the `X-Admin-Key` header (or `?admin_key=` query param).

### Subscriptions

```bash
# Create
curl -X POST http://localhost:3000/api/subscriptions \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: dev-admin-key" \
  -d '{"url":"https://example.com/hook","event_filter":"order.*","secret":"mysecret"}'

# List
curl http://localhost:3000/api/subscriptions -H "X-Admin-Key: dev-admin-key"

# Get one
curl http://localhost:3000/api/subscriptions/:id -H "X-Admin-Key: dev-admin-key"

# Delete (soft-deactivate)
curl -X DELETE http://localhost:3000/api/subscriptions/:id -H "X-Admin-Key: dev-admin-key"
```

### Events

```bash
# Ingest
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: dev-admin-key" \
  -d '{"event_type":"order.created","payload":{"orderId":"123","amount":99.99}}'

# List
curl http://localhost:3000/api/events -H "X-Admin-Key: dev-admin-key"

# Get one + deliveries
curl http://localhost:3000/api/events/:id -H "X-Admin-Key: dev-admin-key"
curl http://localhost:3000/api/events/:id/deliveries -H "X-Admin-Key: dev-admin-key"
```

### Manual Retry

```bash
curl -X POST http://localhost:3000/api/deliveries/:id/retry -H "X-Admin-Key: dev-admin-key"
```

## Event Filter Syntax

- `order.created` — exact match
- `order.*` — matches `order.created`, `order.updated`, etc.
- `*` — matches everything
- `order.*, user.created` — comma-separated, matches any

## Payload Signing

When a subscription has a `secret`, each delivery includes an `X-Webhook-Signature` header:

```
X-Webhook-Signature: t=1716742800,v1=abcdef...
```

To verify: reconstruct `{timestamp}.{body}`, HMAC-SHA256 with the shared secret, compare the `v1` value. Check that the timestamp is recent to prevent replay attacks.

## Dashboard

Browse to `http://localhost:3000/dashboard` for:
- Overview with stats (subscriptions, events, delivered/pending/failed counts)
- Subscription list and detail views (with delivery history)
- Event list with pagination and detail views (with per-delivery status)
- Manual retry button for failed/exhausted deliveries

## Running Tests

```bash
npm test
```

## What Works

- Subscription CRUD with event filter matching (exact, wildcard, multi-pattern)
- Event ingestion with fan-out to matching subscriptions
- Async delivery worker with exponential backoff retries
- Non-retryable 4xx detection (400, 401, 403, 404, 405, 410, 422)
- Retries on 5xx, 408, 429, and network errors
- HMAC-SHA256 payload signing with timestamp
- SQLite persistence (WAL mode) — survives restarts
- Dashboard with overview, subscription/event browsing, delivery drill-down, manual retry
- Admin key authentication on all API endpoints

## What's Incomplete / Would Improve With More Time

- **Concurrency**: The worker processes deliveries sequentially in a single tick. With more time, I'd use a thread pool (worker_threads) or at minimum Promise.all with a concurrency limit for parallel delivery.
- **In-flight crash recovery**: If the process crashes mid-HTTP-request, the delivery is left in `in_progress` status. A startup recovery sweep should reset stale `in_progress` deliveries back to `pending`.
- **Circuit breaker**: No per-subscription circuit breaker. If a subscriber is consistently down, we still attempt every delivery. Would add a circuit breaker that pauses deliveries after N consecutive failures.
- **Rate limiting**: No rate limiting on the ingest endpoint or per-subscriber delivery rate.
- **Subscription update endpoint**: Can only create and soft-delete, not update URL/filter/secret.
- **Request/response logging**: Delivery attempts don't store response bodies, which would help debugging.
- **Metrics/observability**: No structured logging or metrics export.
