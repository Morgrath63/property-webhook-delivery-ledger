import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const common = {
  event_id: z.string().min(1),
  property_id: z.string().min(1),
  occurred_at: z.string().datetime(),
};

export const propertyEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...common,
    type: z.literal("maintenance.request.updated"),
    request_id: z.string().min(1),
    status: z.enum(["reported", "scheduled", "completed"]),
  }),
  z.object({
    ...common,
    type: z.literal("tenant.document.ready"),
    tenant_id: z.string().min(1),
    document_id: z.string().min(1),
    document_kind: z.enum(["lease", "notice", "receipt"]),
  }),
  z.object({
    ...common,
    type: z.literal("inspection.reminder.due"),
    inspection_id: z.string().min(1),
    due_at: z.string().datetime(),
  }),
]);

export type PropertyEvent = z.infer<typeof propertyEventSchema>;

export type DeliveryDecision =
  | { accepted: true; action: "recorded"; event: PropertyEvent }
  | { accepted: true; action: "duplicate"; event: PropertyEvent }
  | { accepted: false; action: "reject"; reason: "signature" | "body" };

export class PropertyEventLedger {
  private readonly seen = new Set<string>();

  accept(rawBody: Buffer, signature: string | undefined, secret: string): DeliveryDecision {
    if (!verifySignature(rawBody, signature, secret)) {
      return { accepted: false, action: "reject", reason: "signature" };
    }

    let input: unknown;
    try {
      input = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { accepted: false, action: "reject", reason: "body" };
    }
    const parsed = propertyEventSchema.safeParse(input);
    if (!parsed.success) return { accepted: false, action: "reject", reason: "body" };

    if (this.seen.has(parsed.data.event_id)) {
      return { accepted: true, action: "duplicate", event: parsed.data };
    }
    this.seen.add(parsed.data.event_id);
    return { accepted: true, action: "recorded", event: parsed.data };
  }
}

export function signBody(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifySignature(rawBody: Buffer, supplied: string | undefined, secret: string): boolean {
  if (!supplied) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
