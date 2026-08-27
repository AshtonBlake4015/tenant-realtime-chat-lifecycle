import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError } from "./infrai_realtime.js";
import {
  AccountAccessError,
  onboardTenantChat,
  onboardTenantSchema,
  realtimeFromEnvironment
} from "./tenant_chat_lifecycle.js";

const realtime = realtimeFromEnvironment();

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/admin/tenants/onboard") {
    send(response, 404, { error: { code: "ROUTE_NOT_FOUND" } });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 16_384) {
        send(response, 413, { error: { code: "BODY_TOO_LARGE" } });
        return;
      }
      chunks.push(buffer);
    }
    const input = onboardTenantSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await onboardTenantChat(realtime, input);
    send(response, 201, result);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: { code: "INVALID_REQUEST" } });
    } else if (error instanceof AccountAccessError) {
      send(response, error.status, { error: { code: error.code, message: error.message } });
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: { code: error.code, message: error.message } });
    } else {
      send(response, 502, { error: { code: "UPSTREAM_REQUEST_FAILED" } });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`chat admin service listening on http://localhost:${port}`));
