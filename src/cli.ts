#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import {
  createWallet,
  initWallet,
  initWalletKeysOnly,
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
import { registerCardanoCommands } from './cardano/cli.js';

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
  .command('create-agents')
  .description('generate N agent wallets under ~/.lumpfun/agents/agent-<i>/')
  .requiredOption('--count <n>', 'number of agent wallets to create', (v) => parseInt(v, 10))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (opts: any) => {
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { existsSync, mkdirSync } = await import('fs');
    const baseDir = join(homedir(), '.lumpfun', 'agents');
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true, mode: 0o700 });

    const results: Array<{ index: number; dir: string; addresses: { unshielded: string; shielded: string; dust: string } }> = [];
    for (let i = 0; i < opts.count; i++) {
      const dir = join(baseDir, `agent-${i}`);
      if (existsSync(join(dir, 'seed.hex'))) {
        console.log(`agent-${i}: seed already exists at ${join(dir, 'seed.hex')} — skipping`);
        continue;
      }
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      const w = createWallet(dir);
      results.push({ index: i, dir, addresses: w.addresses });
    }
    console.log('');
    console.log(JSON.stringify(results, null, 2));
    console.log('');
    console.log(
      `Created ${results.length} agent wallets. Fund them from the main wallet via:\n` +
      `  npm run dev -- wallet send-night --agent <i> --amount <atoms>\n` +
      `or programmatically via scripts/fund-agents.mjs.`,
    );
  });

wallet
  .command('fund-agents')
  .description('send native tNIGHT to a range of agent wallets (one sync, N transfers)')
  .option('--agents <range>', 'agent indices: "0-4" or "0,2,4" or "0" (default: all available)')
  .requiredOption('--amount <atoms>', 'amount in NIGHT atoms per agent (e.g. 50000000 = 50 tNIGHT)')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (opts: any) => {
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { existsSync, readdirSync } = await import('fs');
    const ledger = await import('@midnight-ntwrk/ledger-v8');
    const { balanceAndSubmitViaSponsor } = await import('./night.js');
    const { loadSeed, deriveAllKeys, encodeAddresses } = await import('./wallet.js');
    const { MidnightBech32m, UnshieldedAddress } = await import('@midnight-ntwrk/wallet-sdk-address-format');
    const { getConfig } = await import('./config.js');
    const cfg = getConfig();

    const baseDir = join(homedir(), '.lumpfun', 'agents');
    if (!existsSync(baseDir)) {
      console.error(`No agents at ${baseDir}; run \`wallet create-agents --count N\` first.`);
      process.exit(1);
    }

    // Resolve target agent indices.
    let indices: number[];
    if (!opts.agents) {
      indices = readdirSync(baseDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^agent-(\d+)$/.test(e.name))
        .map((e) => Number(e.name.split('-')[1]))
        .sort((a, b) => a - b);
    } else if (opts.agents.includes('-')) {
      const [lo, hi] = opts.agents.split('-').map(Number);
      indices = []; for (let i = lo; i <= hi; i++) indices.push(i);
    } else {
      indices = opts.agents.split(',').map((s: string) => Number(s.trim()));
    }
    if (indices.length === 0) { console.error('No agents resolved'); process.exit(1); }

    // Resolve each agent's unshielded bech32 + decoded UnshieldedAddress.
    const targets = indices.map((i) => {
      const dir = join(baseDir, `agent-${i}`);
      if (!existsSync(join(dir, 'seed.hex'))) {
        throw new Error(`agent-${i}: no seed at ${dir}/seed.hex`);
      }
      const seed = loadSeed(dir);
      const keys = deriveAllKeys(seed);
      seed.fill(0);
      const bech = encodeAddresses(keys, cfg.networkId).unshielded;
      const decoded = MidnightBech32m.parse(bech).decode(UnshieldedAddress, cfg.networkId);
      return { index: i, bech, decoded };
    });

    const amount = BigInt(opts.amount);
    const required = amount * BigInt(targets.length);
    console.log(`Funding ${targets.length} agent(s) with ${amount} atoms each (${(Number(amount) / 1e6).toFixed(6)} tNIGHT).`);
    console.log('Initializing main wallet (no global sync wait)...');
    const w = await initWallet(undefined, { waitForSync: false });

    const { waitForUnshieldedBalance } = await import('./wallet.js');
    const nativeToken = ledger.nativeToken().raw;
    console.log(`Waiting for unshielded NIGHT balance >= ${required} atoms (just unshielded sub-wallet, not shielded/DUST)...`);
    try {
      const balance = await waitForUnshieldedBalance(w, nativeToken, required, 10 * 60 * 1000);
      console.log(`Unshielded NIGHT ready: ${balance} atoms.`);
    } catch (e) {
      console.error('Timed out waiting for unshielded balance:', e instanceof Error ? e.message : String(e));
      await stopWallet(w);
      process.exit(1);
    }

    try {
      // Inspect a recipe's intents for at least one unshielded offer output.
      // The wallet's first transferTransaction after a fresh init can silently
      // produce an empty offer — 1AM still balances + submits, the tx lands
      // as a DUST-only no-op, and the recipient gets nothing. Catch + retry.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipeHasOutputs = (recipe: any): boolean => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = recipe?.transaction ?? recipe?.baseTransaction;
        if (!tx?.intents) return false;
        for (const [, intent] of tx.intents) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ints = intent as any;
          for (const offer of [ints.guaranteedUnshieldedOffer, ints.fallibleUnshieldedOffer]) {
            if (offer && offer.outputs && offer.outputs.length > 0) return true;
          }
        }
        return false;
      };

      const buildRecipe = async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (w.facade as any).transferTransaction(
          [{
            type: 'unshielded',
            outputs: [{ amount, receiverAddress: targets[0].decoded, type: ledger.nativeToken().raw }],
          }],
          { shieldedSecretKeys: w.keys.shielded.keys, dustSecretKey: w.keys.dust.key },
          { ttl: new Date(Date.now() + 30 * 60 * 1000), payFees: false },
        );
      };

      // Warm-up: build a throwaway recipe so the wallet's first-call no-op
      // happens on a discarded recipe instead of the real first transfer.
      console.log('Warming up wallet (discarded first recipe)...');
      try {
        const warm = await buildRecipe();
        if (process.env.LUMPFUN_DEBUG_TX === '1') {
          console.log(`  warm-up recipe has outputs: ${recipeHasOutputs(warm)}`);
        }
      } catch (e) {
        console.log(`  warm-up failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }

      for (let idx = 0; idx < targets.length; idx++) {
        const t = targets[idx];
        console.log(`\n→ agent-${t.index} (${t.bech.slice(0, 24)}…)`);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let recipe: any;
          const maxRecipeRetries = 3;
          for (let attempt = 1; attempt <= maxRecipeRetries; attempt++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recipe = await (w.facade as any).transferTransaction(
              [{
                type: 'unshielded',
                outputs: [{ amount, receiverAddress: t.decoded, type: ledger.nativeToken().raw }],
              }],
              { shieldedSecretKeys: w.keys.shielded.keys, dustSecretKey: w.keys.dust.key },
              { ttl: new Date(Date.now() + 30 * 60 * 1000), payFees: false },
            );
            if (recipeHasOutputs(recipe)) break;
            if (attempt < maxRecipeRetries) {
              console.log(`  recipe attempt ${attempt}: empty unshielded offer; retrying in 10s...`);
              await new Promise((r) => setTimeout(r, 10_000));
            } else {
              throw new Error('transferTransaction produced empty unshielded offer after 3 attempts');
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const signed = await (w.facade as any).signRecipe(recipe, (payload: Uint8Array) => w.keystore.signData(payload));

          // Recipe shape varies by source:
          //   balanceUnboundTransaction → UnboundTransactionRecipe { baseTransaction }
          //     → use signed.baseTransaction directly (proof + PreBinding,
          //       header signature[v1],proof,embedded-fr[v1] — what 1AM wants)
          //   transferTransaction       → UnprovenTransactionRecipe { transaction }
          //     → unproven UnprovenTransaction. Need to .prove() it (PreBinding
          //       preserved) so the header becomes signature[v1],proof,embedded-fr.
          //       finalizeRecipe would also produce a "bound" tx but with
          //       pedersen-schnorr binding which 1AM rejects.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s = signed as any;
          let bytes: Uint8Array;
          if (s.type === 'UNPROVEN_TRANSACTION') {
            const cfg = getConfig();
            const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
            const { NodeZkConfigProvider } = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');
            const { resolve } = await import('path');
            // For unshielded transfers there's no contract circuit to prove —
            // the prover just passes through. ZK config dir doesn't matter
            // structurally; point at the demo contract's managed dir as a
            // placeholder.
            const zkConfigProvider = new NodeZkConfigProvider(resolve(process.cwd(), 'contracts/managed/lump_launch'));
            const proofProvider = httpClientProofProvider(cfg.proverUrl, zkConfigProvider);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const proven = await proofProvider.proveTx(s.transaction as any);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            bytes = (proven as any).serialize();
          } else if (s.baseTransaction) {
            bytes = s.baseTransaction.serialize();
          } else if (s.transaction) {
            bytes = s.transaction.serialize();
          } else {
            throw new Error(`signed recipe shape unexpected (type=${s.type ?? 'unknown'}, keys=${Object.keys(s).join(',')})`);
          }
          const result = await balanceAndSubmitViaSponsor(bytes, { debug: process.env.LUMPFUN_DEBUG_TX === '1' });
          console.log(`  tx: ${result.txHash}`);

          // Wait for the wallet's unshielded sub-wallet to observe the on-chain
          // change UTXO before building the next transfer; otherwise we trip
          // InsufficientFunds when the SDK reads stale state. ~3 preprod blocks.
          if (idx < targets.length - 1) {
            console.log('  waiting 20s for unshielded state to refresh...');
            await new Promise(r => setTimeout(r, 20_000));
          }
        } catch (e) {
          console.error(`  agent-${t.index} failed:`, e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      await stopWallet(w);
    }
  });

wallet
  .command('run-agents')
  .description('continuously buy/sell against a launch contract from agent wallets')
  .requiredOption('--contract <hex>', 'target launch contract address (32-byte hex)')
  .option('--iterations <n>', 'stop after N actions (default: unlimited)', (v) => parseInt(v, 10))
  .option('--min-interval <s>', 'min seconds between actions', (v) => parseInt(v, 10), 15)
  .option('--max-interval <s>', 'max seconds between actions', (v) => parseInt(v, 10), 60)
  .option('--min-tokens <n>', 'min tokens per action', '5')
  .option('--max-tokens <n>', 'max tokens per action', '50')
  .option('--force-buy-below <n>', 'if inventory < this, force buy', '5')
  .option('--force-sell-above <n>', 'if inventory > this, force sell', '200')
  .option('--min-night-balance <atoms>', 'skip agent if unshielded balance < this', '1000000')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (opts: any) => {
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { existsSync, readdirSync } = await import('fs');
    const ledger = await import('@midnight-ntwrk/ledger-v8');
    const { waitForUnshieldedBalance, waitForUnshieldedBalanceViaIndexer, loadSeed, deriveAllKeys, encodeAddresses } = await import('./wallet.js');
    const { getConfig: gc } = await import('./config.js');
    const cfg = gc();

    const baseDir = join(homedir(), '.lumpfun', 'agents');
    if (!existsSync(baseDir)) {
      console.error(`No agents at ${baseDir}; run \`wallet create-agents --count N\` first.`);
      process.exit(1);
    }
    const agentDirs = readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^agent-(\d+)$/.test(e.name))
      .map((e) => ({ index: Number(e.name.split('-')[1]), dir: join(baseDir, e.name) }))
      .filter((a) => existsSync(join(a.dir, 'seed.hex')))
      .sort((a, b) => a.index - b.index);
    if (agentDirs.length === 0) { console.error('No funded agents found'); process.exit(1); }

    console.log(`Running ${agentDirs.length} agents against ${opts.contract}.`);
    console.log(`Token range ${opts.minTokens}–${opts.maxTokens}, interval ${opts.minInterval}–${opts.maxInterval}s.`);

    const minTokens = BigInt(opts.minTokens);
    const maxTokens = BigInt(opts.maxTokens);
    const forceBuyBelow = BigInt(opts.forceBuyBelow);
    const forceSellAbove = BigInt(opts.forceSellAbove);
    const minNightBalance = BigInt(opts.minNightBalance);

    const inventory = new Map<number, bigint>();
    for (const a of agentDirs) inventory.set(a.index, 0n);

    const nativeToken = ledger.nativeToken().raw;
    const rand = (lo: number, hi: number) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
    const randBig = (lo: bigint, hi: bigint) => lo + BigInt(Math.floor(Math.random() * Number(hi - lo + 1n)));

    let actionCount = 0;
    const maxActions = opts.iterations ?? Infinity;
    while (actionCount < maxActions) {
      const agent = agentDirs[Math.floor(Math.random() * agentDirs.length)];
      const inv = inventory.get(agent.index) ?? 0n;

      let side: 'buy' | 'sell';
      if (inv < forceBuyBelow) side = 'buy';
      else if (inv > forceSellAbove) side = 'sell';
      else side = Math.random() < 0.5 ? 'buy' : 'sell';

      const tokens = randBig(minTokens, maxTokens);
      const effectiveTokens = side === 'sell' ? (tokens > inv ? inv : tokens) : tokens;
      if (side === 'sell' && effectiveTokens === 0n) {
        side = 'buy';  // can't sell from empty
      }

      console.log(`\n[#${actionCount + 1}] agent-${agent.index} → ${side} ${effectiveTokens} (inv=${inv})`);

      // Pre-check via indexer: skip agents that genuinely have no on-chain
      // funding without sinking ~minutes on a facade sub-wallet that will
      // never resolve. Cheap (~1-2s).
      try {
        const seed = loadSeed(agent.dir);
        const keys = deriveAllKeys(seed);
        seed.fill(0);
        const agentAddr = encodeAddresses(keys, cfg.networkId).unshielded;
        await waitForUnshieldedBalanceViaIndexer(agentAddr, nativeToken, minNightBalance, 30_000, 4_000, 5000);
      } catch (e) {
        console.error(`  ✗ agent-${agent.index} has no on-chain unshielded balance — skipping`);
        if (actionCount < maxActions) {
          const sleepMs = rand(opts.minInterval, opts.maxInterval) * 1000;
          console.log(`  sleep ${(sleepMs / 1000).toFixed(0)}s…`);
          await new Promise((r) => setTimeout(r, sleepMs));
        }
        continue;
      }

      try {
        const w = await initWallet(agent.dir, { waitForSync: false });
        try {
          // Indexer confirmed UTXOs exist; now give facade a generous window
          // to subscribe + observe them (typically <60s but can spike).
          await waitForUnshieldedBalance(w, nativeToken, minNightBalance, 10 * 60 * 1000);
          const handle = await connectLaunch(w, opts.contract);
          if (side === 'buy') {
            const r = await buy(w, handle, effectiveTokens);
            inventory.set(agent.index, inv + effectiveTokens);
            console.log(`  ✓ buy tx ${r.txId} (new inv: ${inv + effectiveTokens})`);
          } else {
            const r = await sell(w, handle, effectiveTokens);
            inventory.set(agent.index, inv - effectiveTokens);
            console.log(`  ✓ sell tx ${r.txId} (new inv: ${inv - effectiveTokens})`);
          }
          actionCount++;
        } finally {
          await stopWallet(w);
        }
      } catch (e) {
        console.error(`  ✗ ${side} failed:`, e instanceof Error ? e.message : String(e));
      }

      if (actionCount < maxActions) {
        const sleepMs = rand(opts.minInterval, opts.maxInterval) * 1000;
        console.log(`  sleep ${(sleepMs / 1000).toFixed(0)}s…`);
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }
    console.log(`\nDone after ${actionCount} actions.`);
  });

wallet
  .command('list-agents')
  .description('list agent wallets under ~/.lumpfun/agents/')
  .action(async () => {
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { readdirSync, existsSync } = await import('fs');
    const { loadSeed, deriveAllKeys, encodeAddresses } = await import('./wallet.js');
    const { getConfig } = await import('./config.js');
    const baseDir = join(homedir(), '.lumpfun', 'agents');
    if (!existsSync(baseDir)) {
      console.log('No agents directory at', baseDir);
      return;
    }
    const networkId = getConfig().networkId;
    const entries = readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('agent-'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const agents = entries.map((e) => {
      const dir = join(baseDir, e.name);
      if (!existsSync(join(dir, 'seed.hex'))) return null;
      const seed = loadSeed(dir);
      const keys = deriveAllKeys(seed);
      seed.fill(0);
      const addresses = encodeAddresses(keys, networkId);
      return { name: e.name, dir, addresses };
    }).filter(Boolean);
    console.log(JSON.stringify(agents, null, 2));
  });

wallet
  .command('status')
  .description('show the current wallet addresses')
  .action(async () => {
    const w = initWalletKeysOnly();
    try {
      console.log(JSON.stringify(w.addresses, null, 2));
    } finally {
      // keys-only wallet has no facade to stop
    }
  });

wallet
  .command('balances')
  .description('show balances (NIGHT, DUST, token kinds) — requires full chain sync')
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
  .option('--no-sponsor', 'disable 1AM gas sponsorship; use local DUST wallet instead')
  .option('--remote-submit-url <url>', 'override the gas-sponsor base URL (default: https://api-preprod.1am.xyz)')
  .option('--remote-api-key <key>', 'override the gas-sponsor API key (env: ONEAM_API_KEY)')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (opts: any) => {
    // Commander's --no-sponsor flips opts.sponsor to false. Default is sponsored.
    const useSponsorship = opts.sponsor !== false;
    const w = useSponsorship ? initWalletKeysOnly() : await initWallet();
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
      }, {
        useGasSponsorship: useSponsorship,
        remoteSubmitUrl: opts.remoteSubmitUrl,
        remoteApiKey: opts.remoteApiKey,
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
      // initWalletKeysOnly has no facade to stop; only stop the full-sync wallet.
      if (!useSponsorship) await stopWallet(w);
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
    const w = initWalletKeysOnly();
    try {
      const handle = await connectLaunch(w, address);
      console.log(JSON.stringify(handle, bi, 2));
    } finally {
      // keys-only wallet has no facade to stop
    }
  });

launch
  .command('quote-buy <address>')
  .description('quote a buy without sending a tx')
  .requiredOption('--tokens <n>', 'n tokens', (v: string) => BigInt(v))
  .option('--referral <hex>', 'referral hex')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = initWalletKeysOnly();
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
      // keys-only wallet has no facade to stop
    }
  });

launch
  .command('quote-sell <address>')
  .description('quote a sell without sending a tx')
  .requiredOption('--tokens <n>', 'n tokens', (v: string) => BigInt(v))
  .option('--referral <hex>')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = initWalletKeysOnly();
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
      // keys-only wallet has no facade to stop
    }
  });

launch
  .command('buy <address>')
  .description('buy nTokens from the bonding curve')
  .requiredOption('--tokens <n>', 'n tokens', (v: string) => BigInt(v))
  .option('--referral <hex>')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (address: string, opts: any) => {
    const w = await initWallet(undefined, { waitForSync: false });
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
    const w = await initWallet(undefined, { waitForSync: false });
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
    const w = await initWallet(undefined, { waitForSync: false });
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
    const w = await initWallet(undefined, { waitForSync: false });
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
    const w = await initWallet(undefined, { waitForSync: false });
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
    const w = await initWallet(undefined, { waitForSync: false });
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
    const w = initWalletKeysOnly();
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
      // keys-only wallet has no facade to stop
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

registerCardanoCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
