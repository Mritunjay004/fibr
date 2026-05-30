import { Router, Request, Response } from "express";
import {
  listSubscriptions,
  getSubscription,
} from "../subscriptions";
import {
  listEvents,
  getEvent,
  getDeliveriesForEvent,
  getDeliveriesForSubscription,
  countEvents,
} from "../events";
import { getDb } from "../db";

const router = Router();

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0]! : v as string;
}

function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Fibr Webhooks</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
    nav { background: #1a1a2e; padding: 12px 0; margin-bottom: 24px; }
    nav .container { display: flex; gap: 24px; align-items: center; }
    nav a { color: #e0e0e0; text-decoration: none; font-weight: 500; }
    nav a:hover { color: #fff; }
    nav .brand { color: #fff; font-size: 1.2em; font-weight: 700; }
    h1 { margin-bottom: 16px; font-size: 1.5em; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; font-size: 0.9em; }
    th { background: #f8f9fa; font-weight: 600; }
    td { word-break: break-all; }
    a { color: #0066cc; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: 600; }
    .badge-delivered { background: #d4edda; color: #155724; }
    .badge-pending { background: #fff3cd; color: #856404; }
    .badge-failed, .badge-exhausted { background: #f8d7da; color: #721c24; }
    .badge-in_progress { background: #cce5ff; color: #004085; }
    .badge-cancelled { background: #e2e3e5; color: #383d41; }
    .stats { display: flex; gap: 16px; margin-bottom: 20px; }
    .stat-card { background: #fff; padding: 16px 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-card .num { font-size: 1.8em; font-weight: 700; }
    .stat-card .label { color: #666; font-size: 0.85em; }
    .btn { display: inline-block; padding: 4px 12px; background: #0066cc; color: #fff; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; font-size: 0.85em; }
    .btn:hover { background: #0052a3; }
    .detail { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .detail dt { font-weight: 600; margin-top: 8px; }
    .detail dd { margin-left: 0; margin-bottom: 4px; color: #555; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; }
    .pagination { margin-top: 16px; display: flex; gap: 8px; }
  </style>
</head>
<body>
  <nav><div class="container">
    <span class="brand">Fibr</span>
    <a href="/dashboard">Overview</a>
    <a href="/dashboard/subscriptions">Subscriptions</a>
    <a href="/dashboard/events">Events</a>
  </div></nav>
  <div class="container">${content}</div>
</body>
</html>`;
}

function statusBadge(status: string): string {
  return `<span class="badge badge-${status}">${status}</span>`;
}

router.get("/", (_req: Request, res: Response) => {
  const db = getDb();
  const eventCount = countEvents();
  const subCount = (db.prepare(`SELECT COUNT(*) as cnt FROM subscriptions WHERE active = 1`).get() as any).cnt;
  const deliveredCount = (db.prepare(`SELECT COUNT(*) as cnt FROM delivery_attempts WHERE status = 'delivered'`).get() as any).cnt;
  const failedCount = (db.prepare(`SELECT COUNT(*) as cnt FROM delivery_attempts WHERE status IN ('failed','exhausted')`).get() as any).cnt;
  const pendingCount = (db.prepare(`SELECT COUNT(*) as cnt FROM delivery_attempts WHERE status = 'pending'`).get() as any).cnt;

  const content = `
    <h1>Dashboard</h1>
    <div class="stats">
      <div class="stat-card"><div class="num">${subCount}</div><div class="label">Active Subscriptions</div></div>
      <div class="stat-card"><div class="num">${eventCount}</div><div class="label">Total Events</div></div>
      <div class="stat-card"><div class="num">${deliveredCount}</div><div class="label">Delivered</div></div>
      <div class="stat-card"><div class="num">${pendingCount}</div><div class="label">Pending</div></div>
      <div class="stat-card"><div class="num">${failedCount}</div><div class="label">Failed</div></div>
    </div>
    <h2 style="margin-bottom:12px">Recent Events</h2>
    <table>
      <tr><th>Event Type</th><th>Event ID</th><th>Received</th></tr>
      ${listEvents(10, 0).map(e => `<tr>
        <td>${esc(e.event_type)}</td>
        <td><a href="/dashboard/events/${esc(e.id)}">${esc(e.id.slice(0, 8))}…</a></td>
        <td>${esc(e.received_at)}</td>
      </tr>`).join("")}
    </table>`;

  res.send(layout("Overview", content));
});

router.get("/subscriptions", (_req: Request, res: Response) => {
  const subs = listSubscriptions();
  const content = `
    <h1>Subscriptions</h1>
    <table>
      <tr><th>ID</th><th>URL</th><th>Filter</th><th>Active</th><th>Created</th></tr>
      ${subs.map(s => `<tr>
        <td><a href="/dashboard/subscriptions/${esc(s.id)}">${esc(s.id.slice(0, 8))}…</a></td>
        <td>${esc(s.url)}</td>
        <td>${esc(s.event_filter)}</td>
        <td>${s.active ? "Yes" : "No"}</td>
        <td>${esc(s.created_at)}</td>
      </tr>`).join("")}
    </table>`;
  res.send(layout("Subscriptions", content));
});

router.get("/subscriptions/:id", (req: Request, res: Response) => {
  const sub = getSubscription(param(req, "id"));
  if (!sub) { res.status(404).send(layout("Not Found", "<h1>Subscription not found</h1>")); return; }
  const deliveries = getDeliveriesForSubscription(sub.id);
  const content = `
    <h1>Subscription ${esc(sub.id.slice(0, 8))}…</h1>
    <div class="detail">
      <dl>
        <dt>ID</dt><dd>${esc(sub.id)}</dd>
        <dt>URL</dt><dd>${esc(sub.url)}</dd>
        <dt>Filter</dt><dd>${esc(sub.event_filter)}</dd>
        <dt>Secret</dt><dd>${sub.secret ? "••••••" : "None"}</dd>
        <dt>Active</dt><dd>${sub.active ? "Yes" : "No"}</dd>
        <dt>Created</dt><dd>${esc(sub.created_at)}</dd>
      </dl>
    </div>
    <h2 style="margin-bottom:12px">Delivery Attempts</h2>
    <table>
      <tr><th>Delivery ID</th><th>Event</th><th>Status</th><th>Attempts</th><th>Last Error</th><th>Updated</th></tr>
      ${deliveries.map(d => `<tr>
        <td><a href="/dashboard/events/${esc(d.event_id)}">${esc(d.id.slice(0, 8))}…</a></td>
        <td><a href="/dashboard/events/${esc(d.event_id)}">${esc(d.event_id.slice(0, 8))}…</a></td>
        <td>${statusBadge(d.status)}</td>
        <td>${d.attempt_number}/${d.max_attempts}</td>
        <td>${esc(d.last_error || "-")}</td>
        <td>${esc(d.updated_at)}</td>
      </tr>`).join("")}
    </table>`;
  res.send(layout("Subscription Detail", content));
});

router.get("/events", (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = 30;
  const offset = (page - 1) * limit;
  const events = listEvents(limit, offset);
  const total = countEvents();
  const totalPages = Math.ceil(total / limit);

  const content = `
    <h1>Events (${total} total)</h1>
    <table>
      <tr><th>Event Type</th><th>Event ID</th><th>Received</th></tr>
      ${events.map(e => `<tr>
        <td>${esc(e.event_type)}</td>
        <td><a href="/dashboard/events/${esc(e.id)}">${esc(e.id.slice(0, 8))}…</a></td>
        <td>${esc(e.received_at)}</td>
      </tr>`).join("")}
    </table>
    <div class="pagination">
      ${page > 1 ? `<a class="btn" href="?page=${page - 1}">← Prev</a>` : ""}
      <span>Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a class="btn" href="?page=${page + 1}">Next →</a>` : ""}
    </div>`;
  res.send(layout("Events", content));
});

router.get("/events/:id", (req: Request, res: Response) => {
  const event = getEvent(param(req, "id"));
  if (!event) { res.status(404).send(layout("Not Found", "<h1>Event not found</h1>")); return; }
  const deliveries = getDeliveriesForEvent(event.id);

  let prettyPayload: string;
  try {
    prettyPayload = JSON.stringify(JSON.parse(event.payload), null, 2);
  } catch {
    prettyPayload = event.payload;
  }

  const content = `
    <h1>Event ${esc(event.id.slice(0, 8))}…</h1>
    <div class="detail">
      <dl>
        <dt>ID</dt><dd>${esc(event.id)}</dd>
        <dt>Type</dt><dd>${esc(event.event_type)}</dd>
        <dt>Received</dt><dd>${esc(event.received_at)}</dd>
      </dl>
      <dt style="margin-top:12px;font-weight:600">Payload</dt>
      <pre>${esc(prettyPayload)}</pre>
    </div>
    <h2 style="margin-bottom:12px">Delivery Attempts</h2>
    <table>
      <tr><th>Delivery ID</th><th>Subscription</th><th>Status</th><th>Attempts</th><th>HTTP</th><th>Error</th><th>Next Retry</th><th>Action</th></tr>
      ${deliveries.map(d => `<tr>
        <td>${esc(d.id.slice(0, 8))}…</td>
        <td><a href="/dashboard/subscriptions/${esc(d.subscription_id)}">${esc(d.subscription_id.slice(0, 8))}…</a></td>
        <td>${statusBadge(d.status)}</td>
        <td>${d.attempt_number}/${d.max_attempts}</td>
        <td>${d.last_status_code || "-"}</td>
        <td>${esc(d.last_error || "-")}</td>
        <td>${esc(d.next_retry_at || "-")}</td>
        <td>${(d.status === "failed" || d.status === "exhausted") ? `<form method="POST" action="/dashboard/deliveries/${esc(d.id)}/retry" style="display:inline"><button class="btn" type="submit">Retry</button></form>` : ""}</td>
      </tr>`).join("")}
    </table>`;
  res.send(layout("Event Detail", content));
});

router.post("/deliveries/:id/retry", (req: Request, res: Response) => {
  const { resetDeliveryForRetry, getDelivery } = require("../events");
  const delivery = getDelivery(param(req, "id"));
  if (!delivery) { res.status(404).send("Not found"); return; }
  resetDeliveryForRetry(param(req, "id"));
  res.redirect(`/dashboard/events/${delivery.event_id}`);
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default router;
