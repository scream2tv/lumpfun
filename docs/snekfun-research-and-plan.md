# SnekFun Research + LumpFun Speed Roadmap

> **Status:** Research complete. Phase 0 (observation) pending on the
> cardano-node PC. No LumpFun code changes yet.
> **Last updated:** 2026-05-11

This document is the source of truth for the speed-improvement effort. It
captures what we learned about snek.fun's architecture, why LumpFun is
slower today, and the staged plan to close the gap. Read it end-to-end
before touching the batcher.

If you are a fresh Claude Code session: jump to **"Next action"** at the
bottom; everything above it is context for why that action matters.

---

## TL;DR

snek.fun (built by the Splash Protocol team) is fast because it layers
four well-known eUTxO patterns simultaneously. LumpFun's current Phase 1
batcher uses none of them:

1. **Intra-tx batching.** One tx spends one pool UTxO + N user-signed
   "instant order" UTxOs. The pool validator checks conservation across
   the summed deltas; each order validator checks its own slippage. We
   build one tx per order.
2. **Transaction chaining via mempool sync.** Their off-chain agent
   tracks `Predicted` / `Unconfirmed` / `Confirmed` state per pool and
   builds the next tx against the predicted post-state of the in-flight
   tx, without waiting for block confirmation. We poll Blockfrost on a
   cron tick.
3. **Per-pair partitioning.** Four worker streams shard by `PairId`, so
   different tokens execute in parallel; same-pool txs stay FIFO so the
   chain doesn't fork. We have one serialised batcher.
4. **Funding-UTxO pool.** Multiple rotating funding addresses prevent
   Lucid-style coin-selection collisions. We use one wallet.

Measured impact (rough): the first two are ~10x apiece on same-pool
throughput; the third is ~4x on cross-pool throughput. Adopting all
four would take LumpFun from ~30s/order to roughly one block (~20s) for
~50 orders.

---

## What we found (full architecture)

Source repos:

- [splashprotocol/splash-offchain-multiplatform](https://github.com/splashprotocol/splash-offchain-multiplatform) — Rust off-chain engine, contains `snek-cardano-agent` crate.
- [splashprotocol/splash-core](https://github.com/splashprotocol/splash-core) — Plutarch/Aiken validators for the Splash DEX (does not contain the snek launchpad validators, only the DEX they graduate to).

### On-chain: four scripts ([source](https://github.com/splashprotocol/splash-offchain-multiplatform/blob/develop/snek-cardano-agent/src/snek_protocol_deployment.rs))

| Script | Mainnet hash | Role |
|---|---|---|
| `instantOrder` | `d9143ac63473b17a215d1b7484dfb6ac6b4a0005beb0e26a6ca02c96` | User-signed intent UTxO. Datum: recipient, slippage, etc. |
| `instantOrderWitness` | `a5643b4a22a192d7691d05baf4a9bbb8acdbb5daa60be1f333e128f1` | Witness that authorises an instant_order being absorbed into a batch tx. |
| `degenFnPoolV1` | `905ab869961b094f1b8197278cfe15b45cbe49fa8f32c6b014f85a2d` | The bonding curve pool (quadratic, ADA↔token). |
| `degenFnPoolV1T2T` | `c876c435e1de1bd93ac71f0e9f956a844cd72493514d2740221bfea6` | Token-to-token variant. |

Reference UTxOs (so the agent never has to inline the scripts):

- Order pair reference UTxO: `e2ed9e953ebf98ca701fc93588d73cb9769f87b9d13712474f566a0743963e8b`
- DegenFnPoolV1 reference UTxO: `c4a540ac2e06c217dd4fb3f39ca3863da394ba134677dafa9b98830ca71d584d#3`

**Critical detail from the deployment manifest:** `instantOrderWitness`
has `marginalCost = { mem: 213_000, steps: 78_944_000 }`. This is the
**per-additional-order** cost — definitive evidence that the engine
spends many orders in one tx. With mainnet protocol params (~14M mem /
10B steps per tx) and the pool's 550k mem base cost, the ceiling is
roughly **40–60 orders per tx** before hitting either steps or tx-size
limits.

### Off-chain: the agent ([snek-cardano-agent/src/main.rs](https://github.com/splashprotocol/splash-offchain-multiplatform/blob/develop/snek-cardano-agent/src/main.rs))

Composition (left-to-right is the data flow):

```
cardano-node n2c socket
    ├── chain_sync_stream  ──► ledger_transactions stream
    ├── local-tx-monitor   ──► mempool_stream
    └── local-tx-submit    ◄── tx_submission_agent

ledger_stream  ─┐
mempool_stream ─┴► PairUpdateHandler ──► Partitioned<[p1, p2, p3, p4]>
                                          │
                                          ├─► execution_part_stream(p1) ──► tx_submission
                                          ├─► execution_part_stream(p2) ──► tx_submission
                                          ├─► execution_part_stream(p3) ──► tx_submission
                                          └─► execution_part_stream(p4) ──► tx_submission

                State (per-pool):
                   InMemoryStateIndex<EvolvingCardanoEntity>
                      ├── get_last_predicted    ← from tx we just submitted
                      ├── get_last_unconfirmed  ← from mempool sync
                      └── get_last_confirmed    ← from ledger stream
```

Key pieces:

- **`cardano-mempool-sync` crate** subscribes to the local node's
  `LocalTxMonitor` mini-protocol. This is where speed comes from — every
  tx that hits the mempool fires an event before block inclusion.
- **`resolve_state`** ([resolver.rs](https://github.com/splashprotocol/splash-offchain-multiplatform/blob/develop/bloom-offchain/src/execution_engine/resolver.rs)) returns predicted > unconfirmed > confirmed.
  The executor builds the *next* tx using whatever state is freshest.
- **`Partitioned::new([p1, p2, p3, p4])`** in main.rs routes each
  `PairId` to exactly one partition via a hash. Same token always lands
  on the same worker (enforces FIFO chaining); different tokens hash to
  different workers.
- **`HotPriorityBacklog`** per pair picks the next order to execute by
  expected fee — orders that pay more get picked first.
- **`funding_addresses: Vec<Address>`** rotates funding UTxOs across
  txs. The `pull_collateral` call earmarks one UTxO as permanent
  collateral so coin selection never grabs it.
- **`OperatorProver`** signs every tx with the batcher key. Users never
  sign the settlement tx — only the original `instant_order` UTxO at
  the script.

---

## Where LumpFun is bottlenecked

Measured baseline from 2026-05-09 mainnet test: 4 concurrent orders on
one token settled in 115.3s. That breaks down to ~30s/order, dominated
by:

- Vercel cron tick (~10s typical interval until next fire).
- Blockfrost confirm poll lag (~10–30s before we see the prev tx
  confirmed).
- Lucid tx build + submit (~1–3s).
- Cardano block time (~20s expected, ~10s observed when lucky).

| Layer | LumpFun today | snek.fun | Gain |
|---|---|---|---|
| Intra-tx batching | 1 order/tx | N orders/tx | 5–10× per pool |
| Mempool chaining | No (Blockfrost confirm + cron) | Yes (predicted state) | ~10× same-pool rate |
| Per-pair partitioning | Single serialized batcher | 4 partitioned workers | 4× cross-pool |
| Funding-UTxO pool | 1 wallet, Lucid CS | N rotating addrs | Eliminates CS races |

---

## The plan (staged)

### Phase 0 — Observe (cardano-node PC)
**Goal:** Verify on a live network that snek does what the source says,
measure how often, and capture concrete numbers we can target.
**No LumpFun code changes.**

### Phase 1 — Predicted-state cache in `batcher-service.ts`
**Goal:** Get same-pool settlement to chain without waiting for
confirmation. Largest single win that doesn't require leaving Vercel.

### Phase 2 — Per-pool partitioning + cross-pool parallelism
**Goal:** Stop serialising the batcher. `await Promise.all(byPolicyId)`
plus FIFO ordering within each pool.

### Phase 3 — Move batcher to a long-lived worker on the cardano-node PC
**Goal:** Subscribe to the local node's mempool directly (via Ogmios)
instead of polling Blockfrost. Unblocks true tx chaining.

### Phase 4 — v2 bonding-curve validator with `BatchSpend` redeemer
**Goal:** Intra-tx batching. New validator hash → new launches go to v2,
existing tokens keep v1 path.

### Phase 5 — Funding-UTxO pool for the batcher wallet
**Goal:** Eliminate Lucid coin-selection races. Independent; can land
any time.

The phases are sequenced by leverage and risk. Phase 0–3 are
non-breaking and can ship incrementally. Phase 4 is the largest payoff
but ships behind a feature flag for new tokens only.

---

## Phase 0 (cardano-node PC) — detailed task list

Pre-reqs assumed on this machine:

- mainnet cardano-node fully synced
- Ogmios reachable (default `ws://127.0.0.1:1337`)
- Kupo reachable (default `http://127.0.0.1:1442`)

### Task 0.1 — Derive snek's mainnet pool address; confirm activity

The pool validator hash is `905ab869961b094f1b8197278cfe15b45cbe49fa8f32c6b014f85a2d`. On mainnet that bech32-encodes (script address, no stake credential) to an `addr1w…` address. Compute it with:

```bash
echo "905ab869961b094f1b8197278cfe15b45cbe49fa8f32c6b014f85a2d" > /tmp/poolhash.txt
cardano-cli address build \
  --payment-script-hash $(cat /tmp/poolhash.txt) \
  --mainnet
```

(Or call `cml_chain` via the Rust agent's own utilities — see
`spectrum-cardano-lib`.) Verify a recent tx at that address on a block
explorer (e.g. cardanoscan or `kupo`). Confirm it's active.

### Task 0.2 — Live mempool watcher via Ogmios

Goal: subscribe to Ogmios's `AwaitAcquire`/`NextTransaction` for the
mempool and log every tx that touches the snek pool or order script
addresses. For each tx, capture:

- tx hash
- # of inputs at the order script address (this is the per-tx batch size)
- # of inputs at the pool script address (should always be 1)
- time from "saw in mempool" → "confirmed in block"
- did multiple snek txs land in the same block on the same pool? (no = pure block-time chaining; yes = mempool chaining)

Skeleton Node script (no Rust needed for this task):

```js
// scripts/snek-mempool-watch.mjs
import WebSocket from 'ws';

const POOL_HASH  = '905ab869961b094f1b8197278cfe15b45cbe49fa8f32c6b014f85a2d';
const ORDER_HASH = 'd9143ac63473b17a215d1b7484dfb6ac6b4a0005beb0e26a6ca02c96';

const ws = new WebSocket('ws://127.0.0.1:1337');
ws.on('open', () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'acquireMempool',
    params: {},
  }));
});
// then loop: queryMempool/nextTransaction until null, fold tx,
// release+acquire to advance. Log per-tx counts of inputs at each addr.
```

Expected output (hypothesis):

- N orders in a single tx (intra-tx batching) — confirms layer 1
- Two snek txs in the same block on the same pool — confirms layer 2

If we *don't* see either, the architecture is different from what the
source suggests and we need to back up.

### Task 0.3 — (Optional) Build and run snek-cardano-agent locally

This is more involved. It validates we *can* run the engine but isn't
strictly required to make progress on LumpFun. Do it only if Task 0.2
leaves unanswered questions.

```bash
# On the cardano-node PC
git clone https://github.com/splashprotocol/splash-offchain-multiplatform
cd splash-offchain-multiplatform
# Rust nightly is typical for Cardano stacks; check rust-toolchain.toml
cargo build --release -p snek-cardano-agent

# Inspect config templates:
cat snek-cardano-agent/resources/mainnet.config.json.template
cat snek-cardano-agent/resources/mainnet.deployment.json
cat snek-cardano-agent/resources/validation-rules.json
```

Critical config knobs:

- `node.path` — the n2c socket (e.g. `/path/to/cardano-node.socket`)
- `node.magic` — `764824073` for mainnet
- `operator_key` — the signing key. **For observation only,** generate a
  throwaway key with no funded UTxOs; the agent will start, fail to find
  collateral, and exit cleanly. That's enough to confirm the binary
  builds and the node socket is reachable.
- `disable_mempool: true` (in config) — if you want chain-sync only.

**Do not run the agent against snek's mainnet contracts with a funded
operator key.** You'd be competing with snek's real operator and likely
losing fees + creating chaos. Observation only.

### Task 0.4 — Capture numbers

After Task 0.2 has run for ~30 min during a busy period:

- median # of orders per tx
- p50 / p95 mempool→block latency for snek txs
- max same-pool txs per block
- typical interval between snek's own batch txs on a hot pool

These numbers are the target LumpFun has to reach in Phases 1–4. Save
the raw log + summary to `docs/snekfun-observation-log.md` and commit
back to this repo.

---

## Phase 1 — Predicted-state cache (next code change)

After Phase 0 confirms the model, ship a predicted-state cache to
`web/src/lib/batcher-service.ts`. Sketch:

```ts
// Map<curveAddress, { predictedUtxo: UTxO, submittedAtMs, txHash }>
const predicted = new Map<string, PredictedState>();

async function getCurveUtxo(curveAddress: string): Promise<UTxO> {
  const p = predicted.get(curveAddress);
  if (p && Date.now() - p.submittedAtMs < 60_000) {
    // We submitted a tx <60s ago that produces this UTxO. Use it.
    return p.predictedUtxo;
  }
  return await blockfrostUtxosAt(curveAddress);  // current path
}

// After every successful submit:
function recordPredicted(curveAddress: string, tx: Tx) {
  const newCurveOutput = tx.outputs.find(o => o.address === curveAddress);
  predicted.set(curveAddress, {
    predictedUtxo: { txHash: tx.hash, outputIndex: idx, ...newCurveOutput },
    submittedAtMs: Date.now(),
    txHash: tx.hash,
  });
}
```

Invalidation rules:

- On confirmed block including our tx → clear the predicted entry (the
  ledger now has it).
- On `txSubmit` failure → clear immediately and fall back to Blockfrost.
- On 60s timeout without confirmation → clear (the tx was probably
  dropped from the mempool by the node).

This change alone should let same-pool settlement chain across blocks
without waiting for Blockfrost confirm. Even without mempool sync, the
*next* cron tick will build against the predicted state.

---

## Phase 2 — Per-pool partitioning

```ts
// Today's loop (sequential):
for (const order of pendingOrders) await processOrder(order);

// Phase 2 (per-pool FIFO, cross-pool parallel):
const byPool = groupBy(pendingOrders, o => o.policyId);
await Promise.all(
  Object.values(byPool).map(async (poolOrders) => {
    poolOrders.sort(byCreatedAt);
    for (const order of poolOrders) await processOrder(order);
  }),
);
```

The within-pool sort + sequential is required — chaining only works if
the next tx sees the previous tx's predicted state. The across-pool
parallel is the win.

---

## Phase 3 — Move batcher off Vercel

When Phase 1 + 2 hit their ceiling (we still wait for `cron tick`
intervals between attempts), move the batcher loop to a long-lived
Node/Bun process running on the cardano-node PC. Subscribe to:

- Ogmios `ChainSync` for confirmed blocks (replaces Blockfrost confirm
  polling)
- Ogmios `MempoolMonitor` for mempool acceptance signal (this is what
  unlocks true predicted-state chaining without the 60s timeout)

Heroku/Railway/Fly all work too, but they don't have the local node
socket — they'd need Ogmios over WSS to Demeter.run or self-hosted.
The cardano-node PC is the cheapest and lowest-latency option.

Vercel routes (`/api/queue/*`) stay; they just write to a Redis/KV
queue that the worker on the cardano-node PC drains.

---

## Phase 4 — v2 validator with `BatchSpend`

New Aiken validator family:

```aiken
// contracts/cardano/validators/bonding_curve_v2.ak
pub type Redeemer {
  BatchSpend { orders: List<OrderRef> }
  Graduate
}

validator bonding_curve_v2(...) {
  spend(datum, redeemer, output_reference, tx) {
    when redeemer is {
      BatchSpend { orders } ->
        // Validate that:
        //   - Each order in `orders` is a CURRENT input at instant_order script
        //   - The sum of net deltas across all orders matches the pool's
        //     before/after (constant function invariant)
        //   - The new pool output preserves token policy + correct datum
        ...
      Graduate -> ...
    }
  }
}
```

Migration: validator hash changes → existing tokens are on v1, new
launches go to v2. Registry already supports per-token validator CBOR
(see `TokenMeta.validatorCbor`). The batcher detects which version each
token uses and dispatches accordingly.

---

## Phase 5 — Funding-UTxO pool

`batcher-service.ts` env reads `BATCHER_SEED` (12-word phrase) and
derives one address. Switch to:

- Derive 8 addresses (BIP-44 paths `m/1852'/1815'/0'/0/{0..7}` from the
  same seed).
- Round-robin tx-by-tx.
- Pre-fund each with ~10 ADA at startup.
- A separate UTxO at a known address acts as permanent collateral.

This solves the coin-selection race we patched around in the
sell-flow with explicit `collectFrom(walletUtxos)`. Cheap and
independent of every other phase.

---

## Open questions

- **Does snek's `instantOrder` allow the operator to spend without a
  fresh user signature?** Required for the operator to batch user
  orders without per-tx UX. We assume yes (the witness script gives
  permission once the order datum is signed). Confirm by inspecting the
  on-chain redeemer pattern in Task 0.2.
- **What's snek's tx-size ceiling in practice?** Theoretical max is
  ~40–60 orders per tx; real-world is likely lower. Task 0.4 measures
  this directly.
- **Does mempool chaining work with Demeter.run-hosted Ogmios?** Yes
  per Ogmios docs; we don't strictly need a self-hosted node. But local
  socket is faster (<1ms vs WSS).
- **Vercel cron min interval is 1 min in prod.** Even with predicted
  state, cron-driven means worst case 60s between attempts. Phase 3 is
  the real fix for that.

---

## File pointers (existing LumpFun code that changes)

- `web/src/lib/batcher-service.ts` — main batcher loop. Predicted-state
  cache lands here.
- `web/src/app/api/batcher/route.ts` — Vercel cron entry. Stays in
  Phases 1+2; replaced by an external worker in Phase 3.
- `contracts/cardano/validators/order_book.ak` — current order book
  validator (Phase 1 design). New v2 validator lives alongside.
- `contracts/cardano/lib/lumpfun/types.ak` — `OrderDatum` is already
  stake-aware (issue #1 fix). v2 should keep this.
- `web/src/lib/order-codec.ts` + `src/cardano/codec.ts` — both already
  encode/decode the 9-field order schema. v2 introduces a new redeemer,
  not a new datum (keep order shape stable).
- `cardano-registry.json` (or KV `registry:tokens` in prod) —
  `TokenMeta.validatorCbor` is per-token, so v1/v2 cohabit fine.

---

## Next action

If you are a fresh session on the **cardano-node PC**: start with
**Task 0.1** above (derive snek's mainnet pool address and verify
activity on cardanoscan). Then **Task 0.2** (write the Ogmios mempool
watcher). Goal: confirm the architecture hypothesis with on-chain
numbers before we touch any LumpFun code.

If you are a fresh session on the **laptop (LumpFun web/)**: nothing to
do until Phase 0 reports back with numbers. Don't pre-implement Phase 1
without that data — we'd be guessing at edge cases.
