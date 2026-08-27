import { createHash } from "node:crypto";
import { z } from "zod";
import { InfraiRealtimeClient } from "./infrai_realtime.js";

export const onboardTenantSchema = z.object({
  tenantId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  adminUserId: z.string().min(1).max(80),
  accountState: z.enum(["active", "suspended"])
}).strict();

export type OnboardTenant = z.infer<typeof onboardTenantSchema>;

export class AccountAccessError extends Error {
  readonly status = 409;
  readonly code = "ACCOUNT_NOT_ACTIVE";
}

export interface RealtimeOperations {
  createChannel(input: { channel: string; type?: string; vendor?: string }, key: string): Promise<unknown>;
  publish(input: { channel: string; event?: string; data?: unknown; account_id?: string }, key: string): Promise<unknown>;
  issueToken(input: { client_id: string; channels?: string[]; capabilities?: string[]; ttl_seconds?: number }, key: string): Promise<unknown>;
}

function operationKey(tenantId: string, operation: string): string {
  return createHash("sha256").update(`${tenantId}:${operation}`).digest("hex");
}

export async function onboardTenantChat(
  realtime: RealtimeOperations,
  input: OnboardTenant
): Promise<{ tenantId: string; channel: string; accountState: "active"; realtimeToken: unknown }> {
  if (input.accountState !== "active") {
    throw new AccountAccessError("A suspended account cannot open a chat channel");
  }

  const channel = `tenant-${input.tenantId}-support`;
  await realtime.createChannel(
    { channel, type: "private" },
    operationKey(input.tenantId, "create-support-channel")
  );
  await realtime.publish(
    {
      channel,
      event: "account.onboarded",
      data: { tenantId: input.tenantId, accountState: input.accountState },
      account_id: input.tenantId
    },
    operationKey(input.tenantId, "publish-account-onboarded")
  );
  const realtimeToken = await realtime.issueToken(
    {
      client_id: input.adminUserId,
      channels: [channel],
      capabilities: ["subscribe", "publish"],
      ttl_seconds: 3600
    },
    operationKey(input.tenantId, `issue-token-${input.adminUserId}`)
  );

  return { tenantId: input.tenantId, channel, accountState: "active", realtimeToken };
}

export function realtimeFromEnvironment(): InfraiRealtimeClient {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  return new InfraiRealtimeClient(apiKey);
}
