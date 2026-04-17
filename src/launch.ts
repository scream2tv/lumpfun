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
 * Binds to an already-deployed `lump_launch` contract at `contractAddress`
 * and returns a `LaunchHandle` populated from the on-chain ledger state.
 */
export async function connectLaunch(
  wallet: InitializedWallet,
  contractAddress: string,
): Promise<LaunchHandle> {
  assertPreprod();

  const { compiledContract, mod } = await loadAndWrapCompiledContract();
  const providers = await createContractProviders(wallet, LUMP_LAUNCH_DIR);

  // We call findDeployedContract for its side effects (verifier-key check,
  // signing-key bookkeeping, private-state slot init) even though for the
  // immediate read we go through the public-data provider. This matches
  // what the reference's `connectToken` does and ensures subsequent mutating
  // calls from Task 15/16 can find the expected local state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await findDeployedContract(providers as any, {
    compiledContract,
    contractAddress: contractAddress as ContractAddress,
    privateStateId: 'launchState',
    initialPrivateState: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

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
