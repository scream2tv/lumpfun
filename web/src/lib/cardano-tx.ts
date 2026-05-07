'use client';

// Browser-compatible Cardano tx builder.
// Mirrors src/cardano/launch.ts + trade.ts but initialised with a CIP-30 wallet API.

import {
  Lucid,
  Blockfrost,
  applyDoubleCborEncoding,
  applyParamsToScript,
  mintingPolicyToId,
  validatorToAddress,
  getAddressDetails,
  fromText,
  Data,
  Constr,
} from '@lucid-evolution/lucid';
import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid';
import type { Cip30Api } from './wallet';
import { quoteBuy as mathQuoteBuy, quoteSellGross as mathQuoteSellGross } from './curve-math';

// ── Script CBORs (from contracts/cardano/plutus.json) ─────────────────────────

const BONDING_CURVE_CBOR =
  '59063501010022222229800aba2aba1aba0aab9faab9eaab9dab9a9bae0079bae0069bad0059bae0049bae0039bad002488888888888896600264653001300e00198071807800cdc3a4005300e00248889660026004601c6ea800e33001300f3754007370e90024dc3a4001300e375400891111991192cc004c01401226464b3001301c002801c590191bad301a00130163754017159800980480244c8c96600260380050038b2032375a6034002602c6ea802e2b300130060048acc004c058dd5005c0062c80ba2c80a101420281598009802180a1baa001899912cc004c018c058dd5000c660026034602e6ea8006602c6ea803244646600200200644b30010018a5eb8226644b3001300500289980f80119802002000c4cc01001000501b180f000980f800a0389180d980e180e000c8966002601060306ea800a264646644b30013021003802c5901e1bad301e001375a603c004603c00260326ea800a2c80ba4446466446600400400244b3001001801c4c8c96600266e440180062b30013371e00c0031375a603e0050054075133004004302300340746eb8c074004c08000501e191919800800803112cc004006007132325980099b910080018acc004cdc7804000c4dd59810001401501e44cc010010c09000d01e1bae301e0013021001407c297adef6c601480024603660380029111111191919912cc004c04402a2646644b30013029002899192cc004c05cc098dd5000c4c8cc0340044cc88cc896600266e200100922b3001337109000001456600266e1c004c8cdc080219b833370400200866e0000400ccdc000224101f1055a2d15980099b890080018acc004cdc398071bab300f302c375400e66e00c038dd5980798161baa300f302c375402a00515980099b8798009bab300f302c375400f02981420203370330013756601e60586ea8c03cc0b0dd500ac0a605080800062b30013300c3758602460586ea807809a330013758602460586ea807a04b002813a0168a5040a914a08152294102a452820548a5040a914a08152294102a19b81375a605a60546ea800c008cdc08009bad300d302a37540066eb4c0acc0a0dd50099bad300b302837540266054604e6ea80062c8128c030c098dd50009814001459026198051bac30093023375402a466ebcc09cc090dd50008011bad302630233754030604a60446ea8c014c088dd5005c566002602a015132332259800981480144c8c966002602e604c6ea80062646601a002266446644b30013371000804915980099b884800000a2b30013370e0026464b30013371000c00310068800a0583370200266e0ccdc100080219b800040033370000890407c41568b456600266e24020cdc019b810013370666e0800409d20a09c01483fe21ea2b30013370e601c6eacc03cc0b0dd500399b81300e3756601e60586ea8c03cc0b0dd500a800c56600266e1e60026eacc03cc0b0dd5003c0a60508080cdc04c004dd5980798161baa300f302c375402b02981420200028acc004cc030dd6180918161baa01e0268cc004dd6180918161baa01e812c00604e805a294102a452820548a5040a914a08152294102a452820548a5040a866e04dd6980698151baa003001337020046eb4c0b4c0a8dd50019bad302b302837540266eb4c02cc0a0dd5009981518139baa0018b204a300c302637540026050005164098660146eb0c024c08cdd500a919baf3027302437540020046eb4c098c08cdd500c181298111baa3005302237540171337120346eb4c094c088dd5006a0404080453001002800d2080897a400c444464b300130140018a518cc00401600900140188118cdc199b82002001482827004888c8cc004004010896600200314a115980099192cc004c054c094dd5000c56600266e3cdd7181498131baa001006899b89005300837566012604c6ea800a2941024456600266e3cdd7181498131baa001006899b89005300837566012604c6ea800a294102420483028302537546050604a6ea8004c09c00629462660040046050002811102514c00400691100a44100400c8b202a30183015375400264660020026eb0c064c058dd5004112cc004006298103d87a80008992cc004cdd7980d980c1baa001005899ba548000cc0680052f5c1133003003301c0024058603400280c22c8098c058010c058c05c011164034300e0013009375401d149a26cac80381';

const MINTING_POLICY_CBOR =
  '5887010100229800aba2aba1aab9faab9eaab9dab9a48888896600264646644b30013370e900018031baa00189991198008009bac300b30093754601600c6eb8c024c01cdd5000912cc00400629422b30013375e601660126ea8c02c00403a29462660040046018002803900a459005180380098039804000980380098019baa0078a4d13656400401';

// Per-launch creator fee accumulator (PlutusV3). Parameterised with
// creator_pkh. Trades route the creator's rev-share to this script
// address; the creator sweeps periodically to keep their wallet from
// fragmenting across hundreds of dust UTxOs.
const FEE_ACCUMULATOR_CBOR =
  '589f010100229800aba2aba1aab9faab9eaab9dab9a9bae002488888896600264646644b30013370e900118039baa0018994c004c02c006601660180032259800800c528456600266e3cdd718068008044528c4cc008008c03800500920184888cc004004dd618071807980798079807980798079807980798061baa300e00818041baa0018b200c300800130083009001300800130043754011149a26cac80101';

// Vesting timelock validator (PlutusV3). Parameterised at deploy time with
// (creator_pkh, unlock_posix_ms). Spend rule: tx must be signed by
// creator_pkh AND tx.validity_range.lower_bound >= unlock_posix_ms.
const VESTING_CBOR =
  '58ed0101002229800aba2aba1aab9faab9eaab9dab9a9bae0039bad0024888888896600264653001300900198049805000cc0240092225980099b8748008c024dd500144c8cc896600264660020026eb0c040c044c044c044c044c044c044c044c044c038dd5002912cc00400629422b30013371e6eb8c04400403229462660040046024002806901044c96600266e1d2002300d37540031337120146eb4c040c038dd5000c5282018300f300d3754601e601a6ea8c03cc040c040c040c040c040c040c040c034dd500245282016300d001300d300e001300a3754005164020300900130053754013149a26cac8019';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_SUPPLY        = 1_000_000_000n;
const MIN_UTXO_LOVELACE   = 2_000_000n;
const PLATFORM_FEE        = 1_000_000n;
const MIN_PURE_ADA_OUTPUT = 1_000_000n;  // conservative Cardano min-UTxO for pure-ADA outputs
const MAX_CREATOR_FEE_BPS = 200;
const MAX_DEV_ALLOC_BPS   = 500;

// ── Lucid initialisation ──────────────────────────────────────────────────────

let _lucidCache: LucidEvolution | null = null;

export async function getLucid(walletApi: Cip30Api): Promise<LucidEvolution> {
  const projectId = process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID ?? '';
  const network   = (process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') as 'Mainnet' | 'Preprod';
  const baseUrl   = network === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0';

  if (!_lucidCache) {
    _lucidCache = await Lucid(new Blockfrost(baseUrl, projectId), network);
  }

  _lucidCache.selectWallet.fromAPI(walletApi as Parameters<typeof _lucidCache.selectWallet.fromAPI>[0]);
  return _lucidCache;
}

// ── Datum helpers ─────────────────────────────────────────────────────────────

function encodeCurveDatum(adaReserve: bigint, tokenReserve: bigint): string {
  return Data.to(new Constr(0, [adaReserve, tokenReserve]));
}

function encodeCurveRedeemer(tag: 'Buy' | 'Sell' | 'Graduate', minOut?: bigint): string {
  if (tag === 'Buy')      return Data.to(new Constr(0, [minOut ?? 0n]));
  if (tag === 'Sell')     return Data.to(new Constr(1, [minOut ?? 0n]));
  return Data.to(new Constr(2, []));
}

// stdlib v3.x: TransactionId is a ByteArray alias (no wrapping Constr)
// Encoding: Constr(0, [ByteArray(txHash), Int(outputIndex)])
function encodeOutputReference(txHash: string, outputIndex: number): Constr<Data> {
  return new Constr(0, [txHash, BigInt(outputIndex)]);
}

// ── Contract derivation ───────────────────────────────────────────────────────

export interface DerivedContracts {
  mintingPolicy: { type: 'PlutusV3'; script: string };
  bondingCurve:  { type: 'PlutusV3'; script: string };
  policyId:      string;
  assetName:     string;
  curveAddress:  string;
}

export function deriveContracts(
  seedTxHash: string,
  seedOutputIndex: number,
  creatorFeeBps: number,
  treasuryPkh: string,
  creatorPkh: string,
  network: 'Mainnet' | 'Preprod',
  ticker: string,
  graduationAdaLovelace: bigint,
): DerivedContracts {
  const oneShotParam = encodeOutputReference(seedTxHash, seedOutputIndex);
  const mintScript = applyParamsToScript(
    applyDoubleCborEncoding(MINTING_POLICY_CBOR),
    [oneShotParam],
  );
  const mintingPolicy = { type: 'PlutusV3' as const, script: mintScript };
  const policyId  = mintingPolicyToId(mintingPolicy);
  const assetName = fromText(ticker);

  const curveScript = applyParamsToScript(
    applyDoubleCborEncoding(BONDING_CURVE_CBOR),
    [policyId, assetName, BigInt(creatorFeeBps), treasuryPkh, creatorPkh, graduationAdaLovelace],
  );
  const bondingCurve  = { type: 'PlutusV3' as const, script: curveScript };
  const curveAddress  = validatorToAddress(network, bondingCurve);

  return { mintingPolicy, bondingCurve, policyId, assetName, curveAddress };
}

// ── Vesting ───────────────────────────────────────────────────────────────────
// Apply (creator_pkh, unlock_posix_ms) to the unparameterised vesting CBOR
// and return the per-launch script + script address. Dev allocation tokens
// can be locked at this address until unlock_posix_ms; the creator's claim
// tx must signed by creator and have a validity range starting at/after the
// unlock time.

export function deriveVestingContract(
  creatorPkh: string,
  unlockPosixMs: bigint,
  network: 'Mainnet' | 'Preprod',
): { vestingValidator: { type: 'PlutusV3'; script: string }; vestingAddress: string } {
  const script = applyParamsToScript(
    applyDoubleCborEncoding(VESTING_CBOR),
    [creatorPkh, unlockPosixMs],
  );
  const vestingValidator = { type: 'PlutusV3' as const, script };
  const vestingAddress = validatorToAddress(network, vestingValidator);
  return { vestingValidator, vestingAddress };
}

// ── Fee accumulator ─────────────────────────────────────────────────────────
// Per-launch script that collects creator fees into a single growing UTxO.
// Parameterised with creator_pkh; only the creator can sweep. The bonding
// curve is parameterised with this script's hash (in the slot that used to
// hold creator_pkh), so trades pay fees into the accumulator address and
// the on-chain validator's `creator_fee_paid` check still passes (fees.ak
// now matches both VKey and Script payment credentials).

export async function deriveFeeAccumulator(
  creatorPkh: string,
  network: 'Mainnet' | 'Preprod',
): Promise<{ validator: { type: 'PlutusV3'; script: string }; address: string; scriptHash: string }> {
  const script = applyParamsToScript(
    applyDoubleCborEncoding(FEE_ACCUMULATOR_CBOR),
    [creatorPkh],
  );
  const validator = { type: 'PlutusV3' as const, script };
  const address = validatorToAddress(network, validator);
  const { validatorToScriptHash } = await import('@lucid-evolution/lucid');
  const scriptHash = validatorToScriptHash(validator);
  return { validator, address, scriptHash };
}

// ── Launch ────────────────────────────────────────────────────────────────────

export interface LaunchFormData {
  name: string;
  ticker: string;
  creatorFeeBps: number;
  devAllocBps: number;
  initialBuyLovelace: bigint;
  /** Graduation threshold in lovelace. Defaults to NEXT_PUBLIC_GRADUATION_ADA
   *  if set, else 21_000_000_000 (21,000 ADA). Lower values let you test the
   *  full launch → graduate → Minswap flow with very little ADA. */
  graduationAdaLovelace?: bigint;
  /** If set (and devAllocBps > 0), the dev allocation is locked at a vesting
   *  script address until this POSIX milliseconds value, claimable only by
   *  the creator. 0/undefined = legacy instant-mint behaviour. */
  vestingUnlockMs?: number;
  imageUri?: string;
  description?: string;
  // Optional social fields — passed through to CIP-25 metadata at mint so
  // wallets/explorers can render them without hitting our private registry.
  website?:  string;
  twitter?:  string;
  telegram?: string;
  discord?:  string;
}

// CIP-25 v1 caps each metadatum string at 64 UTF-8 bytes. Longer values must
// become arrays of chunks that explorers/wallets concatenate. We split on
// byte length, not character count, so multi-byte characters never get cut
// across a chunk boundary.
function chunkString(s: string, max: number): string | string[] {
  if (!s) return '';
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= max) return s;
  const out: string[] = [];
  const decoder = new TextDecoder();
  let i = 0;
  while (i < bytes.length) {
    let end = Math.min(i + max, bytes.length);
    // Walk back if we'd split a UTF-8 continuation byte.
    while (end > i + 1 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end--;
    out.push(decoder.decode(bytes.slice(i, end)));
    i = end;
  }
  return out;
}

const DEFAULT_GRADUATION_ADA = (() => {
  const env = typeof process !== 'undefined' ? Number(process.env.NEXT_PUBLIC_GRADUATION_ADA ?? '') : NaN;
  return Number.isFinite(env) && env > 0 ? BigInt(Math.floor(env * 1_000_000)) : 21_000_000_000n;
})();

export interface LaunchResult {
  txHash: string;
  policyId: string;
  assetName: string;
  curveAddress: string;
  validatorCbor: string;
  /** Per-launch fee accumulator: trades pay the creator's rev-share into
   *  this script address; the creator sweeps with claimCreatorFees. */
  feeAccumulatorAddress: string;
  feeAccumulatorValidatorCbor: string;
  /** Set when vestingUnlockMs was provided AND devAllocBps > 0. */
  vestingAddress?: string;
  vestingValidatorCbor?: string;
  vestingUnlockMs?: number;
}

export async function launchToken(
  walletApi: Cip30Api,
  params: LaunchFormData,
  treasuryAddress: string,
): Promise<LaunchResult> {
  if (params.creatorFeeBps > MAX_CREATOR_FEE_BPS) throw new Error('creatorFeeBps > 200');
  if (params.devAllocBps   > MAX_DEV_ALLOC_BPS)   throw new Error('devAllocBps > 500');
  if (params.initialBuyLovelace < 0n)             throw new Error('initialBuyLovelace must be non-negative');

  const lucid   = await getLucid(walletApi);
  const network = (lucid.config().network === 'Mainnet' ? 'Mainnet' : 'Preprod') as 'Mainnet' | 'Preprod';

  const utxos = await lucid.wallet().getUtxos();
  if (!utxos.length) throw new Error('Wallet has no UTxOs');
  const seed = utxos[0];

  const walletAddress = await lucid.wallet().address();
  const creatorDetails  = getAddressDetails(walletAddress);
  const creatorPkh      = creatorDetails.paymentCredential?.hash;
  if (!creatorPkh) throw new Error('Cannot resolve creator pkh');

  const treasuryDetails = getAddressDetails(treasuryAddress);
  const treasuryPkh     = treasuryDetails.paymentCredential?.hash;
  if (!treasuryPkh) throw new Error('Cannot resolve treasury pkh');

  const graduationAdaLovelace = params.graduationAdaLovelace ?? DEFAULT_GRADUATION_ADA;
  if (graduationAdaLovelace <= 0n) throw new Error('graduationAdaLovelace must be positive');

  // Build the per-launch fee accumulator first so we can hand its script
  // hash to the bonding curve as the "creator payment hash". The bonding
  // curve's creator_fee_paid check now matches both VKey and Script payment
  // credentials, so this routes every trade's creator-fee output into the
  // accumulator instead of fragmenting the creator's wallet.
  const feeAcc = await deriveFeeAccumulator(creatorPkh, network);

  const contracts = deriveContracts(
    seed.txHash, seed.outputIndex,
    params.creatorFeeBps, treasuryPkh, feeAcc.scriptHash,
    network, params.ticker, graduationAdaLovelace,
  );

  const { mintingPolicy, bondingCurve, policyId, assetName, curveAddress } = contracts;
  const assetUnit  = `${policyId}${assetName}`;
  const devTokens  = (TOTAL_SUPPLY * BigInt(params.devAllocBps)) / 10000n;
  const curveTokens = TOTAL_SUPPLY - devTokens;

  const initTokensInCurve = params.initialBuyLovelace > 0n
    ? curveTokens - mathQuoteBuy(MIN_UTXO_LOVELACE, curveTokens, params.initialBuyLovelace)
    : curveTokens;
  const tokensToCreator = curveTokens - initTokensInCurve;

  // Datum ada_reserve must equal the actual lovelace the curve UTxO will hold
  // so the on-chain invariant lovelace_of(curve_utxo) == ada_reserve holds from block 1.
  const initDatum = encodeCurveDatum(MIN_UTXO_LOVELACE + params.initialBuyLovelace, initTokensInCurve);

  // Debug: log seed UTxO and encoded param so we can verify they match
  const encodedParam = Data.to(encodeOutputReference(seed.txHash, seed.outputIndex));
  console.debug('[launch] seed utxo:', seed.txHash, '#', seed.outputIndex);
  console.debug('[launch] encoded param:', encodedParam);
  console.debug('[launch] all utxo hashes:', utxos.map(u => `${u.txHash}#${u.outputIndex}`));

  // CIP-25 v1 metadata for wallet/explorer rendering. Attached at label 721.
  // Asset name key is the UTF-8 ticker (CIP-25 v1). Each metadata string is
  // capped at 64 UTF-8 bytes; long descriptions become an array of chunks.
  const cip25 = {
    [policyId]: {
      [params.ticker]: {
        // Every CIP-25 v1 string is capped at 64 UTF-8 bytes. Anything longer
        // must become an array of ≤64-byte chunks that wallets/explorers
        // concatenate. Vercel Blob image URLs are ~90+ chars so always chunk.
        name:        chunkString(params.name,                  64),
        ticker:      chunkString(params.ticker,                64),
        decimals:    0,
        image:       chunkString(params.imageUri ?? '',        64),
        description: chunkString(params.description ?? '',     64),
        ...(params.website  ? { website:  chunkString(params.website,  64) } : {}),
        ...(params.twitter  ? { twitter:  chunkString(params.twitter,  64) } : {}),
        ...(params.telegram ? { telegram: chunkString(params.telegram, 64) } : {}),
        ...(params.discord  ? { discord:  chunkString(params.discord,  64) } : {}),
      },
    },
    version: '1.0',
  };

  const tx = lucid
    .newTx()
    .collectFrom([seed])
    .mintAssets({ [assetUnit]: TOTAL_SUPPLY }, Data.void())
    .attach.MintingPolicy(mintingPolicy)
    .attachMetadata(721, cip25)
    // SpendingValidator not needed during launch (we're creating, not spending the curve UTxO)
    .pay.ToAddressWithData(
      curveAddress,
      { kind: 'inline', value: initDatum },
      {
        lovelace: MIN_UTXO_LOVELACE + params.initialBuyLovelace,
        [assetUnit]: initTokensInCurve,
      },
    )
    .pay.ToAddress(treasuryAddress, { lovelace: PLATFORM_FEE });

  // Vesting: when vestingUnlockMs is in the future, lock the creator's
  // tokens at a per-launch vesting script (parameterised with creator_pkh +
  // unlock_posix_ms). The vested bucket is the *initial-buy* tokens — i.e.
  // whatever the creator bought into the curve at launch. Free dev allocation
  // (devTokens) still goes straight to the creator wallet for backward compat
  // with any non-UI caller; the create page no longer exposes it.
  let vestingAddress:        string | undefined;
  let vestingValidatorCbor:  string | undefined;
  let vestingUnlockMs:       number | undefined;

  const wantVesting = !!(params.vestingUnlockMs && params.vestingUnlockMs > Date.now());
  if (wantVesting && tokensToCreator > 0n) {
    const vesting = deriveVestingContract(creatorPkh, BigInt(params.vestingUnlockMs!), network);
    vestingAddress       = vesting.vestingAddress;
    vestingValidatorCbor = vesting.vestingValidator.script;
    vestingUnlockMs      = params.vestingUnlockMs;
    tx.pay.ToAddressWithData(
      vestingAddress,
      { kind: 'inline', value: Data.void() },
      { lovelace: MIN_UTXO_LOVELACE, [assetUnit]: tokensToCreator },
    );
  } else if (tokensToCreator > 0n) {
    tx.pay.ToAddress(walletAddress, { lovelace: MIN_UTXO_LOVELACE, [assetUnit]: tokensToCreator });
  }

  if (devTokens > 0n) {
    tx.pay.ToAddress(walletAddress, { lovelace: MIN_UTXO_LOVELACE, [assetUnit]: devTokens });
  }

  const signed  = await tx.complete().then(t => t.sign.withWallet().complete());
  const txHash  = await signed.submit();

  return {
    txHash, policyId, assetName, curveAddress,
    validatorCbor: bondingCurve.script,
    feeAccumulatorAddress:       feeAcc.address,
    feeAccumulatorValidatorCbor: feeAcc.validator.script,
    vestingAddress, vestingValidatorCbor, vestingUnlockMs,
  };
}

// ── Re-vest: lock additional tokens at a fresh vesting position ──────────────
// Builds a tx that pays `amountTokens` of the asset (and MIN_UTXO_LOVELACE)
// from the creator's wallet to a freshly-derived vesting script address,
// parameterised with the creator's pkh + the chosen unlock timestamp.
// Returns the new vesting address + validator CBOR + unlockMs so the caller
// can persist the position in the registry.

export async function addVestingPosition(
  walletApi: Cip30Api,
  policyId: string,
  assetName: string,
  amountTokens: bigint,
  unlockMs: number,
): Promise<{ txHash: string; address: string; validatorCbor: string; unlockMs: number; amount: bigint }> {
  if (amountTokens <= 0n) throw new Error('amount must be positive');
  if (!unlockMs || unlockMs <= Date.now()) throw new Error('unlock time must be in the future');

  const lucid     = await getLucid(walletApi);
  const network   = (lucid.config().network === 'Mainnet' ? 'Mainnet' : 'Preprod') as 'Mainnet' | 'Preprod';
  const assetUnit = `${policyId}${assetName}`;

  const walletAddr = await lucid.wallet().address();
  const creatorPkh = getAddressDetails(walletAddr).paymentCredential?.hash;
  if (!creatorPkh) throw new Error('Cannot resolve creator pkh');

  const { vestingValidator, vestingAddress } = deriveVestingContract(creatorPkh, BigInt(unlockMs), network);

  const signed = await lucid
    .newTx()
    .pay.ToAddressWithData(
      vestingAddress,
      { kind: 'inline', value: Data.void() },
      { lovelace: MIN_UTXO_LOVELACE, [assetUnit]: amountTokens },
    )
    .complete()
    .then(t => t.sign.withWallet().complete());

  const txHash = await signed.submit();

  return {
    txHash,
    address:       vestingAddress,
    validatorCbor: vestingValidator.script,
    unlockMs,
    amount:        amountTokens,
  };
}

// ── Creator fee sweep ─────────────────────────────────────────────────────
// Spend every UTxO at the per-launch fee accumulator address, summing the
// lovelace and paying it back to the creator's wallet. The accumulator
// validator only checks `signed by creator_pkh` — no time lock — so this
// can be called at any time.

export async function claimCreatorFees(
  walletApi: Cip30Api,
  feeAccumulatorAddress: string,
  validatorCbor: string,
): Promise<{ txHash: string; lovelace: bigint }> {
  const lucid = await getLucid(walletApi);

  const utxos = await lucid.utxosAt(feeAccumulatorAddress);
  if (utxos.length === 0) throw new Error('No fees accrued at the accumulator');

  // Lucid Evolution requires explicit shape for inline-datum / scripted UTxOs.
  const inputs: UTxO[] = utxos.map(u => ({
    txHash:      u.txHash,
    outputIndex: u.outputIndex,
    assets:      { ...u.assets },
    address:     feeAccumulatorAddress,
    datum:       u.datum,
    datumHash:   undefined,
    scriptRef:   undefined,
  }));

  const totalLovelace = inputs.reduce((s, u) => s + u.assets.lovelace, 0n);

  const walletAddr = await lucid.wallet().address();
  const creatorPkh = getAddressDetails(walletAddr).paymentCredential?.hash;
  if (!creatorPkh) throw new Error('Cannot resolve creator pkh');

  const signed = await lucid
    .newTx()
    .collectFrom(inputs, Data.void())
    .attach.SpendingValidator({ type: 'PlutusV3' as const, script: validatorCbor })
    .addSignerKey(creatorPkh)
    .pay.ToAddress(walletAddr, { lovelace: totalLovelace })
    .complete()
    .then(t => t.sign.withWallet().complete());

  const txHash = await signed.submit();
  return { txHash, lovelace: totalLovelace };
}

// ── Vesting claim ─────────────────────────────────────────────────────────────
// Spend the vested UTxO back to the creator's wallet. The validator requires:
//   1. tx is signed by creator
//   2. tx.validity_range.lower_bound (validFrom) >= unlock_posix_ms

export async function claimVestedTokens(
  walletApi: Cip30Api,
  vestingAddress: string,
  vestingValidatorCbor: string,
  unlockMs: number,
  policyId: string,
  assetName: string,
): Promise<{ txHash: string; tokens: bigint; lovelace: bigint }> {
  const lucid = await getLucid(walletApi);
  const assetUnit = `${policyId}${assetName}`;

  const utxos = await lucid.utxosAt(vestingAddress);
  // Filter to UTxOs that actually carry the asset (defensive against junk).
  const vestingUtxos = utxos.filter(u => (u.assets[assetUnit] ?? 0n) > 0n);
  if (vestingUtxos.length === 0) throw new Error('No vested UTxO at the vesting address');

  // Lucid Evolution requires explicit shape for inline-datum UTxOs.
  const inputs: UTxO[] = vestingUtxos.map(u => ({
    txHash:      u.txHash,
    outputIndex: u.outputIndex,
    assets:      { ...u.assets },
    address:     vestingAddress,
    datum:       u.datum,
    datumHash:   undefined,
    scriptRef:   undefined,
  }));

  const totalLovelace = inputs.reduce((s, u) => s + u.assets.lovelace, 0n);
  const totalTokens   = inputs.reduce((s, u) => s + (u.assets[assetUnit] ?? 0n), 0n);

  const walletAddr = await lucid.wallet().address();
  const creatorPkh = getAddressDetails(walletAddr).paymentCredential?.hash;
  if (!creatorPkh) throw new Error('Cannot resolve creator pkh');

  // Validity-range buffer: set validFrom to the larger of (unlockMs + 1s) and
  // (now + a few seconds) so the slot conversion always lands strictly after
  // the unlock without trying to use a slot in the past.
  const validFrom = Math.max(unlockMs + 1_000, Date.now() + 5_000);
  const validTo   = validFrom + 60 * 60 * 1_000; // 1h window

  const signed = await lucid
    .newTx()
    .collectFrom(inputs, Data.void())
    .attach.SpendingValidator({ type: 'PlutusV3' as const, script: vestingValidatorCbor })
    .addSignerKey(creatorPkh)
    .validFrom(validFrom)
    .validTo(validTo)
    .pay.ToAddress(walletAddr, { lovelace: totalLovelace, [assetUnit]: totalTokens })
    .complete()
    .then(t => t.sign.withWallet().complete());

  const txHash = await signed.submit();
  return { txHash, tokens: totalTokens, lovelace: totalLovelace };
}

// ── Buy ───────────────────────────────────────────────────────────────────────

export interface CurveSnapshot {
  adaReserve: bigint;
  tokenReserve: bigint;
  txHash: string;
  outputIndex: number;
  lovelace: bigint;
}

export async function buyTokens(
  walletApi: Cip30Api,
  curve: CurveSnapshot,
  adaIn: bigint,
  slippageBps: number,
  creatorFeeBps: number,
  policyId: string,
  assetName: string,
  curveAddress: string,
  validatorCbor: string,
  treasuryAddress: string,
  creatorAddress: string,
  // When the token was launched with a fee accumulator (new path), creator
  // fees go to this script address. Tokens launched before the accumulator
  // existed leave this undefined and pay creatorAddress directly (legacy).
  feeAccumulatorAddress?: string,
): Promise<{ txHash: string; tokensOut: bigint }> {
  const lucid = await getLucid(walletApi);
  const assetUnit = `${policyId}${assetName}`;

  // Fetch the live UTxO and read datum directly from the chain.
  const rawUtxos  = await lucid.utxosAt(curveAddress);
  const rawUtxo   = rawUtxos.find(u => u.assets[assetUnit] !== undefined);
  if (!rawUtxo)        throw new Error('Curve UTxO not found');
  if (!rawUtxo.datum)  throw new Error('Curve UTxO missing inline datum');

  // Decode actual on-chain reserves (authoritative over the snapshot).
  const chainConstr    = Data.from(rawUtxo.datum) as Constr<bigint>;
  const chainAdaRes    = chainConstr.fields[0];
  const chainTokRes    = chainConstr.fields[1];
  const actualLovelace = rawUtxo.assets.lovelace;

  const tokensOut = mathQuoteBuy(chainAdaRes, chainTokRes, adaIn);
  const minOut    = tokensOut - (tokensOut * BigInt(slippageBps)) / 10000n;
  if (minOut < 1n) throw new Error('Amount too small');

  // Creator rev-share on buy gross — same shape as sell, but applied to adaIn.
  // Mirrors validate_buy's creator_fee_paid check.
  const creatorFee = (adaIn * BigInt(creatorFeeBps)) / 10000n;

  const newAdaRes  = chainAdaRes + adaIn;
  const newTokRes  = chainTokRes - tokensOut;
  const newDatum   = encodeCurveDatum(newAdaRes, newTokRes);
  const redeemer   = encodeCurveRedeemer('Buy', minOut);
  const walletAddr = await lucid.wallet().address();

  // Construct the UTxO explicitly so Lucid's evaluator sees the inline datum.
  const curveInput: UTxO = {
    txHash:      rawUtxo.txHash,
    outputIndex: rawUtxo.outputIndex,
    assets: {
      lovelace:    actualLovelace,
      [assetUnit]: rawUtxo.assets[assetUnit],
    },
    address:    curveAddress,
    datum:      rawUtxo.datum,
    datumHash:  undefined,
    scriptRef:  undefined,
  };

  const buyTx = lucid
    .newTx()
    .collectFrom([curveInput], redeemer)
    .attach.SpendingValidator({ type: 'PlutusV3' as const, script: validatorCbor })
    .pay.ToAddressWithData(
      curveAddress,
      { kind: 'inline', value: newDatum },
      { lovelace: actualLovelace + adaIn, [assetUnit]: newTokRes },
    )
    .pay.ToAddress(treasuryAddress, { lovelace: PLATFORM_FEE });
  if (creatorFee > 0n) {
    // Route to fee accumulator when this token has one (new launches);
    // older tokens pay the creator's wallet directly per their on-chain
    // validator's parameterisation.
    buyTx.pay.ToAddress(feeAccumulatorAddress ?? creatorAddress, { lovelace: creatorFee });
  }
  buyTx.pay.ToAddress(walletAddr, { lovelace: MIN_UTXO_LOVELACE, [assetUnit]: tokensOut });

  const signed = await buyTx.complete().then(t => t.sign.withWallet().complete());
  const txHash = await signed.submit();
  return { txHash, tokensOut };
}

// ── Sell ──────────────────────────────────────────────────────────────────────

export async function sellTokens(
  walletApi: Cip30Api,
  curve: CurveSnapshot,
  tokensIn: bigint,
  slippageBps: number,
  creatorFeeBps: number,
  policyId: string,
  assetName: string,
  curveAddress: string,
  validatorCbor: string,
  treasuryAddress: string,
  creatorAddress: string,
  feeAccumulatorAddress?: string,
): Promise<{ txHash: string; adaNet: bigint }> {
  const lucid     = await getLucid(walletApi);
  const assetUnit = `${policyId}${assetName}`;

  const rawUtxos  = await lucid.utxosAt(curveAddress);
  const rawUtxo   = rawUtxos.find(u => u.assets[assetUnit] !== undefined);
  if (!rawUtxo)        throw new Error('Curve UTxO not found');
  if (!rawUtxo.datum)  throw new Error('Curve UTxO missing inline datum');

  const chainConstr    = Data.from(rawUtxo.datum) as Constr<bigint>;
  const chainAdaRes    = chainConstr.fields[0];
  const chainTokRes    = chainConstr.fields[1];
  const actualLovelace = rawUtxo.assets.lovelace;

  const grossAda   = mathQuoteSellGross(chainAdaRes, chainTokRes, tokensIn);
  const creatorFee = (grossAda * BigInt(creatorFeeBps)) / 10000n;
  const adaNet     = grossAda - PLATFORM_FEE - creatorFee;
  const minOut     = adaNet - (adaNet * BigInt(slippageBps)) / 10000n;
  if (adaNet < MIN_PURE_ADA_OUTPUT) throw new Error('Sell amount too small — net ADA after fees is below the Cardano minimum output (1 ADA)');

  const newAdaRes  = chainAdaRes - grossAda;
  const newTokRes  = chainTokRes + tokensIn;
  const newDatum   = encodeCurveDatum(newAdaRes, newTokRes);
  const redeemer   = encodeCurveRedeemer('Sell', minOut);
  const walletAddr = await lucid.wallet().address();

  const curveInput: UTxO = {
    txHash:      rawUtxo.txHash,
    outputIndex: rawUtxo.outputIndex,
    assets: {
      lovelace:    actualLovelace,
      [assetUnit]: rawUtxo.assets[assetUnit],
    },
    address:    curveAddress,
    datum:      rawUtxo.datum,
    datumHash:  undefined,
    scriptRef:  undefined,
  };

  const sellTx = lucid
    .newTx()
    .collectFrom([curveInput], redeemer)
    .attach.SpendingValidator({ type: 'PlutusV3' as const, script: validatorCbor })
    .pay.ToAddressWithData(
      curveAddress,
      { kind: 'inline', value: newDatum },
      { lovelace: actualLovelace - grossAda, [assetUnit]: newTokRes },
    )
    .pay.ToAddress(treasuryAddress, { lovelace: PLATFORM_FEE });
  if (creatorFee > 0n) {
    sellTx.pay.ToAddress(feeAccumulatorAddress ?? creatorAddress, { lovelace: creatorFee });
  }
  sellTx.pay.ToAddress(walletAddr, { lovelace: adaNet });
  const signed = await sellTx.complete().then(t => t.sign.withWallet().complete());

  const txHash = await signed.submit();
  return { txHash, adaNet };
}
