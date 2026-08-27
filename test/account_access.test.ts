import assert from "node:assert/strict";
import test from "node:test";
import { AccountAccessError, onboardTenantChat, type RealtimeOperations } from "../src/tenant_chat_lifecycle.js";

test("a suspended tenant is rejected before realtime resources are changed", async () => {
  let calls = 0;
  const realtime: RealtimeOperations = {
    async createChannel() { calls += 1; },
    async publish() { calls += 1; },
    async issueToken() { calls += 1; return { token: "test-token" }; }
  };

  await assert.rejects(
    onboardTenantChat(realtime, {
      tenantId: "acme",
      adminUserId: "admin-7",
      accountState: "suspended"
    }),
    AccountAccessError
  );
  assert.equal(calls, 0);
});
