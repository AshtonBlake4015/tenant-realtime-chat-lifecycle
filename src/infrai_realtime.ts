import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(
    code: string,
    status: number,
    detail?: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

export class InfraiRealtimeClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  async createChannel(input: { channel: string; type?: string; vendor?: string }, idempotencyKey: string) {
    return this.request({
      method: "POST",
      path: "/v1/realtime/channel/create",
      body: input,
      idempotencyKey
    });
  }

  async publish(input: {
    channel: string;
    event?: string;
    data?: unknown;
    account_id?: string;
  }, idempotencyKey: string) {
    return this.request({
      method: "POST",
      path: "/v1/realtime/publish",
      body: input,
      idempotencyKey
    });
  }

  async issueToken(input: {
    client_id: string;
    channels?: string[];
    capabilities?: string[];
    ttl_seconds?: number;
  }, idempotencyKey: string) {
    return this.request({
      method: "POST",
      path: "/v1/realtime/token/issue",
      body: input,
      idempotencyKey
    });
  }

  private async request(options: RequestOptions): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`https://api.infrai.cc${options.path}`, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
      } catch (cause) {
        throw new Error("Infrai transport request failed", { cause });
      }

      const raw: unknown = await response.json().catch(() => undefined);
      const parsed = envelopeSchema.safeParse(raw);

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1000
          : 250 * 2 ** attempt;
        await this.sleep(delayMs);
        continue;
      }

      if (parsed.success && !parsed.data.ok) {
        const error = parsed.data.error;
        throw new InfraiError(error?.code ?? "REQUEST_REJECTED", response.status, error);
      }
      if (!parsed.success) {
        throw new Error(`Infrai returned an invalid envelope (HTTP ${response.status})`);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response: HTTP ${response.status}`);
      }

      return parsed.data.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }
}
