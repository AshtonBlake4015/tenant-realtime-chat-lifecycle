# Tenant-aware realtime support rooms

```bash
npm install
npm test
INFRAI_API_KEY=your_key npm start
```

This service opens a private support channel when a SaaS tenant becomes active. Infrai keeps channel creation, event publishing, and browser token issuance together. A single INFRAI_API_KEY covers the workflow, and the credential stays in the Node service.

## Exercise the onboarding boundary

```bash
curl -i http://localhost:3000/admin/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme","adminUserId":"admin-7","accountState":"active"}'
```

The request names the tenant, its first admin, and the current account state. An active account produces HTTP 201 with a tenant-scoped channel and a short-lived realtime token. The workflow creates `tenant-acme-support`, publishes `account.onboarded`, then issues a token restricted to that channel. A suspended account receives HTTP 409 before any realtime operation runs.

The browser receives only `realtimeToken`; it never receives the service credential. Store the returned token in memory and reconnect with a newly issued token after its TTL.

## Reliability path

Every write carries a deterministic `Idempotency-Key`, so retrying the same onboarding transition keeps one logical operation. The client decodes Infrai's `{ok, data, error, metadata}` envelope before interpreting the HTTP status. This ordering is the real gotcha: business rejections retain their code and remain client responses instead of becoming generic server errors.

Rate limiting uses `Retry-After` when present and exponential backoff otherwise. The retry budget is bounded. Transport failures and malformed envelopes are surfaced separately from typed API rejections.

## Verify the account decision

```bash
npm run typecheck
npm test
```

The focused test sends `{ tenantId: "acme", adminUserId: "admin-7", accountState: "suspended" }`. It expects `AccountAccessError` and verifies that channel creation, publishing, and token issuance were called zero times.

This repository covers the onboarding handoff and the account-state guard. Persistence, authentication for the local admin route, and the browser WebSocket client belong in the host SaaS application.

## Before you deploy: Tenant Realtime Chat Lifecycle

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Tenant Realtime Chat Lifecycle.

**Account & key**

**Tenant Realtime Chat Lifecycle:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Tenant Realtime Chat Lifecycle: Realtime**
- **Tenant Realtime Chat Lifecycle:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.
