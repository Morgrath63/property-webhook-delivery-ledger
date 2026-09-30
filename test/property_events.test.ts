import assert from "node:assert/strict";
import test from "node:test";
import { PropertyEventLedger, signBody } from "../src/property_events.js";

test("a signed maintenance retry is acknowledged without applying the event twice", () => {
  const body = Buffer.from(JSON.stringify({
    event_id: "evt-maintenance-1042",
    type: "maintenance.request.updated",
    occurred_at: "2026-09-28T08:00:00.000Z",
    property_id: "building-7",
    request_id: "request-1042",
    status: "scheduled",
  }));
  const secret = "test-signing-secret";
  const signature = signBody(body, secret);
  const ledger = new PropertyEventLedger();

  assert.deepEqual(ledger.accept(body, signature, secret), {
    accepted: true,
    action: "recorded",
    event: JSON.parse(body.toString("utf8")),
  });
  assert.equal(ledger.accept(body, signature, secret).action, "duplicate");
});

test("an unsigned tenant document event is rejected before parsing", () => {
  const ledger = new PropertyEventLedger();
  const result = ledger.accept(Buffer.from("not-json"), undefined, "test-signing-secret");
  assert.deepEqual(result, { accepted: false, action: "reject", reason: "signature" });
});
