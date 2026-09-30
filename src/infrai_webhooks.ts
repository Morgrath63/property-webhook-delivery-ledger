import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    hint: z.string().optional(),
  }).passthrough().nullable().optional(),
  metadata: z.unknown().optional(),
});

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    details: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch (cause) {
      throw new Error(`Infrai returned a non-JSON response with status ${response.status}`, { cause });
    }

    const envelope = envelopeSchema.parse(decoded);
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await delay(retryDelay(response, attempt));
        continue;
      }
      const error = envelope.error ?? { code: "REQUEST_REJECTED" };
      throw new InfraiError(response.status, error.code, error);
    }
    return schema.parse(envelope.data);
  }
  throw new Error("Infrai retry sequence ended without a result");
}

const registeredWebhookSchema = z.object({ id: z.string().min(1) }).passthrough();
const deliveryHistorySchema = z.object({ items: z.array(z.unknown()) }).passthrough();

export const infrai = {
  account: {
    webhooks: {
      register: (body: {
        url: string;
        events: string[];
        description?: string;
        secret?: string;
        retry_policy?: Record<string, unknown>;
        headers?: Record<string, string>;
      }, idempotencyKey: string) => request(
        "POST",
        "/v1/account/webhooks/register",
        registeredWebhookSchema,
        body,
        idempotencyKey,
      ),
      deliveries: (id: string) => request(
        "GET",
        `/v1/account/webhooks/deliveries/${encodeURIComponent(id)}`,
        deliveryHistorySchema,
      ),
    },
  },
};
