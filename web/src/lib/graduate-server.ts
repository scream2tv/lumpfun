// Server-only graduation pipeline. Runs the protocol's treasury wallet to:
//   Tx 1 — drain a graduated bonding curve UTxO via the Graduate redeemer
//          on our Aiken validator. All ADA + tokens land at the treasury wallet.
//   Tx 2 — create a Minswap V2 pool from the treasury wallet using Minswap's
//          official SDK. LP tokens to the creator (TODO: currently to treasury).
//
// Idempotent: each step is recorded in cardano-registry.json so that on retry
// we skip whatever already succeeded.
//
// Triggers (any of):
//   - POST /api/graduate            { policyId }   (called by curve poll)
//   - GET  /api/graduate/tick                       (cron / manual scan)

import 'server-only';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Lucid as LucidEv,
  Blockfrost as BlockfrostEv,
  Data,
  Constr,
  type LucidEvolution,
  type UTxO as UTxOEv,
} from '@lucid-evolution/lucid';
import type { TokenMeta } from './types';
import { computeGraduationQuote, type CurveStateBig } from './graduate-math';

const REGISTRY_PATH = join(process.cwd(), '..', 'cardano-registry.json');

// In-flight set: prevents two concurrent triggers from kicking off the same
// graduation twice (which would produce a double-spend conflict on Tx 1).
const inFlight = new Set<string>();

// ── Env ─────────────────────────────────────────────────────────────────────

function env() {
  const network    = (process.env.CARDANO_NETWORK ?? process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') as 'Mainnet' | 'Preprod';
  const projectId  = process.env.BLOCKFROST_PROJECT_ID ?? '';
  const seedPhrase = process.env.TREASURY_SEED ?? '';
  const baseUrl    = network === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0';
  if (!projectId)  throw new Error('BLOCKFROST_PROJECT_ID not set');
  if (!seedPhrase) throw new Error('TREASURY_SEED not set');
  return { network, projectId, seedPhrase, baseUrl };
}

// ── Registry helpers (atomic via promise queue) ─────────────────────────────

let registryQueue: Promise<void> = Promise.resolve();

async function readRegistry(): Promise<TokenMeta[]> {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as TokenMeta[];
  } catch { return []; }
}

async function patchRegistry(policyId: string, patch: Partial<TokenMeta>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    registryQueue = registryQueue.then(async () => {
      try {
        const list = await readRegistry();
        const idx  = list.findIndex(t => t.policyId === policyId);
        if (idx < 0) { resolve(); return; }
        list[idx] = { ...list[idx], ...patch };
        await writeFile(REGISTRY_PATH, JSON.stringify(list, null, 2));
        resolve();
      } catch (err) { reject(err); }
    });
  });
}

// ── Datum / redeemer codecs (must match cardano-tx.ts and Aiken validator) ──

function decodeCurveDatum(hex: string): CurveStateBig {
  const d = Data.from(hex) as Constr<bigint>;
  return { adaReserve: d.fields[0] as bigint, tokenReserve: d.fields[1] as bigint };
}

function encodeGraduateRedeemer(): string {
  return Data.to(new Constr(2, []));
}

// ── Tx 1 — drain curve to treasury ──────────────────────────────────────────

async function drainCurve(meta: TokenMeta): Promise<{ txHash: string; state: CurveStateBig }> {
  const { network, projectId, seedPhrase, baseUrl } = env();
  const lucid: LucidEvolution = await LucidEv(new BlockfrostEv(baseUrl, projectId), network);
  lucid.selectWallet.fromSeed(seedPhrase);

  const treasuryAddr = await lucid.wallet().address();
  const assetUnit    = `${meta.policyId}${meta.assetName}`;

  const utxos = await lucid.utxosAt(meta.curveAddress);
  const rawUtxo = utxos.find(u => u.assets[assetUnit] !== undefined);
  if (!rawUtxo || !rawUtxo.datum) {
    throw new Error('Curve UTxO not found at curve address — already drained?');
  }

  const state = decodeCurveDatum(rawUtxo.datum);

  // Reconstruct the explicit UTxO (Lucid Evolution inline-datum gotcha).
  const curveInput: UTxOEv = {
    txHash:      rawUtxo.txHash,
    outputIndex: rawUtxo.outputIndex,
    assets:      { lovelace: rawUtxo.assets.lovelace, [assetUnit]: rawUtxo.assets[assetUnit] },
    address:     meta.curveAddress,
    datum:       rawUtxo.datum,
    datumHash:   undefined,
    scriptRef:   undefined,
  };

  const validator = { type: 'PlutusV3' as const, script: meta.validatorCbor };

  const tx = await lucid
    .newTx()
    .collectFrom([curveInput], encodeGraduateRedeemer())
    .attach.SpendingValidator(validator)
    .pay.ToAddress(treasuryAddr, {
      lovelace:    rawUtxo.assets.lovelace,
      [assetUnit]: rawUtxo.assets[assetUnit],
    })
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  // Wait for confirmation so Tx 2 can spend the new treasury UTxO.
  await lucid.awaitTx(txHash);

  return { txHash, state };
}

// ── Tx 2 — create Minswap V2 pool from treasury wallet ─────────────────────

async function createPool(
  meta: TokenMeta,
  state: CurveStateBig,
): Promise<{ txHash: string; poolId: string; adaIn: bigint; tokensIn: bigint }> {
  const { network, projectId, seedPhrase, baseUrl } = env();
  // Use the curve's own graduation threshold if recorded — important when a
  // token was launched with a smaller test threshold (e.g. 5 ADA) so the
  // quote validation matches the on-chain validator.
  const threshold = meta.graduationAdaLovelace ? BigInt(meta.graduationAdaLovelace) : undefined;
  const quote = computeGraduationQuote(state, threshold);

  // Minswap SDK uses legacy Lucid (@spacebudz/lucid). Run it on its own instance
  // so it doesn't collide with our Lucid Evolution wallet in Tx 1.
  const sdk = await import('@minswap/sdk');
  const blockfrostJs = await import('@blockfrost/blockfrost-js');

  const networkId = network === 'Mainnet' ? sdk.NetworkId.MAINNET : sdk.NetworkId.TESTNET;

  // Get a temp address to bootstrap the SDK's legacy Lucid (it then accepts
  // the seed-derived wallet, which overrides the readonly address).
  const tmpLucid = await sdk.getBackendBlockfrostLucidInstance(
    networkId,
    projectId,
    baseUrl,
    // Placeholder address — `selectWalletFromSeed` overrides it. Use a known
    // burn address so the bootstrap doesn't fail name resolution.
    network === 'Mainnet'
      ? 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp'
      : 'addr_test1qpu5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5ewvxwdrt70qlcpeeagscasafhffqsxy36t90ldv06wqrk2qum8x5w',
  );
  // Legacy Lucid API: selectWalletFromSeed (camelCase, no `.wallet` namespace)
  tmpLucid.selectWalletFromSeed(seedPhrase);

  const blockFrostApi = new blockfrostJs.BlockFrostAPI({ projectId, network: network === 'Mainnet' ? 'mainnet' : 'preprod' });
  const adapter = new sdk.BlockfrostAdapter(networkId, blockFrostApi);
  const dex     = new sdk.DexV2(tmpLucid, adapter);

  const ADA_ASSET = { policyId: '', tokenName: '' };
  const tokenAsset = { policyId: meta.policyId, tokenName: meta.assetName };

  // 30 = 0.3% trading fee (Minswap V2 default)
  const txComplete = await dex.createPoolTx({
    assetA:               ADA_ASSET,
    assetB:               tokenAsset,
    amountA:              quote.adaForPool,
    amountB:              quote.tokensForPool,
    tradingFeeNumerator:  30n,
  });

  // Legacy Lucid: sign() is chainable, commit() finalises the witness set.
  const signed = await txComplete.sign().commit();
  const txHash = await signed.submit();
  await tmpLucid.awaitTx(txHash);

  return {
    txHash,
    poolId:   `${meta.policyId}${meta.assetName}`,
    adaIn:    quote.adaForPool,
    tokensIn: quote.tokensForPool,
  };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export async function runGraduation(meta: TokenMeta): Promise<{
  status: 'noop' | 'drained' | 'pool_created' | 'complete';
  drainTxHash?:  string;
  poolTxHash?:   string;
  error?:        string;
}> {
  // Already complete?
  if (meta.graduatedTxHash && meta.minswapPoolTxHash) return { status: 'noop' };

  if (inFlight.has(meta.policyId)) return { status: 'noop' };
  inFlight.add(meta.policyId);

  try {
    let state: CurveStateBig | null = null;
    let drainTxHash = meta.graduatedTxHash;

    // Step 1 — drain
    if (!drainTxHash) {
      const r = await drainCurve(meta);
      drainTxHash = r.txHash;
      state       = r.state;
      await patchRegistry(meta.policyId, {
        graduatedTxHash: drainTxHash,
        graduatedAt:     new Date().toISOString(),
      });
    }

    // Step 2 — pool. We need the curve state for the quote; if we just drained
    // we already have it; otherwise re-derive from the original on-chain datum
    // (which we no longer have access to). For now require state to be known.
    if (!meta.minswapPoolTxHash) {
      if (!state) {
        // Without state we can't compute the pool quote precisely. Best we can
        // do is resume from a partial state if the registry still has the last
        // known reserves. Skip silently and let manual recovery handle it.
        return {
          status:      'drained',
          drainTxHash,
          error:       'Drained but pool quote requires curve state — re-run while state is known.',
        };
      }
      const p = await createPool(meta, state);
      await patchRegistry(meta.policyId, {
        minswapPoolTxHash: p.txHash,
        minswapPoolId:     p.poolId,
        poolAdaLovelace:   p.adaIn.toString(),
        poolTokens:        p.tokensIn.toString(),
      });
      return { status: 'complete', drainTxHash, poolTxHash: p.txHash };
    }

    return { status: 'drained', drainTxHash };
  } catch (err) {
    return {
      status: 'noop',
      error:  err instanceof Error ? err.message : String(err),
    };
  } finally {
    inFlight.delete(meta.policyId);
  }
}

// ── Detection helper ────────────────────────────────────────────────────────

import { isGraduated } from './curve-math';

export async function findPendingGraduations(): Promise<TokenMeta[]> {
  const all = await readRegistry();
  return all.filter(t => !t.graduatedTxHash || !t.minswapPoolTxHash);
}

export { isGraduated };
