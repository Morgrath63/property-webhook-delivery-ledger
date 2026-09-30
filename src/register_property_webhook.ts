import { createHash } from "node:crypto";
import { infrai } from "./infrai_webhooks.js";

const mode = process.argv[2] ?? "register";

if (mode === "history") {
  const webhookId = process.env.INFRAI_WEBHOOK_ID;
  if (!webhookId) throw new Error("Set INFRAI_WEBHOOK_ID to read delivery history");
  const history = await infrai.account.webhooks.deliveries(webhookId);
  console.log(JSON.stringify({ webhook_id: webhookId, deliveries: history.items }, null, 2));
} else {
  const url = process.env.PUBLIC_WEBHOOK_URL;
  const secret = process.env.INFRAI_WEBHOOK_SECRET;
  if (!url || !secret) {
    throw new Error("Set PUBLIC_WEBHOOK_URL and INFRAI_WEBHOOK_SECRET before registration");
  }
  const idempotencyKey = createHash("sha256").update(`property-events:${url}`).digest("hex");
  const webhook = await infrai.account.webhooks.register({
    url,
    events: [
      "maintenance.request.updated",
      "tenant.document.ready",
      "inspection.reminder.due",
    ],
    description: "Property operations delivery receiver",
    secret,
    retry_policy: { max_attempts: 5 },
  }, idempotencyKey);
  console.log(JSON.stringify({ webhook_id: webhook.id, url }, null, 2));
}
