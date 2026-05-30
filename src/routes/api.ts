import { Router, Request, Response } from "express";
import {
  createSubscription,
  listSubscriptions,
  getSubscription,
  deleteSubscription,
} from "../subscriptions";
import {
  ingestEvent,
  listEvents,
  getEvent,
  getDeliveriesForEvent,
  getDelivery,
  resetDeliveryForRetry,
  getDeliveriesForSubscription,
} from "../events";

const router = Router();

const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-key";

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0]! : v as string;
}

function authMiddleware(req: Request, res: Response, next: Function): void {
  const key = req.headers["x-admin-key"] || req.query.admin_key;
  if (key !== ADMIN_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(authMiddleware);

router.post("/subscriptions", (req: Request, res: Response) => {
  const { url, event_filter, secret } = req.body;
  if (!url || !event_filter) {
    res.status(400).json({ error: "url and event_filter are required" });
    return;
  }
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }
  const sub = createSubscription(url, event_filter, secret);
  res.status(201).json(sub);
});

router.get("/subscriptions", (_req: Request, res: Response) => {
  res.json(listSubscriptions());
});

router.get("/subscriptions/:id", (req: Request, res: Response) => {
  const sub = getSubscription(param(req, "id"));
  if (!sub) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(sub);
});

router.delete("/subscriptions/:id", (req: Request, res: Response) => {
  const ok = deleteSubscription(param(req, "id"));
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ deleted: true });
});

router.get("/subscriptions/:id/deliveries", (req: Request, res: Response) => {
  const id = param(req, "id");
  const sub = getSubscription(id);
  if (!sub) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  res.json(getDeliveriesForSubscription(id));
});

router.post("/events", (req: Request, res: Response) => {
  const { event_type, payload } = req.body;
  if (!event_type || !payload) {
    res.status(400).json({ error: "event_type and payload are required" });
    return;
  }
  const result = ingestEvent(event_type, payload);
  res.status(201).json(result);
});

router.get("/events", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  res.json(listEvents(limit, offset));
});

router.get("/events/:id", (req: Request, res: Response) => {
  const event = getEvent(param(req, "id"));
  if (!event) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(event);
});

router.get("/events/:id/deliveries", (req: Request, res: Response) => {
  const id = param(req, "id");
  const event = getEvent(id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(getDeliveriesForEvent(id));
});

router.post("/deliveries/:id/retry", (req: Request, res: Response) => {
  const id = param(req, "id");
  const ok = resetDeliveryForRetry(id);
  if (!ok) {
    res.status(404).json({ error: "Delivery not found or not in a retryable state" });
    return;
  }
  const delivery = getDelivery(id);
  res.json(delivery);
});

export default router;
