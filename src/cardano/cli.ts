import type { Command } from 'commander';
import { makeLucidFromEnv } from './chain.js';
import { launchToken } from './launch.js';
import { fetchCurveUtxo, buyTokens, sellTokens } from './trade.js';
import { graduateToken } from './graduate-tx.js';
import { runBatchCycle } from './batcher.js';
import {
  quoteBuy as quoteBuyMath,
  quoteSellGross,
  spotPrice,
  marketCap,
  bondedBps,
  isGraduated,
} from './curve.js';
import { computeSellFees } from './fees.js';
import { DEFAULT_CREATOR_FEE_BPS, VIRTUAL_ADA } from './config.js';
import type { LaunchParams } from './types.js';

function bi(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required`);
  return v;
}

async function makeLucidWithWallet() {
  const lucid = await makeLucidFromEnv();
  const seed = process.env.CARDANO_SEED_PHRASE;
  const privKey = process.env.CARDANO_PRIVATE_KEY;
  if (seed) {
    lucid.selectWallet.fromSeed(seed);
  } else if (privKey) {
    lucid.selectWallet.fromPrivateKey(privKey);
  } else {
    throw new Error(
      'Set CARDANO_SEED_PHRASE or CARDANO_PRIVATE_KEY to load your Cardano wallet',
    );
  }
  return lucid;
}

export function registerCardanoCommands(program: Command): void {
  const cardano = program
    .command('cardano')
    .description('Cardano bonding-curve launchpad (ADA / Minswap)');

  // ── cardano wallet ────────────────────────────────────────────────────────

  const cWallet = cardano.command('wallet').description('wallet utilities');

  cWallet
    .command('address')
    .description('print the wallet address from env seed/key')
    .action(async () => {
      const lucid = await makeLucidWithWallet();
      const address = await lucid.wallet().address();
      console.log(address);
    });

  cWallet
    .command('utxos')
    .description('list wallet UTxOs')
    .action(async () => {
      const lucid = await makeLucidWithWallet();
      const utxos = await lucid.wallet().getUtxos();
      const lovelace = utxos.reduce((s: bigint, u: { assets: { lovelace: bigint } }) => s + u.assets.lovelace, 0n);
      console.log(JSON.stringify({ utxoCount: utxos.length, lovelace }, bi, 2));
    });

  // ── cardano token ─────────────────────────────────────────────────────────

  const cToken = cardano.command('token').description('token operations');

  cToken
    .command('launch')
    .description('mint a new bonding-curve token')
    .requiredOption('--name <name>', 'display name (e.g. "My Token")')
    .requiredOption('--ticker <ticker>', 'ticker symbol (e.g. MTK)')
    .option('--creator-fee-bps <n>', 'creator fee bps on sells (0–200)', String(DEFAULT_CREATOR_FEE_BPS))
    .option('--dev-alloc-bps <n>', 'dev allocation bps (0–500)', '0')
    .option('--initial-buy <lovelace>', 'optional initial buy in lovelace', '0')
    .option('--image <uri>', 'IPFS image URI')
    .option('--description <text>', 'token description')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidWithWallet();
      const treasury = requireEnv('LUMPFUN_TREASURY_ADDRESS');
      const params: LaunchParams = {
        name: opts.name,
        ticker: opts.ticker,
        creatorFeeBps:      parseInt(opts.creatorFeeBps, 10),
        devAllocBps:        parseInt(opts.devAllocBps, 10),
        initialBuyLovelace: BigInt(opts.initialBuy),
        imageUri:           opts.image,
        description:        opts.description,
      };
      console.error('Launching token…');
      const result = await launchToken(lucid, params, treasury);
      console.log(JSON.stringify(result, bi, 2));
      console.error('');
      console.error('Save policy-id and curve-address — you will need them for buy/sell/info.');
    });

  cToken
    .command('info')
    .description('show bonding curve state for a token')
    .requiredOption('--curve-address <addr>', 'bonding curve script address')
    .requiredOption('--policy-id <hex>', '28-byte policy ID hex')
    .requiredOption('--asset-name <hex>', 'asset name hex (use fromText(ticker))')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidFromEnv();
      const curve = await fetchCurveUtxo(
        lucid,
        opts.curveAddress,
        opts.policyId,
        opts.assetName,
      );
      const state = curve.datum;
      const priceLovelace = spotPrice(state);
      const adaReserveAda = Number(state.adaReserve) / 1_000_000;
      const marketCapAda  = Number(marketCap(state)) / 1_000_000;
      const bondedPct     = Number(bondedBps(state)) / 100;
      console.log(
        JSON.stringify(
          {
            policyId:       curve.policyId,
            assetName:      curve.assetName,
            adaReserve:     state.adaReserve,
            adaReserveAda,
            tokenReserve:   state.tokenReserve,
            priceLovelace,
            priceAda:       Number(priceLovelace) / 1_000_000,
            marketCapAda,
            bondedPct,
            graduated:      isGraduated(state),
          },
          bi,
          2,
        ),
      );
    });

  cToken
    .command('quote-buy')
    .description('quote a buy without sending a tx')
    .requiredOption('--curve-address <addr>')
    .requiredOption('--policy-id <hex>')
    .requiredOption('--asset-name <hex>')
    .requiredOption('--ada <lovelace>', 'ADA to spend in lovelace', (v: string) => BigInt(v))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidFromEnv();
      const curve = await fetchCurveUtxo(lucid, opts.curveAddress, opts.policyId, opts.assetName);
      const tokensOut = quoteBuyMath(curve.datum, opts.ada);
      console.log(JSON.stringify({ adaIn: opts.ada, tokensOut, platformFee: 1_000_000n }, bi, 2));
    });

  cToken
    .command('quote-sell')
    .description('quote a sell without sending a tx')
    .requiredOption('--curve-address <addr>')
    .requiredOption('--policy-id <hex>')
    .requiredOption('--asset-name <hex>')
    .requiredOption('--tokens <n>', 'token units to sell', (v: string) => BigInt(v))
    .option('--creator-fee-bps <n>', 'creator fee bps', String(DEFAULT_CREATOR_FEE_BPS))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidFromEnv();
      const curve = await fetchCurveUtxo(lucid, opts.curveAddress, opts.policyId, opts.assetName);
      const grossAda = quoteSellGross(curve.datum, opts.tokens);
      const fees = computeSellFees(grossAda, parseInt(opts.creatorFeeBps, 10));
      console.log(
        JSON.stringify(
          {
            tokensIn:    opts.tokens,
            grossAda:    fees.adaGross,
            creatorFee:  fees.creatorFee,
            platformFee: fees.platformFee,
            netAda:      fees.adaNet,
          },
          bi,
          2,
        ),
      );
    });

  cToken
    .command('buy')
    .description('buy tokens from the bonding curve')
    .requiredOption('--curve-address <addr>')
    .requiredOption('--policy-id <hex>')
    .requiredOption('--asset-name <hex>')
    .requiredOption('--ada <lovelace>', 'ADA to spend in lovelace', (v: string) => BigInt(v))
    .option('--slippage-bps <n>', 'slippage tolerance in bps', '50')
    .option('--creator-fee-bps <n>', 'must match the curve contract', String(DEFAULT_CREATOR_FEE_BPS))
    .requiredOption('--validator-cbor <hex>', 'parameterised bonding curve script CBOR')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidWithWallet();
      const treasury = requireEnv('LUMPFUN_TREASURY_ADDRESS');
      const creatorAddress = requireEnv('LUMPFUN_CREATOR_ADDRESS');
      const curve = await fetchCurveUtxo(lucid, opts.curveAddress, opts.policyId, opts.assetName);
      const validator = { type: 'PlutusV3', script: opts.validatorCbor };
      console.error('Submitting buy…');
      const result = await buyTokens(
        lucid,
        curve,
        opts.ada,
        parseInt(opts.slippageBps, 10),
        parseInt(opts.creatorFeeBps, 10),
        validator,
        treasury,
        creatorAddress,
      );
      console.log(JSON.stringify(result, bi, 2));
    });

  cToken
    .command('sell')
    .description('sell tokens back to the bonding curve')
    .requiredOption('--curve-address <addr>')
    .requiredOption('--policy-id <hex>')
    .requiredOption('--asset-name <hex>')
    .requiredOption('--tokens <n>', 'token units to sell', (v: string) => BigInt(v))
    .option('--slippage-bps <n>', 'slippage tolerance in bps', '50')
    .option('--creator-fee-bps <n>', String(DEFAULT_CREATOR_FEE_BPS))
    .requiredOption('--validator-cbor <hex>', 'parameterised bonding curve script CBOR')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidWithWallet();
      const treasury = requireEnv('LUMPFUN_TREASURY_ADDRESS');
      const creatorAddress = requireEnv('LUMPFUN_CREATOR_ADDRESS');
      const curve = await fetchCurveUtxo(lucid, opts.curveAddress, opts.policyId, opts.assetName);
      const validator = { type: 'PlutusV3', script: opts.validatorCbor };
      console.error('Submitting sell…');
      const result = await sellTokens(
        lucid,
        curve,
        opts.tokens,
        parseInt(opts.slippageBps, 10),
        parseInt(opts.creatorFeeBps, 10),
        validator,
        treasury,
        creatorAddress,
      );
      console.log(JSON.stringify(result, bi, 2));
    });

  cToken
    .command('graduate')
    .description('graduate token to Minswap when fully bonded')
    .requiredOption('--curve-address <addr>')
    .requiredOption('--policy-id <hex>')
    .requiredOption('--asset-name <hex>')
    .requiredOption('--validator-cbor <hex>', 'parameterised bonding curve script CBOR')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidWithWallet();
      const creatorAddress = requireEnv('LUMPFUN_CREATOR_ADDRESS');
      const validator = { type: 'PlutusV3', script: opts.validatorCbor };
      console.error('Graduating token to Minswap…');
      const result = await graduateToken(
        lucid,
        opts.curveAddress,
        opts.policyId,
        opts.assetName,
        validator,
        creatorAddress,
      );
      console.log(JSON.stringify(result, bi, 2));
    });

  // ── cardano batcher ───────────────────────────────────────────────────────

  const cBatcher = cardano.command('batcher').description('order book batcher');

  cBatcher
    .command('run')
    .description('process all pending orders for a token (one cycle)')
    .requiredOption('--curve-address <addr>')
    .requiredOption('--order-book-address <addr>')
    .requiredOption('--policy-id <hex>')
    .requiredOption('--asset-name <hex>')
    .requiredOption('--validator-cbor <hex>', 'parameterised bonding curve script CBOR')
    .option('--creator-fee-bps <n>', String(DEFAULT_CREATOR_FEE_BPS))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .action(async (opts: any) => {
      const lucid = await makeLucidWithWallet();
      const treasury = requireEnv('LUMPFUN_TREASURY_ADDRESS');
      const creatorAddress = requireEnv('LUMPFUN_CREATOR_ADDRESS');
      const config = {
        curveAddress:       opts.curveAddress,
        orderBookAddress:   opts.orderBookAddress,
        policyId:           opts.policyId,
        assetName:          opts.assetName,
        creatorFeeBps:      parseInt(opts.creatorFeeBps, 10),
        creatorAddress,
        treasuryAddress:    treasury,
        bondingCurveValidator: { type: 'PlutusV3', script: opts.validatorCbor },
      };
      console.error('Running batcher cycle…');
      const result = await runBatchCycle(lucid, config);
      console.log(JSON.stringify(result, bi, 2));
    });
}
