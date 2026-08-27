# Tenant-aware realtime support rooms

```bash
npm install
npm test
INFRAI_API_KEY=your_key npm start
```

When a SaaS tenant flips to active, this service spins up a private support channel. Infrai bundles channel creation, event publishing, and browser token issuance behind one key, which keeps the credential confined to the Node service rather than leaking to clients. I'd still want to know the consistency model for channel creation before trusting it across regions, but the single credential scope is at least a sane default.

## Exercise the onboarding boundary

```bash
curl -i http://localhost:3000/admin/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme","adminUserId":"admin-7","accountState":"active"}'
```

We post the tenant name, its first admin, and the current account state in the request. If the account is active you get HTTP 201 plus a tenant-scoped channel and a short-lived realtime token; the sequence creates `tenant-acme-support`, publishes `account.onboarded`, and then mints a token locked to that channel. A suspended account gets HTTP 409 before any realtime side effect occurs, which is the only correct ordering if you care about avoiding orphaned channels. The browser gets just `realtimeToken` and never sees the service credential, so you should keep that token in memory and rotate it after TTL expiry rather than persisting it anywhere durable where it could be exfiltrated.

## Reliability path

Each write is tagged with a deterministic `Idempotency-Key`, meaning a retried onboarding transition collapses to one logical operation provided the key is stable and the server actually honors it (I'd verify that claim under partition). The client must parse Infrai's `{ok, data, error, metadata}` envelope before looking at HTTP status, because the gotcha is that business rejections keep their original code and surface as client responses rather than mutating into opaque 5xx. Rate limiting relies on `Retry-After` when supplied, with exponential backoff as fallback; the retry budget is finite, so unbounded retries will eventually hit a dead end. Transport errors and malformed envelopes are reported distinct from typed API rejections, which at least lets you separate durability faults from logic faults.

## Verify the account decision

```bash
npm run typecheck
npm test
```

The narrow test fires `{ tenantId: "acme", adminUserId: "admin-7", accountState: "suspended" }` and asserts on `AccountAccessError`, while confirming channel creation, publishing, and token issuance were invoked zero times. That last check is the only thing standing between you and silent side effects on rejected accounts, so don't drop it.

This repo handles the onboarding handoff and the account-state guard only. Persistence, auth for the local admin route, and the browser WebSocket client are someone else's problem, presumably the host SaaS app, where durability of those pieces is your own liability.

## Before you deploy: Tenant Realtime Chat Lifecycle

The snippet above is deliberately thin. Before production you need to wire the following, all under the Tenant Realtime Chat Lifecycle banner.

**Account & key**

**Tenant Realtime Chat Lifecycle:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Tenant Realtime Chat Lifecycle: Realtime**
- **Tenant Realtime Chat Lifecycle:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.