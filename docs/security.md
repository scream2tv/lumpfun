# LumpFun Security Model (v0)

This document captures the trust boundaries, privacy posture, and mainnet-readiness gate for LumpFun v0. It is a standalone artifact; the reference spec at [`launchpad-mvp.md`](launchpad-mvp.md) remains the design source of truth.

## Trust model

Creators trust the values they supply to `launch deploy` — curve parameters (base price, slope, max supply), fee schedule (total bps, platform/creator/referral shares), fee recipients, and metadata. These are written once at deploy time and are never mutable afterward.

Traders trust the on-chain immutable params. Because the contract exposes no setter circuits, a trader who reads a launch's state and is satisfied with the terms can be confident those terms will not change for the lifetime of the contract. Every interaction — buy, sell, transfer, withdraw — uses values pinned at deploy.

The platform has **recipient rights only**. It has no admin authority: no pause, no upgrade, no recipient rotation, no fee-schedule amendment. The platform's only privilege is that the deploy-time `platform_recipient` address receives platform-side fee NIGHT when `withdraw_platform` runs.

`withdraw_platform`, `withdraw_creator`, and `withdraw_referral` are **callable by anyone**. Destinations are fixed in ledger state, so the caller cannot redirect funds. This is deliberate: it eliminates griefing by a recipient who refuses to call their own withdraw — any third party can forward the funds to the rightful destination, paying only their own DUST for the privilege.

## Admin powers

None in v0. There are no admin circuits. No field of the contract — fee recipients, share percentages, curve parameters, metadata — is mutable after deploy.

## Witness boundaries

None used in v0. The contract is fully public. Every value that influences ledger state or circuit branching is either a constructor constant or a transaction input verified against ledger state.

The simulator suite enforces this in [`tests/simulator/immutability.test.ts`](../tests/simulator/immutability.test.ts): across 20+ random trades, every immutable field is asserted to be byte-identical before and after. Any future v1 addition that introduces witnesses must audit `disclose()` discipline — specifically, any witness-derived value that influences public state or branching must be explicitly `disclose`d, with a comment justifying why the disclosure is information-theoretically safe.

## Privacy leak checklist (v0 is intentionally fully public)

Every piece of information below is visible on-chain and to any indexer consumer:

- Trader `ZswapCoinPublicKey` on every buy and sell.
- Per-holder balance for every holder.
- Per-recipient accruals: platform, creator, and per-referrer.
- Creator identity (hex public key).
- Referral address on any trade where one is passed.
- Launch metadata: name, symbol, decimals, image URI.

v1 future work: a commit-and-prove pattern to shield per-trader balances while preserving the public invariants the curve depends on (total supply, total NIGHT reserve).

## Caller-verifies pattern — security implications

Compact 0.22 has no `/` operator. The `buy` and `sell` circuits therefore accept pre-computed values (`curve_cost`, `fee`, platform share, creator share, referral share, remainder) as parameters. The contract verifies each claim by multiplication and comparison:

- `curve_cost` is checked against the linear sum the curve defines at the current supply.
- `fee = curve_cost * fee_bps / 10_000` is checked by `fee * 10_000 == curve_cost * fee_bps` (with the remainder accounted for explicitly).
- Each share is checked by an equivalent cross-multiplication against the split bps.
- The sum of all claimed cuts (platform + creator + referral + remainder) is checked to equal `fee` exactly.

The security guarantee: any misreported parameter — whether an adversarial client trying to steal or a buggy client computing arithmetic wrong — causes the circuit to reject before the transaction can affect ledger state. [`tests/simulator/access_control.test.ts`](../tests/simulator/access_control.test.ts) runs falsification tests against each claim.

The practical consequence: **a broken TS client cannot corrupt chain state, only fail to submit.** There is no trust placed in the off-chain arithmetic except as a hint for what to verify.

## DR-1 deferred verification

The Task 3 DR-1 spike established that a contract using `receiveUnshielded`, `sendUnshielded`, and `nativeToken` compiles and deploys cleanly on preprod. The spike stopped short of a full end-to-end value-transfer probe because its `balanceTx` call omitted `tokenKindsToBalance: 'all'`, which produced substrate extrinsic error 192.

`src/night.ts` has since landed with the correct `tokenKindsToBalance: 'all'` configuration. The end-to-end value-transfer verification lives in [`tests/preprod/end_to_end.test.ts`](../tests/preprod/end_to_end.test.ts). Running that test under `MIDNIGHT_PREPROD_E2E=1` is the closing action for DR-1 and must pass before any mainnet discussion is reopened.

## Mainnet checklist gate

The environment variable `LUMPFUN_ALLOW_MAINNET=1` exists as a bypass for the hard-coded preprod assertion. It is **undocumented for end users** and must not be set until the checklist below is authored out and independently audited. In v0 the checklist is empty; flipping the bypass today means rolling dice with real funds.

Before a future mainnet rollout the following items must be populated and signed off:

- DUST economics verified against mainnet rates (trade cost, withdraw cost, sync cost).
- Proof-server policy decided (local per-user vs platform-sponsored remote prover) and the threat model documented for each choice.
- Indexer and ledger version compatibility verified against mainnet builds.
- Fee-immutability and recipient-immutability re-audited under mainnet ledger semantics (confirm no mainnet-specific ledger upgrade path bypasses constructor pinning).
- Upgrade story for when the Compact toolchain gains a `/` operator. The current caller-verifies pattern becomes unnecessary, and `buy`/`sell` signatures can be simplified. A clean migration plan is required because already-deployed contracts on mainnet will retain the old signatures; any client refactor must remain compatible with both.

Until every item above is closed, `LUMPFUN_ALLOW_MAINNET` stays undocumented. The plain reading is: if you set it in v0, you should assume you will lose funds.
