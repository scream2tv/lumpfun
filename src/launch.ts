/**
 * Launch domain API — a clean wrapper over the compiled `lump_launch` contract.
 *
 * This module exposes `deployLaunch`, `connectLaunch`, and state-read helpers
 * that translate the compiled contract's raw Compact shapes (Uint8Array keys,
 * bigint numerics, map lookups) into the domain types used by the rest of
 * the launchpad (hex strings for addresses, bigints for amounts, plain
 * numbers for bps fields).
 *
 * buy/sell/transfer wrappers will be added in Task 15; withdraw_* wrappers
 * in Task 16. This file is deploy + connect + reads only.
 *
 * IMPORTANT: `curve_quote_buy` / `curve_quote_sell` return 2× the true value
 * (Compact 0.22 workaround) — callers that invoke those view circuits must
 * halve client-side. `connectLaunch` itself only reads scalar immutables
 * and live state, so no halving is needed here.
 */

import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  deployContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { assertPreprod, explorerLink } from './config.js';
import { curveCostBuy, curvePayoutSell } from './curve.js';
import { computeFeeSplit } from './fees.js';
import { createContractProviders } from './night.js';
import type { InitializedWallet } from './wallet.js';

// ─── Public domain types ─────────────────────────────────────────────────

export interface LaunchMetadata {
  name: string;
  symbol: string;
  decimals: number;
  imageUri: string;
  creatorPubkey: string; // hex
}

export interface CurveParams {
  basePriceNight: bigint;
  slopeNight: bigint;
  maxSupply: bigint;
}

export interface FeeConfig {
  feeBps: number;
  platformShareBps: number;
  creatorShareBps: number;
  referralShareBps: number;
  platformRecipient: string; // hex ZswapCoinPublicKey (32-byte)
  creatorRecipient: string; // hex
}

export interface LiveState {
  tokensSold: bigint;
  nightReserve: bigint;
  platformAccrued: bigint;
  creatorAccrued: bigint;
}

export interface LaunchHandle {
  contractAddress: string;
  metadata: LaunchMetadata;
  curve: CurveParams;
  fees: FeeConfig;
  state: LiveState;
  explorerUrl: string;
}

export interface LaunchDeployParams {
  metadata: Omit<LaunchMetadata, 'creatorPubkey'>;
  curve: CurveParams;
  fees: FeeConfig;
}

// ─── Internal helpers ────────────────────────────────────────────────────

// Absolute path to the compiled `lump_launch` managed dir, resolved relative
// to this source file so it works regardless of the caller's cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LUMP_LAUNCH_DIR = resolve(
  __dirname,
  '../contracts/managed/lump_launch',
);

/**
 * Minimal structural type for the parts of the generated contract module we
 * use. Matches the shape emitted by `compact compile` into
 * `contracts/managed/lump_launch/contract/index.js`.
 */
interface CompiledModule {
  // The `Contract` class — constructed with a witnesses record (here `{}`).
  Contract: new (witnesses: Record<string, unknown>) => unknown;
  // Parses a ContractState (or ChargedState) into the typed Ledger view.
  ledger: (state: unknown) => LedgerShape;
}

/**
 * Subset of the generated `Ledger` type we read from. The full list of
 * fields is declared in
 * `contracts/managed/lump_launch/contract/index.d.ts`.
 */
interface LedgerShape {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: bigint;
  readonly image_uri: string;
  readonly creator_pubkey: Uint8Array;
  readonly base_price_night: bigint;
  readonly slope_night: bigint;
  readonly max_supply: bigint;
  readonly fee_bps: bigint;
  readonly platform_share_bps: bigint;
  readonly creator_share_bps: bigint;
  readonly referral_share_bps: bigint;
  readonly platform_recipient: Uint8Array;
  readonly creator_recipient: Uint8Array;
  readonly tokens_sold: bigint;
  readonly night_reserve: bigint;
  readonly platform_accrued: bigint;
  readonly creator_accrued: bigint;
  referrals_accrued: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): bigint;
  };
  balances: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): bigint;
  };
}

async function loadCompiledModule(): Promise<CompiledModule> {
  const url = pathToFileURL(`${LUMP_LAUNCH_DIR}/contract/index.js`).href;
  return (await import(url)) as CompiledModule;
}

/**
 * Build a `CompiledContract` wrapper around the generated `Contract` class,
 * with vacant witnesses (the launchpad has no private state / witnesses) and
 * the compiled-assets path pointing at the managed dir.
 *
 * Typed loosely here because the generated module's TS types don't fit the
 * `@midnight-ntwrk/compact-js` effect-based `Contract<PS>` interface exactly
 * — the real wallet SDK path needs `any` at the seam to satisfy the generic
 * bounds used by `deployContract` / `findDeployedContract`.
 */
async function loadAndWrapCompiledContract(): Promise<{
  compiledContract: unknown;
  mod: CompiledModule;
}> {
  const mod = await loadCompiledModule();
  const compiledContract = buildCompiled(mod);
  return { compiledContract, mod };
}

function buildCompiled(mod: CompiledModule): unknown {
  // The effect-based `CompiledContract.make` requires a `Contract<PS>` type.
  // Our generated class satisfies the runtime shape but not TS's structural
  // subtyping against the `effect/Contract.Contract<PS>` generic, so we
  // funnel through `any` here — this is the standard pattern for the
  // TS-wrapper-over-generated-JS seam.
  //
  // The `pipe` / `withVacantWitnesses` / `withCompiledFileAssets` chain uses
  // heavy Effect-module generics that don't resolve cleanly for a hand-rolled
  // generated `Contract` class, so we widen to `any` at the boundary and let
  // the runtime behavior match the reference's `src/token.ts` wiring.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const make = CompiledContract.make as unknown as (tag: string, ctor: unknown) => any;
  const withVacant = CompiledContract.withVacantWitnesses as unknown as (
    s: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => any;
  const withAssets = CompiledContract.withCompiledFileAssets as unknown as (
    p: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => (s: unknown) => any;

  return make('lump_launch', mod.Contract).pipe(
    withVacant,
    withAssets(LUMP_LAUNCH_DIR),
  );
}

/**
 * Fetch the on-chain contract state and parse it into the typed Ledger view
 * using the compiled module's `ledger(...)` helper.
 *
 * We use the public-data provider directly (rather than `callTx.someView()`)
 * because the Compact view circuits on 0.30 still require the view-call to be
 * modeled as a tx-with-zk-proof at the wallet-SDK layer — for simple reads
 * of immutable + scalar ledger fields, the public state suffices and is
 * cheaper.
 */
async function readLedger(
  providers: Awaited<ReturnType<typeof createContractProviders>>,
  contractAddress: string,
  mod: CompiledModule,
): Promise<LedgerShape> {
  const publicState = await providers.publicDataProvider.queryContractState(
    contractAddress as ContractAddress,
  );
  if (!publicState) {
    throw new Error(
      `No contract state found at address ${contractAddress} — is it deployed on preprod?`,
    );
  }
  // ContractState.data is a ChargedState; the generated `ledger` accepts
  // both StateValue and ChargedState (see its d.ts).
  return mod.ledger((publicState as { data: unknown }).data);
}

function ledgerToHandle(
  contractAddress: string,
  ledger: LedgerShape,
): LaunchHandle {
  return {
    contractAddress,
    metadata: {
      name: ledger.name,
      symbol: ledger.symbol,
      decimals: Number(ledger.decimals),
      imageUri: ledger.image_uri,
      creatorPubkey: Buffer.from(ledger.creator_pubkey).toString('hex'),
    },
    curve: {
      basePriceNight: ledger.base_price_night,
      slopeNight: ledger.slope_night,
      maxSupply: ledger.max_supply,
    },
    fees: {
      feeBps: Number(ledger.fee_bps),
      platformShareBps: Number(ledger.platform_share_bps),
      creatorShareBps: Number(ledger.creator_share_bps),
      referralShareBps: Number(ledger.referral_share_bps),
      platformRecipient: Buffer.from(ledger.platform_recipient).toString('hex'),
      creatorRecipient: Buffer.from(ledger.creator_recipient).toString('hex'),
    },
    state: {
      tokensSold: ledger.tokens_sold,
      nightReserve: ledger.night_reserve,
      platformAccrued: ledger.platform_accrued,
      creatorAccrued: ledger.creator_accrued,
    },
    explorerUrl: explorerLink(`/contract/${contractAddress}`),
  };
}

function hexToBytes32(hex: string, label: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) {
    throw new Error(
      `${label} must be 32 bytes (64 hex chars); got ${clean.length} hex chars`,
    );
  }
  return Buffer.from(clean, 'hex');
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Deploys a new `lump_launch` contract with the given params.
 *
 * The deployer's shielded `coinPublicKey` is used as the on-chain
 * `creator_pubkey` (embedded immutably in the contract state) — callers
 * wanting a different creator identity must swap wallets before calling.
 *
 * Returns a `LaunchHandle` hydrated via `connectLaunch` — one extra
 * `queryContractState` roundtrip, but it keeps deploy/connect returning the
 * same shape and verifies the deployment landed.
 */
export async function deployLaunch(
  wallet: InitializedWallet,
  params: LaunchDeployParams,
): Promise<LaunchHandle> {
  assertPreprod();

  const { compiledContract } = await loadAndWrapCompiledContract();
  const providers = await createContractProviders(wallet, LUMP_LAUNCH_DIR);

  const creatorPubkey = Buffer.from(
    wallet.keys.shielded.keys.coinPublicKey,
    'hex',
  );
  const platformRecipient = hexToBytes32(
    params.fees.platformRecipient,
    'fees.platformRecipient',
  );
  const creatorRecipient = hexToBytes32(
    params.fees.creatorRecipient,
    'fees.creatorRecipient',
  );

  // Constructor arg order, matching `lump_launch.compact::initialState`:
  //   name_, symbol_, decimals_, image_uri_, creator_,
  //   base_price_, slope_, max_supply_,
  //   fee_bps_, p_bps_, c_bps_, r_bps_,
  //   platform_recip_, creator_recip_
  const args = [
    params.metadata.name,
    params.metadata.symbol,
    BigInt(params.metadata.decimals),
    params.metadata.imageUri,
    creatorPubkey,
    params.curve.basePriceNight,
    params.curve.slopeNight,
    params.curve.maxSupply,
    BigInt(params.fees.feeBps),
    BigInt(params.fees.platformShareBps),
    BigInt(params.fees.creatorShareBps),
    BigInt(params.fees.referralShareBps),
    platformRecipient,
    creatorRecipient,
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deployed = await deployContract(providers as any, {
    compiledContract,
    privateStateId: 'launchState',
    initialPrivateState: {},
    args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const contractAddress = (
    deployed as { deployTxData: { public: { contractAddress: string } } }
  ).deployTxData.public.contractAddress;

  return connectLaunch(wallet, contractAddress);
}

/**
 * Lower-level helper: bind to an already-deployed `lump_launch` contract
 * and return the raw `FoundContract` object (the thing with `.callTx`) along
 * with the providers + compiled module. Task 15's `buy`/`sell`/`transfer`
 * wrappers call this to invoke circuits; `connectLaunch` wraps it and
 * projects the result through `readLedger`/`ledgerToHandle`.
 *
 * Keeping this private (non-exported) for now — callers only need the
 * high-level `LaunchHandle` API. Promote to exported if external consumers
 * emerge.
 */
async function loadContractHandle(
  wallet: InitializedWallet,
  contractAddress: string,
): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contract: any;
  providers: Awaited<ReturnType<typeof createContractProviders>>;
  mod: CompiledModule;
}> {
  const { compiledContract, mod } = await loadAndWrapCompiledContract();
  const providers = await createContractProviders(wallet, LUMP_LAUNCH_DIR);

  // We call findDeployedContract for its side effects (verifier-key check,
  // signing-key bookkeeping, private-state slot init) and for access to the
  // returned `callTx` interface used by the action wrappers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract = await findDeployedContract(providers as any, {
    compiledContract,
    contractAddress: contractAddress as ContractAddress,
    privateStateId: 'launchState',
    initialPrivateState: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return { contract, providers, mod };
}

/**
 * Binds to an already-deployed `lump_launch` contract at `contractAddress`
 * and returns a `LaunchHandle` populated from the on-chain ledger state.
 */
export async function connectLaunch(
  wallet: InitializedWallet,
  contractAddress: string,
): Promise<LaunchHandle> {
  assertPreprod();
  const { providers, mod } = await loadContractHandle(wallet, contractAddress);
  const ledger = await readLedger(providers, contractAddress, mod);
  return ledgerToHandle(contractAddress, ledger);
}

/**
 * Thin helper over `connectLaunch` that returns only the live scalar state.
 * Callers wanting fresh reserves/accrued balances call this rather than
 * re-using a cached `LaunchHandle`.
 */
export async function getLaunchState(
  wallet: InitializedWallet,
  contractAddress: string,
): Promise<LiveState> {
  assertPreprod();
  const handle = await connectLaunch(wallet, contractAddress);
  return handle.state;
}

/**
 * Reads the amount of NIGHT accrued to the given referrer address (as 32-byte
 * hex) from the `referrals_accrued` map. Returns 0n if the address has no
 * entry in the map.
 */
export async function getReferralAccrued(
  wallet: InitializedWallet,
  contractAddress: string,
  ref: string,
): Promise<bigint> {
  assertPreprod();

  const { mod } = await loadAndWrapCompiledContract();
  const providers = await createContractProviders(wallet, LUMP_LAUNCH_DIR);

  const ledger = await readLedger(providers, contractAddress, mod);
  const key = hexToBytes32(ref, 'ref');
  return ledger.referrals_accrued.member(key)
    ? ledger.referrals_accrued.lookup(key)
    : 0n;
}

// ─── Task 15: buy / sell / transfer + quote helpers ─────────────────────

/**
 * A caller-computed quote for a `buy` or `sell`. The `split` values are the
 * POST-routing fee shares (i.e., when `referralPresent=false`, the referral
 * cut has already been folded into `platform`) — this matches what the
 * on-chain `platform_accrued` / `creator_accrued` / `referrals_accrued` will
 * end up holding after the call lands, so it's the right shape for display
 * and verification.
 *
 * The RAW (pre-routing) cuts — which the `buy`/`sell` circuits actually
 * consume — are computed separately by `rawCutsForCircuit` and are not
 * surfaced to callers; they're an implementation detail of the wrapper.
 */
export interface TradeQuote {
  curveSide: bigint; // curve_cost (buy) or curve_payout (sell)
  fee: bigint;
  split: { platform: bigint; creator: bigint; referral: bigint };
  grossPayByBuyer?: bigint; // buys only: curveSide + fee
  netReceivedBySeller?: bigint; // sells only: curveSide - fee
}

/**
 * Computes a buy quote off-chain using the same formulas the circuit
 * enforces. `referralPresent` controls the routed split: when false, the
 * referral cut flows into `platform` (matching the chain's behavior when
 * `has_referral=false`).
 */
export function quoteBuy(
  launch: LaunchHandle,
  nTokens: bigint,
  referralPresent = false,
): TradeQuote {
  const curveCost = curveCostBuy(
    launch.state.tokensSold,
    nTokens,
    launch.curve.basePriceNight,
    launch.curve.slopeNight,
  );
  const { fee, split } = computeFeeSplit({
    curveSide: curveCost,
    feeBps: launch.fees.feeBps,
    platformShareBps: launch.fees.platformShareBps,
    creatorShareBps: launch.fees.creatorShareBps,
    referralShareBps: launch.fees.referralShareBps,
    referralPresent,
  });
  return {
    curveSide: curveCost,
    fee,
    split,
    grossPayByBuyer: curveCost + fee,
  };
}

/**
 * Computes a sell quote off-chain. `launch.state.tokensSold` is passed as
 * `tokensSoldBefore`; `curvePayoutSell` handles the `tokens_sold - n`
 * subtraction internally to yield the integral over the range vacated by
 * the sell.
 */
export function quoteSell(
  launch: LaunchHandle,
  nTokens: bigint,
  referralPresent = false,
): TradeQuote {
  const curvePayout = curvePayoutSell(
    launch.state.tokensSold,
    nTokens,
    launch.curve.basePriceNight,
    launch.curve.slopeNight,
  );
  const { fee, split } = computeFeeSplit({
    curveSide: curvePayout,
    feeBps: launch.fees.feeBps,
    platformShareBps: launch.fees.platformShareBps,
    creatorShareBps: launch.fees.creatorShareBps,
    referralShareBps: launch.fees.referralShareBps,
    referralPresent,
  });
  return {
    curveSide: curvePayout,
    fee,
    split,
    netReceivedBySeller: curvePayout - fee,
  };
}

/**
 * Computes the RAW (pre-routing) fee cuts the `buy`/`sell` circuits expect.
 * The circuit re-derives these with the same floor-division formulas and
 * rejects the tx if any value disagrees; callers MUST use these exact
 * values (not the post-routing `TradeQuote.split`) when building the tx.
 *
 * Kept internal — callers should not need to see the raw shape.
 */
function rawCutsForCircuit(
  launch: LaunchHandle,
  curveSide: bigint,
): {
  fee: bigint;
  p: bigint;
  c: bigint;
  r: bigint;
  remainder: bigint;
} {
  const fee = (curveSide * BigInt(launch.fees.feeBps)) / 10000n;
  const p = (fee * BigInt(launch.fees.platformShareBps)) / 10000n;
  const c = (fee * BigInt(launch.fees.creatorShareBps)) / 10000n;
  const r = (fee * BigInt(launch.fees.referralShareBps)) / 10000n;
  const remainder = fee - p - c - r;
  return { fee, p, c, r, remainder };
}

/**
 * Buys `nTokens` of the launch's token from the bonding curve. Caller pays
 * `quote.grossPayByBuyer = curveCost + fee` in NIGHT; the fee is split
 * across platform / creator / referral per the launch's config.
 *
 * The `referral` arg (if provided) is a 32-byte-hex ZswapCoinPublicKey that
 * gets credited with the referral share of the fee; when absent, that share
 * routes to platform.
 */
export async function buy(
  wallet: InitializedWallet,
  launch: LaunchHandle,
  nTokens: bigint,
  referral?: string,
): Promise<{ txId: string; quote: TradeQuote }> {
  assertPreprod();

  const quote = quoteBuy(launch, nTokens, referral !== undefined);
  const raw = rawCutsForCircuit(launch, quote.curveSide);

  const buyer = hexToBytes32(
    wallet.keys.shielded.keys.coinPublicKey,
    'wallet.coinPublicKey',
  );
  const hasReferral = referral !== undefined;
  const refBytes = hasReferral
    ? hexToBytes32(referral!, 'referral')
    : new Uint8Array(32);

  const { contract } = await loadContractHandle(wallet, launch.contractAddress);
  // `callTx` is strongly typed on `FoundContract<C>`, but `C` here is the
  // widened-to-any `unknown` contract we fed through buildCompiled — so we
  // narrow at the seam. The arg order matches `Circuits<PS>.buy(...)` in
  // `contracts/managed/lump_launch/contract/index.d.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = await (contract.callTx as any).buy(
    buyer,
    nTokens,
    quote.curveSide,
    raw.fee,
    raw.p,
    raw.c,
    raw.r,
    raw.remainder,
    hasReferral,
    refBytes,
  );

  return { txId: tx.public.txId, quote };
}

/**
 * Sells `nTokens` back to the bonding curve. Caller receives
 * `quote.netReceivedBySeller = curvePayout - fee` in NIGHT; the fee is
 * split the same way as on buy.
 */
export async function sell(
  wallet: InitializedWallet,
  launch: LaunchHandle,
  nTokens: bigint,
  referral?: string,
): Promise<{ txId: string; quote: TradeQuote }> {
  assertPreprod();

  const quote = quoteSell(launch, nTokens, referral !== undefined);
  const raw = rawCutsForCircuit(launch, quote.curveSide);

  const seller = hexToBytes32(
    wallet.keys.shielded.keys.coinPublicKey,
    'wallet.coinPublicKey',
  );
  const hasReferral = referral !== undefined;
  const refBytes = hasReferral
    ? hexToBytes32(referral!, 'referral')
    : new Uint8Array(32);

  const { contract } = await loadContractHandle(wallet, launch.contractAddress);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = await (contract.callTx as any).sell(
    seller,
    nTokens,
    quote.curveSide,
    raw.fee,
    raw.p,
    raw.c,
    raw.r,
    raw.remainder,
    hasReferral,
    refBytes,
  );

  return { txId: tx.public.txId, quote };
}

/**
 * Transfers `amount` of the launch's token from the wallet's address to
 * `to`. The `from` address is derived from the wallet's shielded coin
 * pubkey; callers wanting to transfer from a different identity must swap
 * wallets first.
 */
export async function transfer(
  wallet: InitializedWallet,
  launch: LaunchHandle,
  to: string,
  amount: bigint,
): Promise<{ txId: string }> {
  assertPreprod();

  const from = hexToBytes32(
    wallet.keys.shielded.keys.coinPublicKey,
    'wallet.coinPublicKey',
  );
  const toBytes = hexToBytes32(to, 'to');

  const { contract } = await loadContractHandle(wallet, launch.contractAddress);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = await (contract.callTx as any).transfer(from, toBytes, amount);

  return { txId: tx.public.txId };
}
