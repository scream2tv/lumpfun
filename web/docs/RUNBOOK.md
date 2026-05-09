# LumpFun Operator Runbook

Day-to-day operational reference for running and debugging the LumpFun web app + queue path. Repo-grounded — every claim cites a file path. When in doubt, **`/api/health` is the first thing to hit**.

---

## 1. First five things to check when something's wrong

Before deep-diving, run these in order. Three minutes total. They catch ~90% of failures.

```bash
# 1. Server config + Blockfrost reachability — single-shot probe
curl -s http://localhost:3000/api/health | jq

# 2. Treasury wallet derivation matches NEXT_PUBLIC_TREASURY_ADDRESS
curl -s http://localhost:3000/api/treasury/whoami | jq '{network, ada, addressesMatch}'

# 3. Token registry is non-empty + tokens are non-graduated
curl -s http://localhost:3000/api/tokens | jq '[.[] | select(.graduatedTxHash == null) | {ticker, policyId: .policyId[0:10]}]'

# 4. Order book has the orders you think it has
curl -s "http://localhost:3000/api/order-book-utxos?address=$(node -e "import('@lucid-evolution/lucid').then(({applyDoubleCborEncoding,validatorToAddress})=>console.log(validatorToAddress('Preprod',{type:'PlutusV3',script:applyDoubleCborEncoding('59010601010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cc01c0092225980099b8748008c01cdd500144c8cc8a60022b30013001300a375400513259800980118059baa0078a51899198008009bac300f30103010301030103010301030103010300d375400c44b30010018a508acc004cdc79bae3010001375c6020601c6ea800e29462660040046022002806100f2014300d300b3754005164025300a375400d300d003488966002600800515980098071baa009801c5900f456600266e1d20020028acc004c038dd5004c00e2c807a2c806100c0c02cc030004dc3a400060106ea800a2c8030600e00260066ea801e29344d9590011')}))")" | jq 'length'

# 5. Wallets harness sees the chain (preprod only)
cd web && npm run preprod -- status
```

| Probe | Healthy result | If wrong → see |
|---|---|---|
| `/api/health` | `"ok": true` | §2 (env) |
| `whoami.addressesMatch` | `true` | §2 (env) — `TREASURY_SEED` and `NEXT_PUBLIC_TREASURY_ADDRESS` disagree |
| `/api/tokens` | array with at least one non-graduated entry | registry empty / mismatch (§5) |
| `/api/order-book-utxos` length | matches what you see in the UI's PendingOrders panel | §4 (queue mismatch) |
| `npm run preprod -- status` | every wallet shows tADA | wallet harness can be healthy while UI fails — see §2 |

---

## 2. Environment

LumpFun's web tier reads three classes of env vars:

| Class | Where it's read | Examples |
|---|---|---|
| **Server-only** | API routes, `web/src/lib/blockfrost.ts`, `batcher-service.ts`, `graduate-server.ts` | `BLOCKFROST_PROJECT_ID`, `BLOCKFROST_BASE_URL`, `TREASURY_SEED` |
| **Public (browser-reachable)** | `web/src/lib/wallet.tsx`, `cardano-tx.ts`, `order-tx.ts`, all client components | `NEXT_PUBLIC_BLOCKFROST_PROJECT_ID`, `NEXT_PUBLIC_CARDANO_NETWORK`, `NEXT_PUBLIC_TREASURY_ADDRESS`, `NEXT_PUBLIC_USE_QUEUE` |
| **Public, optional knobs** | UI defaults | `NEXT_PUBLIC_GRADUATION_ADA` |

### Required for local dev

```env
# Cardano network (Preprod for dev, Mainnet for production)
CARDANO_NETWORK=Preprod
NEXT_PUBLIC_CARDANO_NETWORK=Preprod

# Blockfrost — BOTH server and browser keys are required
BLOCKFROST_PROJECT_ID=preprod...               # server: /api/curve, /api/order-book-utxos, batcher
NEXT_PUBLIC_BLOCKFROST_PROJECT_ID=preprod...   # browser: trade panel's wallet path via Lucid
BLOCKFROST_BASE_URL=https://cardano-preprod.blockfrost.io/api/v0

# Treasury (also signs the queue-mode batcher txs at present)
TREASURY_SEED="word1 word2 ... word24"
NEXT_PUBLIC_TREASURY_ADDRESS=addr_test1qq...

# Optional: queue mode (off in mainnet prod, on in preprod dev)
NEXT_PUBLIC_USE_QUEUE=1

# Optional: lower graduation threshold for cheap full-cycle dev tests
NEXT_PUBLIC_GRADUATION_ADA=25000
```

### Classic pitfalls

1. **`BLOCKFROST_PROJECT_ID` only set as `NEXT_PUBLIC_*`.** The CLI test harness reads either, so the seeded-wallet flow works. But every API route that proxies Blockfrost (`/api/curve`, `/api/order-book-utxos`, `/api/fee-accumulator`, `/api/holders`, `/api/trades`, `/api/price-history`, `/api/wallet-assets`, `/api/tx-status`) reads only the **server-side** `BLOCKFROST_PROJECT_ID`. Symptoms: CLI succeeds, browser shows 500/502 on the network tab, trade panel renders the new "Curve unavailable" banner (`web/src/app/token/[policyId]/trade-panel.tsx:873`).

2. **Network mismatch.** `NEXT_PUBLIC_CARDANO_NETWORK=Mainnet` but `BLOCKFROST_BASE_URL` points at preprod (or vice versa). Address validation passes, queries 401/403. `/api/health` flags this with a hint.

3. **Leading whitespace in `web/.env.local`.** The repo's existing file has indented keys; some Next.js loader paths silently drop those. Strip leading spaces before each key.

4. **Seed phrase quoting.** `TREASURY_SEED` must be 24 lowercase words separated by single spaces, wrapped in `"..."`. No newlines.

5. **Queue mode + missing seed.** If `NEXT_PUBLIC_USE_QUEUE=1` but `TREASURY_SEED` is unset, the batcher cron route throws on every tick. `/api/health` flags this.

---

## 3. Standard "stack up" procedure

Order matters — each step depends on the previous.

```bash
cd web

# 1. Deps
npm install

# 2. Env — see §2. If swapping between mainnet and preprod, back up the
#    inactive config:
cp web/.env.local web/.env.local.mainnet     # one-time backup
# then edit .env.local for preprod

# 3. Dev server
npm run dev

# 4. Health check
curl -s http://localhost:3000/api/health | jq '.ok, .hints'

# 5. (preprod only) wallet harness fund check
npm run preprod -- status

# 6. (queue mode only) confirm batcher cron path is alive
curl -s -X POST http://localhost:3000/api/orders | jq

# 7. Browser: open localhost:3000, confirm wallet selector lists Vespr/Eternl,
#    open a token page, verify the trade panel renders without "Curve
#    unavailable" or 500s in the network tab.
```

If §1's first probe fails, **do not skip ahead** — every later step will also fail in worse ways.

---

## 4. End-to-end scenario matrix

These should all pass on preprod against Vespr (or Eternl/Lace) before flipping queue mode for any mainnet token. Run on a freshly-launched test token (use `/create` with `NEXT_PUBLIC_GRADUATION_ADA=25000` so the curve doesn't graduate mid-test).

| # | Scenario | Pass criteria | Files exercised |
|---|---|---|---|
| 1 | Connect wallet, fresh curve load | Trade panel renders quote within 5s. No 500s on /api/curve. | `wallet.tsx`, `trade-panel.tsx`, `/api/curve` |
| 2 | Buy order in queue mode | Order locks, "Order queued" banner shows; PendingOrders panel populates within 15s; tokens land at base address within 60–90s; banner clears | `order-tx.ts:submitBuyOrder`, `batcher-service.ts`, `pending-orders.tsx` |
| 3 | Sell order in queue mode | Same as #2, sell side. Wallet's enterprise UTxOs from prior buys are consumed automatically (see issue #1 fix in `2ede510`). | `order-tx.ts:submitSellOrder` |
| 4 | Cancel before batcher runs | Cancel button works; locked funds reclaimed; row disappears. | `order-tx.ts:cancelOrder`, `pending-orders.tsx` |
| 5 | Cancel after execution / duplicate cancel | "Order UTxO not found — already cancelled or executed" appears in the row, not a scary INTERNAL_ERROR. | `order-tx.ts`, `tx-errors.ts` |
| 6 | Rapid double-submit (same wallet, two tabs) | Both lock; first drains via batcher; second skips on slippage (see #7) — banner classifies, doesn't hang. | `trade-panel.tsx:runTrade` |
| 7 | Burst, large amounts (slippage) | Orders that exceed cumulative price impact relative to slippage tolerance correctly skip; user sees clear "skipped on slippage" feedback (currently surfaces only in dev console — UX gap). | `batcher-service.ts:executeOneOrder` |
| 8 | Curve fetch fails server-side | UI shows the "Curve unavailable" banner with a Retry button instead of frozen "Loading…". | `trade-panel.tsx:fetchCurveState` (873) |
| 9 | Wallet INTERNAL_ERROR on submit | Single auto-retry kicks in; if the second also fails, banner shows "Wallet connection lost — Reconnect" with a CTA. | `tx-errors.ts:classifyError`, `pending-orders.tsx` |
| 10 | Direct mode (queue off) trades | Same as #2 but executes immediately, no PendingOrders panel; TxBanner shows "submitted → confirmed" via /api/tx-status poll. | `cardano-tx.ts:buyTokens`, `trade-panel.tsx`, `/api/tx-status` |

---

## 5. Debugging playbook

Symptom → first action → file to look in.

### A. `/api/curve` returns 500

1. **Check `/api/health`** — most common cause is `BLOCKFROST_PROJECT_ID` missing on the server (only `NEXT_PUBLIC_*` set).
2. If health is fine, check dev-server stdout for `[api/curve] blockfrost fetch failed:` — the new wrapped route logs the underlying message and returns 502 + a structured hint.
3. Compare with CLI: `npm run preprod -- status` — if CLI works but the browser doesn't, you have an env split (browser/server use different keys, only one is set).
4. File: `web/src/app/api/curve/route.ts`, `web/src/lib/blockfrost.ts`.

### B. PendingOrders disagrees with cardanoscan

1. Confirm both panels are looking at the **same address**. The order book address is derived from `ORDER_BOOK_CBOR` in `web/src/lib/order-book.ts:9`. Compute it: `npm run preprod -- status` prints it on the first line.
2. `curl -s "http://localhost:3000/api/order-book-utxos?address=<order-book-addr>" | jq 'length'` — does the proxy match cardanoscan's UTxO count?
3. If proxy returns `[]` while explorer shows N, look for `[api/order-book-utxos]` lines in dev stdout — the route now logs every BF non-2xx with the status code.
4. If proxy is right but UI is wrong, the client-side React Query is stale. Hard refresh.

### C. Cancel returns "Order UTxO not found"

1. Look up the order's `txHash#outputIndex` on cardanoscan — was it consumed?
2. **If yes (consumed):** the batcher drained it before your cancel landed. Not an error — show as "already filled, no funds locked." This is the expected race.
3. **If no:** the cancel called `lucid.utxosByOutRef([ref])` and got back empty. Verify network alignment (Vespr on preprod vs server on mainnet, or vice versa).
4. File: `web/src/lib/order-tx.ts:cancelOrder`.

### D. Wallet `INTERNAL_ERROR` (Vespr `code: -2`)

1. CIP-30 spec: `-2` is `APIError.InternalError` — the wallet's submit endpoint had a generic failure. **Not** user rejection.
2. The trade panel and pending-orders panel auto-retry once on this code. If both attempts fail, treat as transient (Vespr session expired).
3. **Recovery:** in Vespr → Settings → Connected dApps → lumpfun → Disconnect. Hard refresh page. Reconnect. Retry.
4. File: `web/src/lib/tx-errors.ts:classifyError`.

### E. Trade panel sticky "Order queued" but no row in PendingOrders

1. The queue banner shows the *lock tx hash*, not the order's UTxO ref. The PendingOrders panel polls `/api/order-book-utxos` every 15s.
2. Wait one full 15s polling tick after the lock tx confirms (~30s to confirm + 15s polling lag = up to 45s).
3. If still missing after 60s: the lock tx may have failed at submission. Check the queue banner's tx-link → cardanoscan → does the tx exist? If not, the wallet returned a hash but didn't actually broadcast (rare; usually a Vespr quirk).

### F. Tokens at enterprise address (legacy)

After the issue #1 fix (`2ede510`), new orders pay back to the user's full base address. Tokens received from orders submitted **before** that commit live at an enterprise address derived from the payment-key alone.

1. Browser wallets aggregate transparently — users *see* their tokens.
2. Block explorers showing only the base address may under-count.
3. **Don't misdiagnose** queue-state issues as enterprise-address issues. Check `/api/order-book-utxos` for the order_book script address (where orders live), not the wallet's payment address (where tokens land after drain).

### G. Batcher silently skipping

1. `/api/orders` POST → response body shows `ordersSkipped: N`.
2. Most common cause: slippage. Order's `minOut` was computed at a curve state that's since moved (orders ahead consumed budget). Manual recovery: cancel + resubmit.
3. Less common: validator integrity error → `errors: N`. Check dev-server stdout for `[batcher] order failed for <ticker>` lines — the underlying Aiken failure is logged.
4. File: `web/src/lib/batcher-service.ts:drainToken`.

---

## 6. UX bar

Bare minimums for "seamless." Every below should be true after the changes that ship in this commit's runbook:

- [ ] **No silent return-null.** Failed `/api/curve` shows a banner with Retry; failed cancel surfaces a per-row error message; failed claim shows a real CIP-30 reason instead of `[object Object]`.
- [ ] **Transient vs terminal distinction.** `INTERNAL_ERROR` and `WALLET_DISCONNECTED` auto-retry once. `USER_REJECTED`, `OUTPUT_TOO_SMALL`, `INSUFFICIENT_ADA` don't retry — user must act.
- [ ] **Single source of truth for "queued."** The PendingOrders panel reads from `/api/order-book-utxos` (chain) every 15s. The trade panel's `outcome.txHash` is *only* the lock tx hash, not a separate state machine. When the chain says the order is gone, both UI surfaces converge within one polling tick.
- [ ] **Cross-network safety.** `/api/health` flags every mismatch combination (network ↔ base URL, queue mode ↔ seed, project_id presence).

Open known gaps:
- Slippage skip surfaces only in `[batcher]` server logs. Surfacing per-order skip reasons to the user requires either persisting a small per-order log or polling a dedicated `/api/order-status?ref=<hash>#<idx>` endpoint. **Not in this commit's scope.**
- Direct mode's TxBanner uses `/api/tx-status` to poll for confirmation; queue mode's QueuedBanner does not poll (PendingOrders is the source of truth). The two banner styles are deliberately different — don't unify them.

---

## 7. File map (what lives where)

| Concern | File |
|---|---|
| Server-side Blockfrost helpers | `web/src/lib/blockfrost.ts` |
| Token registry | `web/src/lib/registry.ts` (KV in prod, JSON file in dev — `cardano-registry.json` at repo root) |
| Trade panel + outcome banners | `web/src/app/token/[policyId]/trade-panel.tsx` |
| Pending orders + cancel UI | `web/src/app/token/[policyId]/pending-orders.tsx` |
| User-side order tx builders | `web/src/lib/order-tx.ts` |
| Order book script + address | `web/src/lib/order-book.ts` |
| OrderDatum codec | `web/src/lib/order-codec.ts` |
| Server-side batcher service | `web/src/lib/batcher-service.ts` |
| Direct trade builders | `web/src/lib/cardano-tx.ts` |
| Error classifier | `web/src/lib/tx-errors.ts` |
| Health probe | `web/src/app/api/health/route.ts` |
| Curve query | `web/src/app/api/curve/route.ts` |
| Order book proxy | `web/src/app/api/order-book-utxos/route.ts` |
| Tx confirmation probe | `web/src/app/api/tx-status/route.ts` |
| Batcher cron | `web/src/app/api/batcher/tick/route.ts` |
| On-submit batcher kick | `web/src/app/api/orders/route.ts` |
| Aiken validators | `contracts/cardano/validators/{bonding_curve,order_book,fee_accumulator,vesting,minting_policy}.ak` |
| Compiled CBOR + hashes (regen via `aiken build`) | `contracts/cardano/plutus.json`, mirrored in `web/src/lib/order-book.ts` and `src/cardano/scripts.ts` |
| Preprod test harness | `web/scripts/preprod-test/cli.mjs` |

---

## 8. Cron + scheduled jobs

`web/vercel.json` defines two crons (run only on Vercel deploys, **not** under `next dev`):

- `/api/graduate/tick` — once a minute. Checks all non-graduated tokens for the threshold and migrates to Minswap.
- `/api/batcher/tick` — once a minute. Drains pending orders.

Locally the crons don't fire. Use `npm run preprod -- tick` or `curl -s -X POST http://localhost:3000/api/orders` to manually invoke the batcher; `/api/graduate/tick` rarely needs manual triggering during dev.

---

## 9. Issue templates

When filing a bug:

```
**Symptom**
(what's failing — UI message, network status, etc.)

**Reproducer**
1.
2.
3.

**/api/health output (preprod or prod)**
```
(paste)
```

**dev-server stdout snippet**
(paste any `[api/...]` or `[batcher]` lines from the same window)

**Wallet + browser**
(Vespr/Eternl/Lace; Chrome desktop, Safari iOS, etc.)

**Tx hashes**
- lock:
- cancel/exec (if applicable):
```

A health snapshot + the relevant log slice triages most bugs in under 10 minutes.
