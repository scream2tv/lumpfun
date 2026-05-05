import {
  applyDoubleCborEncoding,
  applyParamsToScript,
  mintingPolicyToId,
  validatorToAddress,
  getAddressDetails,
  fromText,
  Data,
  Constr,
} from '@lucid-evolution/lucid';
import type { MintingPolicy, SpendingValidator, LucidEvolution } from '@lucid-evolution/lucid';
import {
  BONDING_CURVE_CBOR,
  MINTING_POLICY_CBOR,
} from './scripts.js';
import { encodeCurveDatum, encodeOutputReference } from './codec.js';
import {
  TOTAL_SUPPLY,
  MIN_UTXO_LOVELACE,
  PLATFORM_FEE_LOVELACE,
  DEFAULT_CREATOR_FEE_BPS,
  MAX_CREATOR_FEE_BPS,
  MAX_DEV_ALLOC_BPS,
  MAX_INITIAL_BUY_LOVELACE,
  GRADUATION_ADA,
} from './config.js';
import { quoteBuy } from './curve.js';
import type { LaunchParams, LaunchResult } from './types.js';

export interface DerivedContracts {
  mintingPolicy: MintingPolicy;
  bondingCurve: SpendingValidator;
  policyId: string;
  assetName: string; // hex
  curveAddress: string;
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
  // One-shot minting policy parameterised with the seed UTxO
  const oneShotParam = encodeOutputReference(seedTxHash, seedOutputIndex);
  const mintScript = applyParamsToScript(
    applyDoubleCborEncoding(MINTING_POLICY_CBOR),
    [oneShotParam],
  );
  const mintingPolicy: MintingPolicy = { type: 'PlutusV3', script: mintScript };
  const policyId = mintingPolicyToId(mintingPolicy);
  const assetName = fromText(ticker);

  // Bonding curve validator parameterised with
  //   (policyId, assetName, creatorFeeBps, treasuryPkh, creatorPkh, graduationAda)
  const curveScript = applyParamsToScript(
    applyDoubleCborEncoding(BONDING_CURVE_CBOR),
    [policyId, assetName, BigInt(creatorFeeBps), treasuryPkh, creatorPkh, graduationAdaLovelace],
  );
  const bondingCurve: SpendingValidator = { type: 'PlutusV3', script: curveScript };
  const curveAddress = validatorToAddress(network, bondingCurve);

  return { mintingPolicy, bondingCurve, policyId, assetName, curveAddress };
}

export async function launchToken(
  lucid: LucidEvolution,
  params: LaunchParams,
  treasuryAddress: string,
): Promise<LaunchResult> {
  const creatorFeeBps = params.creatorFeeBps ?? DEFAULT_CREATOR_FEE_BPS;
  if (creatorFeeBps < 0 || creatorFeeBps > MAX_CREATOR_FEE_BPS) {
    throw new Error(`creatorFeeBps must be 0–${MAX_CREATOR_FEE_BPS}`);
  }

  const devAllocBps = params.devAllocBps ?? 0;
  if (devAllocBps < 0 || devAllocBps > MAX_DEV_ALLOC_BPS) {
    throw new Error(`devAllocBps must be 0–${MAX_DEV_ALLOC_BPS}`);
  }

  const initialBuyLovelace = params.initialBuyLovelace ?? 0n;
  if (initialBuyLovelace < 0n || initialBuyLovelace > MAX_INITIAL_BUY_LOVELACE) {
    throw new Error(`initialBuyLovelace must be 0–${MAX_INITIAL_BUY_LOVELACE}`);
  }

  const graduationAdaLovelace = params.graduationAdaLovelace ?? GRADUATION_ADA;
  if (graduationAdaLovelace <= 0n) {
    throw new Error(`graduationAdaLovelace must be positive`);
  }

  const network = lucid.config().network === 'Mainnet' ? 'Mainnet' : 'Preprod';

  // Pick seed UTxO (any UTxO the wallet controls — consumed to make policy ID unique)
  const utxos = await lucid.wallet().getUtxos();
  if (utxos.length === 0) throw new Error('Wallet has no UTxOs');
  const seedUtxo = utxos[0];

  // Resolve creator pubkey hash from wallet address
  const walletAddress = await lucid.wallet().address();
  const creatorDetails = getAddressDetails(walletAddress);
  const creatorPkh = creatorDetails.paymentCredential?.hash;
  if (!creatorPkh) throw new Error('Could not resolve creator pubkey hash');

  const treasuryDetails = getAddressDetails(treasuryAddress);
  const treasuryPkh = treasuryDetails.paymentCredential?.hash;
  if (!treasuryPkh) throw new Error('Could not resolve treasury pubkey hash');

  const contracts = deriveContracts(
    seedUtxo.txHash,
    seedUtxo.outputIndex,
    creatorFeeBps,
    treasuryPkh,
    creatorPkh,
    network,
    params.ticker,
    graduationAdaLovelace,
  );

  const { mintingPolicy, bondingCurve, policyId, assetName, curveAddress } = contracts;
  const assetUnit = `${policyId}${assetName}`;

  // Calculate dev allocation and tokens seeded to curve
  const devTokens = (TOTAL_SUPPLY * BigInt(devAllocBps)) / 10000n;
  const curveTokens = TOTAL_SUPPLY - devTokens;

  // How many tokens the creator buys immediately (optional)
  let tokensFromInitialBuy = 0n;
  let initialBuyAda = 0n;
  if (initialBuyLovelace > 0n) {
    tokensFromInitialBuy = quoteBuy({ adaReserve: MIN_UTXO_LOVELACE, tokenReserve: curveTokens }, initialBuyLovelace);
    initialBuyAda = initialBuyLovelace;
  }

  // Seed datum with the actual lovelace the curve UTxO will hold so the
  // invariant lovelace_of(curve_utxo) == ada_reserve holds from block 1.
  const initDatum = encodeCurveDatum({
    adaReserve: MIN_UTXO_LOVELACE + initialBuyAda,
    tokenReserve: curveTokens - tokensFromInitialBuy,
  });

  // Build the platform fee output
  const platformFeeAssets = { lovelace: PLATFORM_FEE_LOVELACE };

  // Curve seeds: MIN_UTXO + initial buy ADA (minus platform fee already included)
  const curveLovelace = MIN_UTXO_LOVELACE + initialBuyAda;
  const curveAssets: Record<string, bigint> = {
    lovelace: curveLovelace,
    [assetUnit]: curveTokens - tokensFromInitialBuy,
  };

  // Metadata (CIP-25 style, written as inline datum on curve UTxO via tx metadata)
  const txMeta: Record<string, unknown> = {
    721: {
      [policyId]: {
        [params.ticker]: {
          name: params.name,
          ...(params.imageUri   ? { image: params.imageUri }         : {}),
          ...(params.description ? { description: params.description } : {}),
        },
      },
    },
  };

  const tx = lucid
    .newTx()
    .collectFrom([seedUtxo])
    .mintAssets({ [assetUnit]: TOTAL_SUPPLY }, Data.to(new Constr(0, [])))
    .attach.MintingPolicy(mintingPolicy)
    .attach.SpendingValidator(bondingCurve)
    .pay.ToAddressWithData(
      curveAddress,
      { kind: 'inline', value: initDatum },
      curveAssets,
    )
    .pay.ToAddress(treasuryAddress, platformFeeAssets);

  // Dev allocation: send to creator wallet
  if (devTokens > 0n) {
    tx.pay.ToAddress(walletAddress, {
      lovelace: MIN_UTXO_LOVELACE,
      [assetUnit]: devTokens,
    });
  }

  // Creator keeps initial buy tokens (they stay in wallet — no extra output needed,
  // they were subtracted from curveAssets above and the remaining goes to the curve)
  if (tokensFromInitialBuy > 0n) {
    tx.pay.ToAddress(walletAddress, {
      lovelace: MIN_UTXO_LOVELACE,
      [assetUnit]: tokensFromInitialBuy,
    });
  }

  const signed = await tx.complete().then(t => t.sign.withWallet().complete());
  const txHash = await signed.submit();

  return {
    txHash, policyId, assetName, curveAddress,
    seedTxHash: seedUtxo.txHash,
    seedOutputIndex: seedUtxo.outputIndex,
    validatorCbor: bondingCurve.script,
  };
}
