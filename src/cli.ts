#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import {
  createWallet,
  initWallet,
  stopWallet,
  getBalances,
} from './wallet.js';
import {
  deployLaunch,
  connectLaunch,
  buy,
  sell,
  transfer,
  withdrawPlatform,
  withdrawCreator,
  withdrawReferral,
  quoteBuy,
  quoteSell,
} from './launch.js';
import { listLaunches, recordLaunch } from './registry.js';
import { getChainInfo, getTxByHash, rpcHealth } from './chain.js';

/** JSON.stringify replacer: renders bigints as decimal strings. */
function bi(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

const program = new Command();
program
  .name('lumpfun')
  .description('LumpFun — Midnight Network launchpad (preprod MVP)')
  .version('0.1.0');

// ─── wallet ─────────────────────────────────────────────────────────────
const wallet = program.command('wallet').description('wallet management');

wallet
  .command('create')
  .description('generate a new wallet seed and print its addresses')
  .action(() => {
    const w = createWallet();
    console.log(
      JSON.stringify(
        {
          unshielded: w.addresses.unshielded,
          shielded: w.addresses.shielded,
          dust: w.addresses.dust,
          seedPath: w.seedPath,
          networkId: w.networkId,
        },
        null,
        2,
      ),
    );
    console.log('');
    console.log(
      `Seed persisted at ${w.seedPath}. Back this file up — if you lose it, you lose this wallet.`,
    );
  });

wallet
  .command('status')
  .description('show the current wallet addresses')
  .action(async () => {
    const w = await initWallet();
    try {
      console.log(JSON.stringify(w.addresses, null, 2));
    } finally {
      await stopWallet(w);
    }
  });

wallet
  .command('balances')
  .description('show balances (NIGHT, DUST, token kinds)')
  .action(async () => {
    const w = await initWallet();
    try {
      const b = await getBalances(w);
      console.log(JSON.stringify(b, bi, 2));
    } finally {
      await stopWallet(w);
    }
  });

// ─── launch ─────────────────────────────────────────────────────────────
const launch = program.command('launch').description('launch operations');

launch
  .command('deploy')
  .description('deploy a new launch contract')
  .requiredOption('--name <name>', 'token name')
  .requiredOption('--symbol <symbol>', 'token symbol')
  .requiredOption(
    '--decimals <n>',
    'token decimals (usually 6-9)',
    (v: string) => parseInt(v, 10),
  )
  .requiredOption('--image <uri>', 'image URI or content hash')
  .requiredOption(
    '--base-price <n>',
    'base price in NIGHT atoms (bigint)',
    (v: string) => BigInt(v),
  )
  .requiredOption(
    '--slope <n>',
    'slope in NIGHT atoms per token (bigint)',
    (v: string) => BigInt(v),
  )
  .requiredOption(
    '--max-supply <n>',
    'max tokens (bigint)',
    (v: string) => BigInt(v),
  )
  .requiredOption(
    '--fee-bps <n>',
    'total fee bps (0-2000)',
    (v: string) => parseInt(v, 10),
  )
  .requiredOption(
    '--platform-bps <n>',
    'platform share of fee (bps)',
    (v: string) => parseInt(v, 10),
  )
  .requiredOption(
    '--creator-bps <n>',
    'creator share of fee (bps)',
    (v: string) => parseInt(v, 10),
  )
  .requiredOption(
    '--referral-bps <n>',
    'referral share of fee (bps)',
    (v: string) => parseInt(v, 10),
  )
  .requiredOption('--platform-recipient <hex>', 'hex Bytes<32>')
  .option(
    '--creator-recipient <hex>',
    'hex Bytes<32>; defaults to deployer',
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (opts: any) => {
    const w = await initWallet();
    try {
      const creatorRecipient =
        opts.creatorRecipient ?? w.keys.shielded.keys.coinPublicKey;
      const handle = await deployLaunch(w, {
        metadata: {
          name: opts.name,
          symbol: opts.symbol,
          decimals: opts.decimals,
          imageUri: opts.image,
        },
        curve: {
          basePriceNight: opts.basePrice,
          slopeNight: opts.slope,
          maxSupply: opts.maxSupply,
        },
        fees: {
          feeBps: opts.feeBps,
          platformShareBps: opts.platformBps,
          creatorShareBps: opts.creatorBps,
          referralShareBps: opts.referralBps,
          platformRecipient: opts.platformRecipient,
          creatorRecipient,
        },
      });
      recordLaunch({
        contractAddress: handle.contractAddress,
        // TODO(v1): propagate from deployLaunch's return value if exposed
        deployTxId: '',
        deployedAt: new Date().toISOString(),
        name: handle.metadata.name,
        symbol: handle.metadata.symbol,
      });
      console.log(`Deployed ${handle.contractAddress}`);
      console.log(handle.explorerUrl);
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('list')
  .description('list known launches (local cache + indexer)')
  .action(async () => {
    const list = await listLaunches({ includeRemote: true });
    if (list.length === 0) {
      console.log(
        'No launches found (local cache empty and indexer returned none matching our code hash).',
      );
    } else {
      console.table(list);
    }
  });

launch
  .command('info <address>')
  .description('show a launch\'s current on-chain state')
  .action(async (address: string) => {
    const w = await initWallet();
    try {
      const handle = await connectLaunch(w, address);
      console.log(JSON.stringify(handle, bi, 2));
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('quote-buy <address>')
  .description('quote a buy without sending a tx')
  .requiredOption('--tokens <n>', 'n tokens', (v: string) => BigInt(v))
  .option('--referral <hex>', 'referral hex')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      console.log(
        JSON.stringify(
          quoteBuy(h, opts.tokens, opts.referral !== undefined),
          bi,
          2,
        ),
      );
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('quote-sell <address>')
  .description('quote a sell without sending a tx')
  .requiredOption('--tokens <n>', 'n tokens', (v: string) => BigInt(v))
  .option('--referral <hex>')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      console.log(
        JSON.stringify(
          quoteSell(h, opts.tokens, opts.referral !== undefined),
          bi,
          2,
        ),
      );
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('buy <address>')
  .description('buy nTokens from the bonding curve')
  .requiredOption('--tokens <n>', 'n tokens', (v: string) => BigInt(v))
  .option('--referral <hex>')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      const r = await buy(w, h, opts.tokens, opts.referral);
      console.log(`tx: ${r.txId}`);
      console.log(JSON.stringify({ quote: r.quote }, bi, 2));
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('sell <address>')
  .description('sell nTokens back to the bonding curve')
  .requiredOption('--tokens <n>', 'n tokens', (v: string) => BigInt(v))
  .option('--referral <hex>')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      const r = await sell(w, h, opts.tokens, opts.referral);
      console.log(`tx: ${r.txId}`);
      console.log(JSON.stringify({ quote: r.quote }, bi, 2));
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('transfer <address>')
  .description('transfer tokens to another address')
  .requiredOption('--to <hex>', 'recipient hex Bytes<32>')
  .requiredOption('--amount <n>', 'amount', (v: string) => BigInt(v))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      const r = await transfer(w, h, opts.to, opts.amount);
      console.log(`tx: ${r.txId}`);
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('withdraw-platform <address>')
  .description('sweep platform-accrued NIGHT to the platform recipient')
  .action(async (address: string) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      const r = await withdrawPlatform(w, h);
      console.log(`tx: ${r.txId}`);
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('withdraw-creator <address>')
  .description('sweep creator-accrued NIGHT to the creator')
  .action(async (address: string) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      const r = await withdrawCreator(w, h);
      console.log(`tx: ${r.txId}`);
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('withdraw-referral <address>')
  .description('sweep referrer-accrued NIGHT for <ref> to <ref>')
  .requiredOption('--ref <hex>', 'referrer hex Bytes<32>')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      const r = await withdrawReferral(w, h, opts.ref);
      console.log(`tx: ${r.txId}`);
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('fees <address>')
  .description('show platform/creator accrued NIGHT')
  .action(async (address: string) => {
    const w = await initWallet();
    try {
      const h = await connectLaunch(w, address);
      console.log(
        JSON.stringify(
          {
            platformAccrued: h.state.platformAccrued,
            creatorAccrued: h.state.creatorAccrued,
            note: 'Per-referral accruals: query via `getReferralAccrued(wallet, address, ref)` for specific refs.',
          },
          bi,
          2,
        ),
      );
    } finally {
      await stopWallet(w);
    }
  });

launch
  .command('verify-split <txId>')
  .description('confirm a tx exists on the preprod indexer (MVP)')
  .action(async (txId: string) => {
    const tx = await getTxByHash(txId);
    if (!tx) {
      console.error(`Transaction ${txId} not found on preprod indexer.`);
      process.exit(1);
    }
    console.log(JSON.stringify(tx, null, 2));
    console.log('');
    console.log(
      'Note: full accrual-delta verification requires historical contract state queries.',
    );
    console.log(
      'This MVP command confirms the tx exists and is finalized. v1 will diff expected split against on-chain accrual deltas.',
    );
    // TODO(v1): diff expected split against on-chain accrual deltas
  });

// ─── chain ──────────────────────────────────────────────────────────────
const chain = program.command('chain').description('chain utilities');

chain
  .command('health')
  .description('check preprod RPC node health')
  .action(async () => {
    console.log(JSON.stringify(await rpcHealth(), null, 2));
  });

chain
  .command('info')
  .description('fetch chain genesis / tip info')
  .action(async () => {
    console.log(JSON.stringify(await getChainInfo(), null, 2));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
