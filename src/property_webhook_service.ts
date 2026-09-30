import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PropertyEventLedger } from "./property_events.js";

const secret = process.env.INFRAI_WEBHOOK_SECRET;
if (!secret) throw new Error("Set INFRAI_WEBHOOK_SECRET before starting the receiver");

const ledger = new PropertyEventLedger();

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > 1_000_000) throw new RangeError("Request body exceeds 1 MB");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/webhooks/property-events") {
    send(response, 404, { accepted: false });
    return;
  }

  try {
    const rawBody = await readBody(request);
    const header = request.headers["x-infrai-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    const decision = ledger.accept(rawBody, signature, secret);
    if (!decision.accepted) {
      send(response, decision.reason === "signature" ? 401 : 400, decision);
      return;
    }
    send(response, 200, {
      accepted: true,
      action: decision.action,
      event_id: decision.event.event_id,
      event_type: decision.event.type,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      send(response, 413, { accepted: false, reason: "body" });
      return;
    }
    console.error(error);
    send(response, 500, { accepted: false });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Property webhook receiver listening on http://localhost:${port}`);
});
