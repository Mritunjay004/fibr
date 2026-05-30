# AI Interaction Log

## 1. Initial Architecture Scaffolding

**What I asked:** Generate the project structure for a webhook delivery service — TypeScript, Express, SQLite, with a worker loop for deliveries.

**What came back:** A full scaffold with all modules in one pass: db, subscriptions, events, signing, worker, API routes, dashboard, and tests.

**What I kept/modified:** Kept the overall module layout (it matched what I'd have done). Modified the TypeScript config significantly — the AI generated a TS6 config with `verbatimModuleSyntax` enabled, which broke all imports under CommonJS. I simplified to a minimal tsconfig. Also had to fix Express v5 type incompatibilities (`req.params` returns `string | string[]` in v5), which the AI didn't account for.

## 2. Event Filter Matching Logic

**What I asked:** Implement wildcard matching for event type filters (e.g., `order.*` matches `order.created`).

**What came back:** A `matchesFilter` function that splits comma-separated patterns and checks exact match, `.*` suffix wildcards, and global `*`.

**What I kept/modified:** Kept the approach. The implementation correctly handles the prefix check (strips `.*`, checks `startsWith`). I verified it handles edge cases: `order.*` should match `order.created` but not `orderfoo` (it does, because it checks for the `.` separator). One thing I'd revisit: `order.*` currently matches `order` itself (just the prefix with no dot suffix) — this is debatable but I left it since wildcard subscriptions probably want the parent event too.

## 3. Retry Status Code Classification

**What I asked:** Which HTTP status codes should be retryable vs permanent failures for webhook delivery?

**What came back:** Suggested treating all 4xx as non-retryable except 408 and 429.

**What I modified:** I agreed with the 408/429 exception but narrowed the non-retryable set to specific codes (400, 401, 403, 404, 405, 410, 422) rather than blanket 4xx. My reasoning: unknown 4xx codes might be custom codes from proxies or CDNs, and it's safer to retry those than to silently drop webhooks. This is a judgment call I document in DECISIONS.md.

## 4. Payload Signing Scheme

**What I asked:** Implement HMAC signing for webhook payloads with replay protection.

**What came back:** A Stripe-style `t=<timestamp>,v1=<hmac>` header with the signed payload being `{timestamp}.{body}`.

**What I kept/modified:** Kept as-is. This is a well-established pattern. The AI's implementation was clean and correct. I verified the HMAC uses SHA-256 and that the timestamp is unix seconds (not milliseconds). The `v1=` prefix for algorithm versioning was a nice touch that I hadn't explicitly asked for.

## 5. Worker Loop Design

**What I asked:** Build a delivery worker that polls for pending deliveries and processes them with backoff.

**What came back:** A `setTimeout`-based polling loop that queries for deliveries where `next_retry_at <= now`, processes them sequentially, and schedules retries with exponential backoff.

**What I modified:** The initial version used `setInterval`, which I changed to chained `setTimeout` calls. With `setInterval`, if a tick takes longer than the interval (e.g., slow HTTP request), ticks pile up. With `setTimeout`, the next tick only starts after the current one finishes, which is the correct behavior for a sequential worker. Also added the `in_progress` intermediate status so we can detect crashed deliveries (though I haven't added the recovery sweep yet — documented as incomplete).

## 6. Dashboard HTML Generation

**What I asked:** Create a server-rendered dashboard with subscription/event/delivery views.

**What came back:** Inline HTML template strings with embedded CSS, status badges, pagination, and a retry form.

**What I kept/modified:** Kept the overall approach (inline templates avoid a template engine dependency). The CSS was more elaborate than needed but clean enough to keep. I verified the XSS protection — all dynamic values pass through an `esc()` function that escapes `&`, `<`, `>`, `"`. One thing I rejected: the AI initially suggested using a template engine (EJS). I preferred inline strings since it's fewer dependencies and the templates are simple enough.

## 7. Express v5 Type Fixes

**What I asked:** Fix TypeScript errors where `req.params.id` returns `string | string[]` in Express v5.

**What came back:** Suggested using type assertions (`req.params.id as string`).

**What I rejected/modified:** Instead of scattering `as string` casts everywhere, I wrote a `param()` helper function that handles the array case properly (takes the first element). This is safer — if Express actually sends an array for some reason, we handle it instead of crashing with a type error at runtime.

## 8. Test Structure

**What I asked:** Write tests without an external test framework.

**What came back:** A self-contained test runner using Node's `assert` module with a simple `test()` wrapper function.

**What I kept/modified:** Kept the approach — it's dependency-free and covers the critical paths: subscription CRUD, filter matching (exact, wildcard, multi-pattern), event ingestion with delivery fan-out, retry reset, signing consistency, and persistence across db close/reopen. Fixed one test that failed because `closeDb()` didn't reset the module-level `db` variable, leaving it in a closed-but-not-null state.
