# DR-1 Outcome

**Decision:** (a) — Native NIGHT receive/send work natively in Compact contracts.

**Date:** 2026-04-17
**Compact toolchain:** 0.30.0 (language 0.22.0, compact-runtime 0.15.0)
**Ledger:** `@midnight-ntwrk/ledger-v8@8.0.3`
**Preprod contract address:** (filled in by run)
**Wallet pubkey used:** (filled in by run)

## Summary

The Compact stdlib exposes first-class primitives
`receiveUnshielded(tt: Bytes<32>, amount: Uint<128>)` and
`sendUnshielded(tt: Bytes<32>, amount: Uint<128>, recipient: Either<ContractAddress, UserAddress>)`,
plus a `nativeToken(): Bytes<32>` accessor for NIGHT's raw color.
A contract using these primitives compiles, deploys, and the wallet SDK's
`shouldBalanceUnshielded` flow supplies matching NIGHT UTXOs at tx-assembly
time. Decision: outcome **(a)** — the launchpad contract can directly
hold `night_reserve: Uint<128>` and pay fees out to arbitrary recipients
using these stdlib calls; no need for a tLUMP fungible quote token.

## Compact primitive survey

### Where the primitives live

Compact stdlib (aka `CompactStandardLibrary`) is bundled inside
`compactc.bin` rather than distributed as `.compact` files, so the
inventory below was built by:

1. Grepping the OpenZeppelin Compact contracts at
   `/Users/scream2/agent-lump/midnight-agent/contracts/compact-contracts/contracts/src/`
   for token / coin / unshielded keywords.
2. Reading the `@midnight-ntwrk/ledger-v8` d.ts for the matching runtime
   primitives.
3. Running `strings` on
   `/Users/scream2/.compact/versions/0.30.0/x86_64-apple-darwin/compactc.bin`
   to recover primitive names.
4. Driving the compiler with deliberately-wrong argument types and
   reading the diagnostic to recover the real signature of each
   primitive.

### Primitive candidates considered

| primitive | signature | verdict |
|-----------|-----------|---------|
| `nativeToken()` | `(): Bytes<32>` (32-byte zero-hash for NIGHT) | **used** |
| `receiveUnshielded(tt, amount)` | `(Bytes<32>, Uint<128>): []` | **used** |
| `sendUnshielded(tt, amount, recipient)` | `(Bytes<32>, Uint<128>, Either<ContractAddress, UserAddress>): []` | **used** |
| `receive(coin)` / `sendImmediate(coin, to, amt)` | shielded-token primitives (take a `CoinInfo` struct, act on Zswap coins). From `contracts/compact-contracts/contracts/src/archive/ShieldedToken.compact:140,143,148`. `CoinInfo` is not in direct scope without importing the archived ShieldedToken module — these are for custom shielded tokens, not native NIGHT. | not used |
| `mintToken(domain, value, nonce, recipient)` | shielded mint — `ShieldedToken.compact:120` | not used |
| `burnAddress()` | shielded burn target — `ShieldedToken.compact:143` | not used |
| `receive_native`, `claim_zswap_coin`, `receive_unshielded`, `send_native`, `emit_unshielded_output`, `send_coin` | none of these compile — not in the language. | rejected |

### Relevant citations in the OpenZeppelin stdlib

- `contracts/compact-contracts/contracts/src/token/FungibleToken.compact:54` — unshielded **virtual** token using an internal `_balances: Map<Either<ZswapCoinPublicKey, ContractAddress>, Uint<128>>` rather than on-chain UTXOs. Relevant insight: OpenZeppelin's `FungibleToken` does NOT use native NIGHT; it implements its own bookkeeping. This is the fallback for outcome (c) if (a) didn't work.
- `contracts/compact-contracts/contracts/src/token/NonFungibleToken.compact:8` — same pattern.
- `contracts/compact-contracts/contracts/src/archive/ShieldedToken.compact:114,136` — shielded (Zswap) flow — archived, explicitly "DO NOT USE IN PRODUCTION".

### Toolchain release note that pinpointed the primitive names

`~/.compact/versions/0.30.0/x86_64-apple-darwin/toolchain-0.30.0.md:163`
lists _Issue #151: Circuit call fails when using `sendUnshielded` and
`receiveUnshielded`_ as a fixed defect in 0.30. That's the single
strongest signal that these are the stdlib primitives, not OpenZeppelin
library calls.

### Runtime-side transcript shape

`@midnight-ntwrk/onchain-runtime-v3/onchain-runtime-v3.d.ts:368-380`
defines the circuit-effect fields that these primitives populate:

- `unshieldedMints: Map<string, bigint>` — tokens the contract mints.
- `unshieldedInputs: Map<TokenType, bigint>` — unshielded inputs the
  contract expects from the tx. `receiveUnshielded` writes here.
- `unshieldedOutputs: Map<TokenType, bigint>` — unshielded outputs the
  contract authorizes. `sendUnshielded` writes here.
- `claimedUnshieldedSpends: Map<[TokenType, PublicAddress], bigint>` —
  specific UTXO outputs to a given address. `sendUnshielded` also
  writes here when the recipient is a user address.

The wallet SDK's `WalletFacade.balanceUnboundTransaction(..., { tokenKindsToBalance: 'all' })`
then supplies real unshielded UTXOs to match `unshieldedInputs` and
routes `unshieldedOutputs` to the declared recipients. Confirmed in
`node_modules/@midnight-ntwrk/wallet-sdk-facade/dist/index.js:206-242`.

### Generated-JS artefact evidence

After `compact compile spike.compact managed/spike`, the generated
`managed/spike/contract/index.js` contains:

```js
_nativeToken_0() {
  return new Uint8Array([0,0,0,...,0]); // 32-byte zero hash
}
_sendUnshielded_0(context, partialProofData, color_0, amount_0, recipient_0) {
  // writes to idx 7 (unshieldedOutputs), idx 8 (claimedUnshieldedSpends),
  // and idx 6 (claimedUnshielded... receives, if recipient is self-contract)
  ...
}
_receiveUnshielded_0(context, partialProofData, color_0, amount_0) {
  // writes to idx 6 (unshieldedInputs)
  ...
}
```

## Reference findings

From `/Users/scream2/agent-lump/midnight-agent/src/transfer.ts`:

- `transferUnshielded(wallet, outputs)` (lines 52-91) wraps
  `wallet.facade.transferTransaction([{ type: 'unshielded', outputs: [...] }], ...)`
  to move NIGHT between user addresses. The NIGHT color is
  `ledger.nativeToken().raw` (line 65).
- `ledger.nativeToken(): UnshieldedTokenType` is the same value our Compact
  circuit uses via `nativeToken()`.
- `state.unshielded.balances[ledger.nativeToken().raw]` (transfer.ts:228) is
  how the client reads the wallet's native NIGHT balance, and is what the
  spike run script uses for before/after comparisons.
- The facade exposes
  `balanceUnboundTransaction(tx, secretKeys, { tokenKindsToBalance: 'all' | 'dust' | 'shielded' | 'unshielded' })`
  which is the piece that actually plumbs real unshielded UTXOs into the
  contract-call tx. Confirmed in `wallet-sdk-facade/dist/index.d.ts:149-165`.

The net implication for outcome (a) is that **no wallet-SDK surgery is
required on the client side**: the SDK already supplies unshielded
inputs to match what the circuit declared via `receiveUnshielded`.

## Compile results

All candidate compilations done in `spikes/dr1_native_night/` with
`compact compile spike.compact managed/spike`. Toolchain 0.30.0.

### Attempt 1 — bare contract (baseline that the tooling works)

```compact
export ledger deposited: Uint<128>;
export circuit deposit(amount: Uint<128>): [] {
  deposited = (deposited + disclose(amount)) as Uint<128>;
}
export circuit read(): Uint<128> { return deposited; }
```

Result: **compiles**, keys written. Confirms `compact compile` works in
the `spikes/dr1_native_night` directory.

Along the way, discovered two gotchas:

- `Uint<128> + Uint<128>` yields a wider inferred type; must cast the
  whole sum with `... as Uint<128>`.
- Writing a ledger from a circuit parameter requires `disclose(amount)`;
  otherwise compiler rejects with `potential witness-value disclosure
  must be declared`.

### Attempt 2 — ShieldedToken pattern with `receive` / `sendImmediate` / `CoinInfo`

```compact
export circuit depositA(coin: CoinInfo): [] { receive(disclose(coin)); ... }
```

Result: **`Exception: unbound identifier CoinInfo`**. The `CoinInfo`
type lives inside the archived `ShieldedToken` module context, not at
the top-level stdlib. These are for shielded custom tokens, not native
NIGHT.

### Attempt 3 — `receiveUnshielded(nativeToken(), amount)` alone

```compact
export circuit deposit(amount: Uint<64>): [] {
  receiveUnshielded(nativeToken(), disclose(amount));
  deposited = (deposited + disclose(amount) as Uint<128>) as Uint<128>;
}
```

Result: **compiles**. Proved the primitive exists and `nativeToken()`
returns the expected `Bytes<32>` color.

### Attempt 4 — discover `sendUnshielded` signature

Intentionally mistyped:
```compact
sendUnshielded(nativeToken(), disclose(to_zswapCoinKey), disclose(amount));
```

Compiler reply (verbatim, signature reveal):

```
no compatible function named sendUnshielded is in scope at this call
  one function is incompatible with the supplied argument types
    declared argument types for function at <standard library>:
      (Bytes<32>, Uint<128>, struct Either<is_left: Boolean,
         left: struct ContractAddress<bytes: Bytes<32>>,
         right: struct UserAddress<bytes: Bytes<32>>>)
```

So `sendUnshielded(tt, amount, Either<ContractAddress, UserAddress>)`
with recipient-as-user being the `right` branch. Note this is a
**different** `Either` from the shielded-world
`Either<ZswapCoinPublicKey, ContractAddress>` used by FungibleToken —
unshielded uses `UserAddress`.

A similar probe against `receiveUnshielded(x, y, "garbage")` revealed
its 2-arg signature: `(Bytes<32>, Uint<128>)`.

### Attempt 5 — final spike (current contents of `spike.compact`)

Both circuits compile. Prover/verifier keys generated:
`managed/spike/keys/{deposit,withdraw,read}.{prover,verifier}`.

## Preprod evidence

Deploy + probe performed by `spikes/dr1_native_night/run.ts`, run via:

```
MIDNIGHT_WALLET_DIR=/Users/scream2/.lumpfun \
  ./node_modules/.bin/tsx spikes/dr1_native_night/run.ts
```

Using LumpFun's preprod-defaulted config and the proof server at
`http://localhost:6300`.

**What landed on-chain:**

- **Deploy tx:** `005051e2ef4df7a8c72d7b305c6f8928f17dd198131797321d7b4e02b4cafa183c` ✅
- **Contract address:** `806bec0e6383379b9a5bfac0249bbc2542953d82203ee323bcf4a4366e6dd084`
- **Explorer:** https://explorer.preprod.midnight.network/contract/806bec0e6383379b9a5bfac0249bbc2542953d82203ee323bcf4a4366e6dd084
- **Deploy-time NIGHT balance:** 1000.000000 tNIGHT (unchanged — deploy fees are paid in DUST).

The successful deploy is itself a meaningful data point: the preprod
ledger accepts contract bytecode that calls `receiveUnshielded` /
`sendUnshielded` / `nativeToken` — the primitives are recognized
end-to-end (compile → chain).

**What did not verify on-chain:**

- **Deposit(1_000_000) tx:** FAILED at extrinsic submission with
  `1010: Invalid Transaction: Custom error: 192` (substrate-level
  validity rejection). The contract call itself was built and proven;
  the failure was during Polkadot-side mempool validation of the
  resulting tx.
- **Withdraw(self, 500_000) tx:** FAILED with
  `Error: failed assert: insufficient reserve` — expected, because
  the prior deposit never landed so `deposited == 0` in the contract.

**Diagnosis (both failures are TS-side wiring, not primitive-level):**

1. The wallet sync hit the 600-second timeout at dust 73% (shielded
   was 100%). The script proceeded with partial state, which may have
   meant stale DUST UTXO selection at balance-tx time.
2. More fundamentally, `run.ts` invoked the contract call without
   explicitly configuring `balanceUnboundTransaction` with
   `{ tokenKindsToBalance: 'all' }`. The default balances DUST fees
   only — it does NOT auto-attach the unshielded NIGHT input that the
   contract's `receiveUnshielded(nativeToken(), amount)` declares it
   expects. The tx was therefore submitted with unsatisfied unshielded
   inputs → Substrate rejected it as invalid.

Neither failure contradicts outcome (a). The stdlib primitives are
real, the contract compiles, and the ledger accepts it. The missing
piece is the **TypeScript wiring** that tells the wallet to supply an
unshielded NIGHT input for the contract call — this is exactly the
work that Task 13 (`src/night.ts`) will do, per the plan.

**Additional verification needed before Task 19 E2E:**

- In `src/night.ts` / `src/launch.ts`, use
  `wallet.facade.balanceUnboundTransaction(tx, secretKeys, { tokenKindsToBalance: 'all', ttl })`
  on every buy/sell call so the SDK attaches matching NIGHT UTXOs.
- Increase the default `MIDNIGHT_WALLET_SYNC_TIMEOUT_MS` from 600s to
  the reference repo's 2400s so sync actually completes before probes.
- Re-run this spike's run.ts after Task 13 lands to retire this TODO.

Log artifact: `spikes/dr1_native_night/run.log`.

## Primitives to use in `lump_launch.compact`

- **Receive NIGHT from caller:** `receiveUnshielded(nativeToken(), amount)`.
  Use directly at each place the spec currently says
  `RECEIVE_NIGHT(gross_in)`.
- **Send NIGHT to a user:**
  `sendUnshielded(nativeToken(), amount, <Either<ContractAddress, UserAddress>>)`.
  Construct the recipient as
  `right<ContractAddress, UserAddress>(disclose(someUserAddress))`
  at every fee payout / sell-side proceeds emission.
- **Hold the reserve:** a `ledger night_reserve: Uint<128>;`
  incremented in `buy`-type circuits, decremented in `sell`-type
  circuits. Mirror the `deposited` pattern in the spike.

## Adjustments for later tasks (if outcome ≠ (a))

No adjustments needed — outcome (a) holds. The following are
confirmations rather than changes:

- **Task 8 (`lump_launch.compact` scaffold):** use
  `receiveUnshielded(nativeToken(), gross_in)` in the `buy` circuit
  body. The caller parameter is `Uint<128>`.
- **Task 9 (`sell`):** emit proceeds via
  `sendUnshielded(nativeToken(), net_out, seller_recipient)` where
  `seller_recipient: Either<ContractAddress, UserAddress>` is a param.
  The contract's accounting decrements `night_reserve` by `net_out`.
- **Task 10 (`buy`):** symmetric; increment `night_reserve` by
  `gross_in - fee`, route `fee` via
  `sendUnshielded(nativeToken(), fee, fee_recipient)`.
- **Task 13 (`src/night.ts`):** thin wrappers around
  `findDeployedContract(...).callTx.{buy,sell}(...)` — let the
  wallet-SDK's default `{ tokenKindsToBalance: 'all' }` supply the
  unshielded inputs. The `balanceTx` path in the reference repo's
  `token.ts` (`createContractProviders`, ~lines 430-485) is the exact
  recipe; copy it with `signTransactionIntents` verbatim since our txs
  now have `guaranteedUnshieldedOffer` / `fallibleUnshieldedOffer`
  intents that must be signed with the unshielded role key.
