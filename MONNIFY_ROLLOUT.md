# Monnify migration — rollout runbook

Replaces Paystack with Monnify behind a gateway-neutral abstraction. New
payments go through **Monnify**; Paystack stays as a **legacy adapter** that
still verifies + processes webhooks for historical/in-flight references. A
future gateway swap = one new adapter class + a `PAYMENT_GATEWAY` change.

**Do the steps in order.** Several are money-safety gates, not suggestions.

---

## 1. Dev database — run migration 1930 BEFORE booting the new code

Migration `1930000000000-RenamePaystackColumnsToGatewayNeutral` renames the
Paystack-branded columns and adds a `gateway` discriminator.

⚠️ **Ordering hazard:** dev boot calls `dataSource.synchronize()`
(`database.service.ts`), which diffs a column rename as DROP+ADD and *swallows*
the failure ("Continuing in development mode"). Booting the renamed entities
**before** running 1930 can silently destroy column data on the shared dev
Neon DB.

```bash
# dev
npm run migration:run          # applies 1930 (and any other pending dev migrations)
# THEN start the app
```

Sanity-check the backfill:

```sql
SELECT gateway, count(*) FROM payments GROUP BY 1;          -- all existing → 'paystack'
SELECT payment_gateway, count(*) FROM ad_hoc_invoices GROUP BY 1;
```

## 2. Production database — do NOT `npm run migration:run`

Prod migrations are **applied manually** (the migrations table is hand-managed;
there is a held 1914–1928 backlog with order-sensitive, risky entries — e.g.
1917 nulls branding that 1923 repoints, and two files share timestamp
1917000000000). `migration:run` would execute that entire queue.

```sql
-- 1. See what prod has actually recorded
SELECT name FROM migrations ORDER BY id;
```

Diff against `src/migrations/`. Then apply **only** 1930's SQL by hand
(mirroring the procedure used for 1929) and insert its bookkeeping row:

```sql
-- 2. Apply 1930's up() SQL manually (renames + gateway columns + backfill +
--    index/constraint renames). Copy the statements from
--    src/migrations/1930000000000-RenamePaystackColumnsToGatewayNeutral.ts
-- 3. Record it so a future migration:run skips it
INSERT INTO migrations (timestamp, name)
VALUES (1930000000000, 'RenamePaystackColumnsToGatewayNeutral1930000000000');
```

## 3. Monnify account + credentials

Create an account at https://app.monnify.com. From Developers → API Keys, get
`apiKey`, `secretKey`, `contractCode`. Add to the backend `.env` (never commit;
see `.env.example` for the full key list):

```
PAYMENT_GATEWAY=monnify
MONNIFY_API_KEY=...
MONNIFY_SECRET_KEY=...
MONNIFY_CONTRACT_CODE=...
MONNIFY_BASE_URL=https://sandbox.monnify.com   # https://api.monnify.com for live
```

Keep `PAYSTACK_SECRET_KEY` in place (see step 7).

## 4. Monnify dashboard — webhook + settings

- **Transaction Completion webhook URL** → `https://<api-host>/webhooks/monnify`
- **Verify the reject-over/under-payments setting** is on (Monnify's default).
  This is NOT merely defense-in-depth — it decides which code path can ever run
  (confirmed against sandbox 2026-07-15):
  - **Reject (default):** Monnify bounces the transfer and refunds the payer.
    The transaction stays `PENDING` with `amountPaid 0.00` — **`verifyPayment`
    can never see the rejection.** The `REJECTED_PAYMENT` webhook is the ONLY
    signal in existence, so webhook delivery is load-bearing, not a backup.
    `PARTIALLY_PAID`/`OVERPAID` never occur, so the `payment.amount_mismatch`
    path stays dormant.
  - **Accept over/under payment** (dashboard → Settings → Contracts Setup):
    `PARTIALLY_PAID`/`OVERPAID` become real statuses that verify CAN see, and
    the `payment.amount_mismatch` artifact fires. Money then sits unmatched in
    our books awaiting manual reconciliation — which is why we keep the default.
- **Sandbox delivers webhooks UNSIGNED** — confirmed 2026-07-15; the docs state
  the `monnify-signature` header is production-only. Set
  `MONNIFY_ALLOW_UNSIGNED_WEBHOOKS=true` in sandbox or every sandbox webhook is
  401'd and silently discarded. **Never in prod.**
- ⚠️ **UNRESOLVED — the production signature algorithm is a coin-flip.** Monnify's
  webhook docs contradict themselves: the formula says
  `SHA-512(client secret key + object of request body)` (a plain hash of a
  concatenation) while the security note on the same page says HMAC-SHA512 of
  the body keyed with the secret. We implement HMAC. Sandbox **cannot** test
  this — it sends no signature at all — so this path first executes in
  production, where being wrong 401s every payment webhook. Before the flip,
  make `verifyWebhookSignature` accept EITHER digest (both require the secret,
  so accepting either costs nothing in security), and/or get written
  confirmation from Monnify support.

## 5. Deploy order (backend and frontend deploy separately)

The init API is **expand-not-flip**: responses now carry `reference` +
`checkoutUrl` alongside the legacy `accessCode`/`authorizationUrl` (populated
only while the active gateway is Paystack). This makes the deploy order safe:

1. **Deploy backend** (Stages 1–4). Still Paystack-active if `PAYMENT_GATEWAY`
   is unset — the code fallback is deliberately `paystack`.
2. **Deploy frontend** (Stage 5 — hosted-redirect checkout). Works against
   either gateway because it reads `checkoutUrl`.
3. **Verify one live checkout end-to-end still on Paystack** through the new
   redirect flow.
4. **Only then set `PAYMENT_GATEWAY=monnify`** and restart the backend. Monnify
   inits carry no `accessCode`, so flipping before the redirect frontend is
   live would break the old popup frontend.

## 6. Sandbox smoke test (one payment per lane × card + bank transfer)

Offer letter · renewal · installment · payoff · ad-hoc. For each, confirm:

- redirect → hosted checkout → redirect back → page verifies and shows success;
- the webhook lands and is idempotent against the redirect-return verify
  (existing CAS / payment_history / row-lock dedupe covers Monnify's retries);
- an abandoned checkout is handled by the 30-min expiry cron without failing a
  still-live checkout (Monnify PENDING → EXPIRED after ~40 min);
- ~~capture Monnify's actual duplicate-reference `responseCode`~~ **DONE
  2026-07-15 — `responseCode` cannot discriminate: it is `"99"` for every
  error.** The real signal is HTTP status, which the adapter already keys on:
  | case | HTTP | responseCode | responseMessage |
  |---|---|---|---|
  | not found | `404` | `99` | `Could not find transaction with payment reference X for merchant` |
  | duplicate init | `422` | `99` | `Duplicate payment reference` |
  Do not spend time hunting for a specific code — there isn't one.
- force an underpayment and confirm the **`bank_transfer_rejected`** artifact
  appears (NOT `payment_amount_mismatch` — on the default reject contract the
  money is refunded by Monnify and never reaches us; see §4). Requires the
  unsigned-webhook flag in sandbox, or the rejection is 401'd and lost.

## 7. Grace period, then retire Paystack (later PR)

Keep `PAYSTACK_SECRET_KEY` in prod for ~30 days after the flip so in-flight
Paystack references and webhook retries keep resolving. After Stage 2, its
absence degrades Paystack calls to a 503 (`Paystack gateway not configured`)
instead of blocking boot — it is an operational grace period, not a boot
requirement.

Legacy-retire PR (once the Paystack lane is quiet):

- drop the deprecated init-response fields (`accessCode`, `authorizationUrl`,
  `paystackReference`) and the `paystackReference` read-DTO alias;
- rename `PaystackLogger` → a gateway-neutral name (its log file is already
  `payments-*.log`);
- optionally remove `PaystackGateway` + `PaystackService` + the Paystack env
  keys entirely;
- flip the registry code fallback from `paystack` to `monnify`.
