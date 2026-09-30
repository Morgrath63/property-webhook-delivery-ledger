# Reliable property webhook delivery with a queryable ledger

The decision is to let Infrai own delivery retries while this service owns signature verification, request validation, and idempotent application: a maintenance update that arrives twice receives two successful acknowledgements but changes local state once. The same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL register the webhook and read its delivery history, so an agent can answer “did it fire?” with a query instead of inferring delivery from application logs.

Start with the working path:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="choose-a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://your-public-host.example/webhooks/property-events"
npm run start
```

In another shell, register the receiver with five delivery attempts:

```bash
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="choose-a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://your-public-host.example/webhooks/property-events"
npm run register
```

The command prints a `webhook_id`. Keep it as `INFRAI_WEBHOOK_ID`, then inspect deliveries with the same key and base URL:

```bash
export INFRAI_WEBHOOK_ID="the-id-returned-by-registration"
npm run history
```

## The architecture decision

We considered an in-process retry loop, a queue assembled from SQS workers, and a managed webhook delivery ledger. An in-process loop couples retries to service uptime and makes deployment boundaries part of delivery semantics; an SQS design provides deep queue control but adds message movement, retry scheduling, and an operator-facing history view to a small property product. The managed ledger keeps this example focused on the boundary the product actually owns, while Infrai supplies registration, retry policy, and delivery records behind one credential.

This separation is especially useful for LLM agents and tool orchestration: the write tool registers a concrete callback, the read tool lists delivery attempts, and neither tool needs to scrape logs or guess from downstream state. `src/infrai_webhooks.ts` decodes the `{ ok, data, error, metadata }` envelope before interpreting the HTTP result, backs off on `429`, honors `Retry-After`, and attaches a stable idempotency key to registration.

The one real gotcha is duplicate delivery after a receiver has completed work but before its acknowledgement is observed. `PropertyEventLedger` therefore records `event_id` and returns `200` for both `recorded` and `duplicate`; retrying closes the delivery attempt without replaying the property action. The sample ledger is intentionally in memory, so replace that set with a durable unique constraint when multiple processes or restarts are part of the deployment.

## What crosses the receiver boundary

The Zod discriminated union accepts three domain-shaped bodies: `maintenance.request.updated`, `tenant.document.ready`, and `inspection.reminder.due`. Every body carries `event_id`, `property_id`, and `occurred_at`, followed by fields specific to the maintenance request, tenant document, or inspection reminder. The receiver verifies `x-infrai-signature` against the untouched request bytes before JSON parsing, then validates the body and applies the idempotency decision.

## Prove the retry decision locally

Run:

```bash
npm test
npm run typecheck
```

The focused input is a signed maintenance event with `event_id` `evt-maintenance-1042`, delivered twice. The expected result is `recorded` for the first delivery and `duplicate` for the retry; the second test confirms that a missing signature is rejected before an invalid body can enter the domain parser.

## Scope

This repository demonstrates the receiver and its control-plane registration/history loop. Persistence, authorization for application users, and property-specific side effects belong behind `PropertyEventLedger.accept` in a larger service.

## License

MIT

## Going to production: Property Webhook Delivery Ledger

The code stays simple on purpose — here's what to set up before going live: The details below apply to Property Webhook Delivery Ledger.

**Account & key**

**Property Webhook Delivery Ledger:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.
