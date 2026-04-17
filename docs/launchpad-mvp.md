# LumpFun — Launchpad MVP Design

**Status:** approved design, ready for implementation plan
**Date:** 2026-04-16
**Target environment:** Midnight Network **preprod only** (fail-fast on mainnet)
**Reference repo (patterns; do not vendor code):** `/Users/scream2/agent-lump/midnight-agent`

---

## 1. Overview

LumpFun is a pump.fun–inspired token-launch experience built natively on Midnight Network. A creator deploys a single Compact contract per launch. Buyers and sellers trade along a linear bonding curve denominated in native NIGHT. Every trade pays a fee that is split on-chain between platform, creator, and an optional per-trade referral recipient. Fee parameters and recipient addresses are fixed at deploy time and cannot be changed.

## 2. Non-goals (v0)

- Mainnet. All config defaults to preprod; mainnet URLs or `MIDNIGHT_NETWORK=mainnet` fail fast.
- Cardano L1 / Ariadne bridge integration.
- Full DEX aggregation or multi-route swaps.
- Graduation / pool migration (flagged as future work).
- Shielded (ZK-hidden) per-trader balances (flagged as future work).

## 3. Locked design decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Quote asset | native **tNIGHT** (preprod) |
| 2 | Price mechanism | **linear bonding curve** (closed-form integral) |
| 3 | Fee base | **NIGHT-side**, computed against the curve-side integral |
| 4 | Fee/recipient mutability | **fully immutable at deploy**; zero admin circuits |
| 5 | Absent-referral routing | routed to **platform** |
| 6 | Delivery surface | **CLI only** for v0 |
| 7 | Fee disbursement pattern | **pull** (accrue then withdraw) |
| 8 | Privacy | fully public ledger for v0 |
| 9 | Contract factoring | **one contract per launch**; launchpad is a client-side registry (indexer + local cache) |

## 4. Architecture

### 4.1 Why one contract per launch

Compact 0.30.0 / ledger v8 does not support contract-to-contract calls (documented at `midnight-agent/src/token.ts:14-18`). A split design with separate `Token` and `BondingCurve` contracts is therefore not feasible. Each `launch deploy` instantiates a self-contained `LumpLaunch` contract that inlines the fungible-token ledger, the bonding-curve state, and the immutable fee config. There is no on-chain "mother" contract; the launchpad view is purely client-side.

### 4.2 Repo layout

```
LumpFun/
├── README.md                      # env, proof server, compile, deploy, demo
├── package.json                   # aligns with midnight-agent majors
├── tsconfig.json
├── proof-server.yml               # preprod-targeted docker compose
├── .env.example                   # PREPROD defaults, no mainnet
├── docs/
│   ├── launchpad-mvp.md           # this spec
│   └── security.md                # trust model, witnesses, privacy
├── contracts/
│   ├── lump_launch.compact        # the one contract
│   └── managed/                   # compact-compile output (gitignored)
├── src/
│   ├── config.ts                  # preprod hard-default, fail-fast
│   ├── chain.ts                   # JSON-RPC + indexer (ported)
│   ├── wallet.ts                  # HD keys + 3-wallet facade (ported)
│   ├── night.ts                   # NIGHT payment adapter (DR-1 seam)
│   ├── fees.ts                    # TS mirror of circuit fee math
│   ├── curve.ts                   # TS mirror of curve integral
│   ├── launch.ts                  # deploy/buy/sell/transfer/withdraw/query
│   ├── registry.ts                # indexer-backed launch list + local cache
│   ├── cli.ts                     # command dispatcher
│   └── index.ts                   # library surface re-exports
└── tests/
    ├── simulator/                 # runs under `npm test`
    │   ├── curve.test.ts
    │   ├── fees.test.ts
    │   ├── invariants.test.ts
    │   ├── immutability.test.ts
    │   ├── access_control.test.ts
    │   └── ts_parity.test.ts
    └── preprod/
        └── end_to_end.test.ts     # gated by MIDNIGHT_PREPROD_E2E=1
```

### 4.3 Dependency alignment

Mirror the reference `package.json:27-52` major versions:

- `@midnight-ntwrk/compact-js@2.5.0`
- `@midnight-ntwrk/compact-runtime@0.15.0`
- `@midnight-ntwrk/ledger-v8@^8.0.2`
- `@midnight-ntwrk/midnight-js-contracts@4.0.2`
- `@midnight-ntwrk/midnight-js-http-client-proof-provider@4.0.2`
- `@midnight-ntwrk/midnight-js-indexer-public-data-provider@4.0.2`
- `@midnight-ntwrk/midnight-js-node-zk-config-provider@4.0.2`
- wallet-SDK family: `wallet-sdk-facade@3.0.0`, `wallet-sdk-shielded@2.1.0`, `wallet-sdk-unshielded-wallet@2.1.0`, `wallet-sdk-dust-wallet@3.0.0`, `wallet-sdk-hd@3.0.1`, `wallet-sdk-address-format@3.1.0`, `wallet-sdk-prover-client@1.2.0`, `wallet-sdk-indexer-client@1.2.0`, `wallet-sdk-node-client@1.1.0`
- Compact pragma `>= 0.21.0`; toolchain reports `compact compile --version == 0.30.0`.

### 4.4 Config fail-fast rule

`src/config.ts` defaults `MIDNIGHT_NETWORK=preprod` (unlike the reference, which defaults to mainnet). `getConfig()` throws on construction when any of the following hold:

- `MIDNIGHT_NETWORK` is `mainnet`, or
- any of `MIDNIGHT_RPC_URL` / `MIDNIGHT_RPC_WSS_URL` / `MIDNIGHT_INDEXER_URL` / `MIDNIGHT_INDEXER_WS_URL` / `MIDNIGHT_PROVER_URL` / `MIDNIGHT_EXPLORER_URL` contains the substring `mainnet.`

…unless `LUMPFUN_ALLOW_MAINNET=1` is set. This bypass is **undocumented for end users** and gated behind the mainnet-readiness checklist in `docs/security.md`.

## 5. Compact contract: `lump_launch.compact`

Privacy model for v0: **zero witnesses, zero private state**. All ledger fields are public.

### 5.1 Ledger fields

Pseudocode below uses the declaration form from the reference repo's `contracts/counter.compact` and `contracts/my_token.compact`; exact stdlib types (`Map`, `Bytes<32>`, `Opaque<"string">`) are as used there. Final Compact syntax is finalized during implementation.

```compact
pragma language_version >= 0.21.0;
import CompactStandardLibrary;

// --- Immutable metadata (set in constructor, never written again) ---
export ledger name:            Opaque<"string">;
export ledger symbol:          Opaque<"string">;
export ledger decimals:        Uint<8>;
export ledger image_uri:       Opaque<"string">;
export ledger creator_pubkey:  Bytes<32>;   // ZswapCoinPublicKey of deployer

// --- Immutable bonding-curve parameters ---
export ledger base_price_night: Uint<128>;  // atomic NIGHT for token #0
export ledger slope_night:      Uint<128>;  // atomic NIGHT added per next token
export ledger max_supply:       Uint<128>;  // hard mint cap

// --- Immutable fee config ---
export ledger fee_bps:             Uint<16>;  // e.g., 100 = 1%
export ledger platform_share_bps:  Uint<16>;  // share OF the fee (sums to 10000 with c+r)
export ledger creator_share_bps:   Uint<16>;
export ledger referral_share_bps:  Uint<16>;
export ledger platform_recipient:  Bytes<32>;
export ledger creator_recipient:   Bytes<32>;

// --- Live mutable state ---
export ledger tokens_sold:        Uint<128>;
export ledger night_reserve:      Uint<128>;  // curve-owned NIGHT
export ledger platform_accrued:   Uint<128>;  // claimable by platform
export ledger creator_accrued:    Uint<128>;  // claimable by creator
export ledger referrals_accrued:  Map<Bytes<32>, Uint<128>>;
export ledger balances:           Map<Bytes<32>, Uint<128>>;
```

### 5.2 Circuits

| circuit | effect |
|---|---|
| `constructor(name, symbol, decimals, image_uri, creator, base_price, slope, max_supply, fee_bps, p_bps, c_bps, r_bps, platform_addr, creator_addr)` | Sets every immutable field. Asserts `p_bps + c_bps + r_bps == 10000`. Asserts `fee_bps <= 2000`. Zero-initializes live state. |
| `buy(buyer, n_tokens, referral)` | Curve + fee math (§5.3). Takes NIGHT in; updates `balances[buyer]`, `tokens_sold`, `night_reserve`, and accruals. |
| `sell(seller, n_tokens, referral)` | Reverse of buy. Debits `balances[seller]`, `tokens_sold`, `night_reserve`; accrues fee; sends NIGHT out to seller. |
| `transfer(from, to, amount)` | Plain holder-to-holder token transfer. No fee. Patterned after `FungibleToken_transfer`. |
| `withdraw_platform()` | Sends `platform_accrued` NIGHT to `platform_recipient`; zeros the accrual. |
| `withdraw_creator()` | Sends `creator_accrued` NIGHT to `creator_recipient`; zeros the accrual. |
| `withdraw_referral(ref)` | Sends `referrals_accrued[ref]` to `ref`; zeros that slot. Destination is fixed by key — anyone may call. |
| view: `balance_of(addr)`, `curve_quote_buy(n_tokens)`, `curve_quote_sell(n_tokens)`, `current_price()` | Pure read helpers for UI/CLI previews. |

**Why pull (accrue + withdraw) rather than push:** keeps each trade circuit to one NIGHT input (buy) or one NIGHT output (sell) instead of up to four outputs. Smaller proof surface, simpler invariants, trivial to verify the split on-chain via `*_accrued` fields before withdrawal. The success criterion ("platform + creator balances updated per the on-chain split, verifiable via public ledger state") is satisfied as soon as a trade is finalized — no withdrawal required to observe correctness.

### 5.3 Fee math and rounding

The **fee base is the curve-side NIGHT** — the closed-form integral that enters or leaves the curve — not the gross amount the trader hands over. This means the effective fee on a buy is exactly `fee_bps` of the curve cost, with no compounding.

**Linear curve integral:**
```
curve_cost(from, delta)
  = base_price_night * delta
  + slope_night      * (from * delta + delta * (delta - 1) / 2)
```
`delta * (delta - 1) / 2` (not `delta^2 / 2`) keeps integer floor division exact for any `delta`.

**Buy** (`n_tokens > 0`, `tokens_sold + n_tokens <= max_supply`):
```
curve_cost = curve_cost(tokens_sold, n_tokens)
fee        = curve_cost * fee_bps / 10000            // floor
gross_in   = curve_cost + fee                        // buyer pays this

tokens_sold     += n_tokens
balances[buyer] += n_tokens
night_reserve   += curve_cost
split_fee(fee, referral)
receive_night(buyer, gross_in)
```

**Sell** (`n_tokens > 0`, `balances[seller] >= n_tokens`):
```
curve_payout = curve_cost(tokens_sold - n_tokens, n_tokens)
fee          = curve_payout * fee_bps / 10000        // floor
net_out      = curve_payout - fee                    // seller receives this

balances[seller] -= n_tokens
tokens_sold      -= n_tokens
night_reserve    -= curve_payout
split_fee(fee, referral)
send_night(seller, net_out)
```

**Split:**
```
p = fee * platform_share_bps / 10000
c = fee * creator_share_bps  / 10000
r = fee * referral_share_bps / 10000
remainder = fee - p - c - r                          // 0..3 atomic units

platform_accrued += p + remainder                    // remainder always → platform
creator_accrued  += c
if referral is None:
    platform_accrued += r                            // absent ref → platform
else:
    referrals_accrued[referral] += r
```

All sub-share divisions floor; the 0–3-unit remainder is deterministically routed to platform so that `p + c + r == fee` exactly on every trade.

### 5.4 Invariants (enforced by simulator tests)

1. **Share sum.** `platform_share_bps + creator_share_bps + referral_share_bps == 10000` — asserted in constructor and re-asserted on every fee application.
2. **Buy reserve.** `night_reserve_after == night_reserve_before + curve_cost`.
3. **Sell reserve.** `night_reserve_after == night_reserve_before - curve_payout`.
4. **Fee conservation.** Across a trade, the growth of `platform_accrued + creator_accrued + Σ(referrals_accrued)` equals `fee` exactly.
5. **Curve identity.** With no withdrawals, `night_reserve == Σ curve_cost_buys − Σ curve_payout_sells`, which in turn equals `∫₀^{tokens_sold} price` by construction of the closed-form integral.
6. **Supply cap.** `tokens_sold <= max_supply` always; enforced in `buy`.
7. **Non-negative balances.** Enforced by `Uint<128>` plus explicit `assert balances[x] >= amount` before subtraction.
8. **Immutability.** No circuit other than `constructor` writes any of `fee_bps`, `platform_share_bps`, `creator_share_bps`, `referral_share_bps`, `platform_recipient`, `creator_recipient`, `base_price_night`, `slope_night`, `max_supply`, `name`, `symbol`, `decimals`, `image_uri`, `creator_pubkey`. Verified by inspection and by fuzz.
9. **Recipient-path integrity.** Only `buy` and `sell` *increase* accruals. Only `withdraw_*` *decrease* accruals (toward zero). `transfer` never touches accruals or `night_reserve`. No other path moves user funds into recipient-addressed state.

### 5.5 De-risk items (resolved during implementation, not at spec time)

**DR-1: `send_night(to, amount)` primitive.** The circuits assume a Compact / stdlib path that debits `night_reserve` and emits an unshielded NIGHT output to an arbitrary `Bytes<32>` recipient. If this doesn't exist cleanly in Compact 0.21 / ledger v8, fallbacks in order:

- **(a)** The contract emits an unshielded-output *commitment*; the TS client reconciles it via the wallet SDK's unshielded-wallet offer primitives (mirrors `midnight-agent/src/transfer.ts`). Contract surface unchanged; only `src/night.ts` grows an output-reconciliation step.
- **(b)** Swap the quote asset from native NIGHT to a pre-deployed `tLUMP` fungible token (Option B from Q1). `night_reserve` becomes a `tLUMP` balance; `send_night`/`receive_night` become `tLUMP` transfers. Every other field, circuit, and invariant is unchanged.

**Verifying DR-1 is implementation task #1**, ahead of any economic or UI work. The spec is invariant-complete regardless of outcome — only the payment layer changes.

**DR-2: Sum-type ergonomics for `referral`.** Spec uses `referral: Maybe<Bytes<32>>`. Final type may be `Either<Bytes<32>, Unit>`, a pair `(has_ref: Boolean, ref: Bytes<32>)`, or stdlib equivalent. Non-load-bearing; doesn't affect any invariant or share.

## 6. State machine, worked examples, edge cases

### 6.1 State machine

```
       deploy                   every trade/transfer/withdraw
NONE ─────────────▶  ACTIVE  ──────────────────────────────▶  ACTIVE
                       │
                       │  tokens_sold == max_supply
                       ▼
                     CAPPED  — buys revert; sells/transfers/withdraws work
```

No `GRADUATED` state in v0. Holders at cap can still exit via sell. Graduation (e.g., seeding an external DEX pool, or a successor contract handoff) is future work, definition deferred.

### 6.2 Worked fee example

Parameters: `fee_bps = 100` (1%), `platform_share_bps = 5000` (50%), `creator_share_bps = 4000` (40%), `referral_share_bps = 1000` (10%).

**Clean case.** `curve_cost = 1_000_000_007`:

```
fee          = 1_000_000_007 * 100 / 10000 = 10_000_000
platform_cut = 10_000_000 * 5000 / 10000    = 5_000_000
creator_cut  = 10_000_000 * 4000 / 10000    = 4_000_000
referral_cut = 10_000_000 * 1000 / 10000    = 1_000_000
remainder    = 0
```

**Rounding case.** `curve_cost = 999`:

```
fee          = 999 * 100 / 10000 = 9          (trader saved 0.99 NIGHT units)
platform_cut = 9 * 5000 / 10000  = 4
creator_cut  = 9 * 4000 / 10000  = 3
referral_cut = 9 * 1000 / 10000  = 0
remainder    = 9 - 4 - 3 - 0 = 2  →  platform_accrued += 2

Final: platform += 6, creator += 3, referral += 0; total = 9  ✓
```

### 6.3 Edge cases

| case | behavior |
|---|---|
| `referral == None` | Platform absorbs the `referral_share_bps` cut for that trade. |
| Zero-amount buy/sell | Reverts with `ERR_ZERO_AMOUNT`. |
| Buy exceeds remaining supply | Reverts with `ERR_EXCEEDS_SUPPLY`. No partial fill in v0. |
| Sell exceeds seller balance | Reverts with `ERR_INSUFFICIENT_BALANCE`. |
| Sell would drain reserve below `curve_payout` | Sanity assert (unreachable under invariant 5). |
| `fee_bps == 0` | Legal. Split math short-circuits; no accruals grow. |
| `fee_bps > 2000` | Rejected in constructor (cap at 20%). |
| `creator_recipient == platform_recipient` | Legal. Same hex address accrues into two separate ledger fields; both still sum correctly. |
| `referral == creator_recipient` or `platform_recipient` | Legal. Recorded under `referrals_accrued[addr]`; claimed via `withdraw_referral`. |

## 7. TypeScript client (`src/`)

Module boundaries mirror the reference repo so a familiar reader lands instantly.

| file | purpose |
|---|---|
| `config.ts` | Preprod hard-default; `assertPreprod()`; `LUMPFUN_ALLOW_MAINNET=1` bypass (gated). |
| `chain.ts` | Ported JSON-RPC + GraphQL indexer helpers from `midnight-agent/src/chain.ts`. Read-only for v0. |
| `wallet.ts` | Ported HD + 3-wallet facade from `midnight-agent/src/wallet.ts`. Trimmed of reference-repo-specific concerns (Ascend/DEX). |
| `night.ts` | The payment adapter — §5.5 DR-1 seam. Builds NIGHT-in / NIGHT-out offers bound to a contract. Only module that knows which DR-1 outcome we're on. |
| `fees.ts` | Pure-TS mirror of the circuit fee math in §5.3. Lets CLI preview splits before signing. Unit-tested to byte-parity against the circuit. |
| `curve.ts` | Pure-TS mirror of the curve integral. Same parity requirement. |
| `launch.ts` | Domain module. `deployLaunch`, `connectLaunch`, `buy`, `sell`, `transfer`, `withdrawPlatform`, `withdrawCreator`, `withdrawReferral`, read helpers. Every write entrypoint calls `assertPreprod()`. Provider wiring mirrors the three-branch pattern in `midnight-agent/src/token.ts:303-508`. |
| `registry.ts` | Client-side launchpad view: indexer enumeration of deployed `LumpLaunch` contracts + a local JSON cache at `~/.lumpfun/registry.json`. No on-chain registry. |
| `cli.ts` | Command dispatcher (see §8). |
| `index.ts` | Namespace re-exports, matching `midnight-agent/src/index.ts:1-80` shape. |

**Key types:**

```ts
export interface LaunchDeployParams {
  metadata: { name: string; symbol: string; decimals: number; imageUri: string };
  curve:    { basePriceNight: bigint; slopeNight: bigint; maxSupply: bigint };
  fees:     {
    feeBps: number;
    platformShareBps: number;
    creatorShareBps:  number;
    referralShareBps: number;
    platformRecipient: string;   // hex ZswapCoinPublicKey
    creatorRecipient:  string;   // hex; defaults to deployer pubkey
  };
}

export interface LaunchHandle {
  contractAddress: string;
  metadata: LaunchMetadata;
  fees:     FeeConfig;
  curve:    CurveParams;
  state:    LiveState;           // tokensSold, nightReserve, *Accrued, balances
}

export interface TradeQuote {
  curveSide: bigint;             // curve_cost (buy) or curve_payout (sell)
  fee:       bigint;
  split:     { platform: bigint; creator: bigint; referral: bigint };
  grossPayByBuyer?:     bigint;  // buys: curveSide + fee
  netReceivedBySeller?: bigint;  // sells: curveSide - fee
}
```

**Provider wiring.** v0 documents the "standard" branch (local Docker proof server per `proof-server.yml` + local DUST balancing) as the supported path. The "local-prove-then-remote-submit" and "gas-sponsored" branches from the reference are ported verbatim but flagged "untested in LumpFun v0" — they exist for later but do not block the preprod success criterion.

## 8. CLI surface

Every write command pre-runs a `preflightCheck` adapted from `midnight-agent/src/token.ts:99-176` (contract compiled, proof server reachable, wallet has DUST, network is preprod).

```
npm run dev -- wallet create
npm run dev -- wallet status
npm run dev -- wallet balances

npm run dev -- launch deploy \
    --name "My Meme" --symbol MEME --decimals 6 --image ipfs://... \
    --base-price 1000 --slope 1 --max-supply 1000000000000 \
    --fee-bps 100 --platform-bps 5000 --creator-bps 4000 --referral-bps 1000 \
    --platform-recipient <hex-pubkey> \
    [--creator-recipient <hex-pubkey>]          # defaults to deployer

npm run dev -- launch list
npm run dev -- launch info <addr>

npm run dev -- launch quote-buy  <addr> --tokens <n>
npm run dev -- launch quote-sell <addr> --tokens <n>

npm run dev -- launch buy  <addr> --tokens <n> [--referral <hex>]
npm run dev -- launch sell <addr> --tokens <n> [--referral <hex>]
npm run dev -- launch transfer <addr> --to <hex> --amount <n>

npm run dev -- launch withdraw-platform <addr>
npm run dev -- launch withdraw-creator  <addr>
npm run dev -- launch withdraw-referral <addr> --ref <hex>

npm run dev -- launch fees <addr>
npm run dev -- launch verify-split <tx>

npm run dev -- chain health
```

`verify-split <tx>` fetches a trade tx from the indexer, reads the `*_accrued` deltas and balance/reserve changes, recomputes the expected split off-chain via `src/fees.ts` + `src/curve.ts`, and prints a pass/fail diff. This is the **success-criterion command** — it mechanically proves the on-chain split matches the declared economics for any given trade.

## 9. Testing

### 9.1 Simulator tier (`tests/simulator/`, runs in `npm test`)

Fast (~100ms per test), chain-free, no proof server. Uses `@midnight-ntwrk/compact-runtime`'s in-memory simulator in the same style as the OpenZeppelin module tests at `contracts/compact-contracts/contracts/src/token/test/` in the reference repo.

- **`curve.test.ts`** — fuzzed round-trip of `curve_cost_buy(from, Δ)` + `curve_payout_sell(from, Δ)`; residual `night_reserve` must be zero (invariant 5).
- **`fees.test.ts`** — fuzzed `(fee_bps, shares, curve_side)`; assert `p + c + r == fee` exactly and remainder-to-platform routing. §6.2 worked examples as fixed-value tests.
- **`invariants.test.ts`** — scripted + fuzzed multi-step scenarios (interleaved buys/sells/transfers); every invariant in §5.4 checked after each step. Includes a property test: for any random sequence of `buy`/`sell`/`transfer`, the growth of `platform_accrued + creator_accrued + Σ(referrals_accrued)` equals `Σ fee_per_trade`.
- **`immutability.test.ts`** — deploy with known params, run N random trades, assert every immutable field is byte-identical to its initial value. Catches any accidental write to fee/recipient/curve/metadata fields (invariant 8).
- **`access_control.test.ts`** — reverts for supply cap, zero amounts, insufficient balance, `fee_bps > 2000` in constructor, share sum != 10000 in constructor.
- **`ts_parity.test.ts`** — `src/fees.ts` + `src/curve.ts` produce byte-identical outputs to the circuit for 1k random inputs (10k inputs under an `--extended` flag). Protects the CLI preview from drifting.

### 9.2 Preprod integration (`tests/preprod/end_to_end.test.ts`, gated by `MIDNIGHT_PREPROD_E2E=1`)

One test. Runs only when gated env is set and a proof server + funded preprod wallet are available. Takes 2–5 minutes:

1. Create throwaway wallet; faucet out-of-band (test prints address + pauses if DUST missing).
2. `launch deploy` with a known fee config.
3. `launch quote-buy` → `launch buy`; assert `tokensSold`, `balances[buyer]`, `platform_accrued`, `creator_accrued` all exactly match TS predictions.
4. `launch quote-sell` → `launch sell`; assert reserve decrease, seller NIGHT +`curve_payout − fee` exactly.
5. `launch withdraw-platform`, `launch withdraw-creator`; assert accrual fields zero and recipient NIGHT balances +exact.
6. `launch verify-split <tx>` for both trade txs — must print "ok".

This test **is** the success criterion, executed.

## 10. README + preprod checklist + security

### 10.1 README must document

1. **Env vars** — full table with preprod defaults; explicit note that mainnet URLs fail fast.
2. **Proof-server setup** — `docker compose -f proof-server.yml up -d`, port 6300, `curl http://localhost:6300/health` check.
3. **Compact compile** — `npm run compact:compile` → outputs to `contracts/managed/lump_launch/`.
4. **Deploy steps** — `wallet create` → preprod faucet (out-of-band) → `dust register` → `launch deploy <full example args>`.
5. **Demo trade sequence** — copy-pasteable: `launch quote-buy` → `launch buy` → `launch quote-sell` → `launch sell` → `launch fees` → `launch withdraw-platform` → `launch verify-split`. Same sequence the E2E test runs.
6. **Troubleshooting table** — proof-server-unreachable, DUST-empty, mainnet-attempted, compile-missing errors mapped to fixes.

### 10.2 Preprod readiness checklist

- [ ] `MIDNIGHT_NETWORK=preprod`; all URL env vars point at `*.preprod.midnight.network`.
- [ ] `assertPreprod()` called from every write path in `src/launch.ts`.
- [ ] Local proof server running per `proof-server.yml`, health-check passes.
- [ ] Wallet has non-zero NIGHT and non-zero DUST (`wallet balances`).
- [ ] `compact compile --version` reports `0.30.0`.
- [ ] `@midnight-ntwrk/*` versions in `package.json` match §4.3.
- [ ] All simulator tests pass (`npm test`).
- [ ] E2E test passes (`MIDNIGHT_PREPROD_E2E=1 npm test`).

### 10.3 `docs/security.md` (skeleton)

- **Trust model.** Creators trust deploy-time inputs. Traders trust the on-chain immutable params. Platform has only recipient rights — no admin authority. Anyone can trigger `withdraw_*` because destinations are fixed in ledger state, so recipient griefing is impossible (cost = caller's DUST; benefit = destination receives their own funds).
- **Admin powers.** None in v0.
- **Witness boundaries.** None in v0. Any v1 shielded-balance variant must audit `disclose()` discipline for every witness-derived value that influences public state or branching.
- **Privacy leak checklist (v0 is intentionally fully public).**
  - [x] Trader `ZswapCoinPublicKey` visible on every buy/sell.
  - [x] Every per-holder balance public.
  - [x] Every fee accrual public.
  - [x] Creator identity public.
  - [x] Referral address (if passed) public.
  - [x] Launch metadata (name, symbol, image URI) public.
  - v1 future work: commit-and-prove pattern to hide individual trader balances.
- **Mainnet checklist gate.** `LUMPFUN_ALLOW_MAINNET=1` is undocumented for end users until this file's mainnet section has been authored and independently audited against mainnet conditions (DUST economics, proof-server policy, indexer version, ledger version).

## 11. Implementation sequence (summary)

1. Resolve **DR-1** (native NIGHT send/receive from contract) on preprod — spike; pick one of DR-1 outcomes (a, b, or fallback-to-`tLUMP`).
2. Scaffold repo: `package.json`, `tsconfig.json`, `.env.example`, `proof-server.yml`, `src/config.ts` with `assertPreprod()`.
3. Port `chain.ts` + `wallet.ts` from reference; trim.
4. Write `contracts/lump_launch.compact` against the chosen DR-1 outcome.
5. Write `src/fees.ts` + `src/curve.ts` + simulator tests (`curve`, `fees`, `ts_parity`).
6. Write `src/night.ts` adapter against chosen DR-1 outcome.
7. Write `src/launch.ts` (deploy, buy, sell, transfer, withdraws, queries).
8. Write `src/registry.ts`.
9. Write remaining simulator tests (`invariants`, `immutability`, `access_control`).
10. Write `src/cli.ts`.
11. Write `tests/preprod/end_to_end.test.ts`.
12. Write `README.md` with the demo sequence; write `docs/security.md`.
13. Run E2E on preprod; verify `launch verify-split` returns ok on every trade.

A detailed, phased implementation plan will be produced by the `writing-plans` skill as the next step.
