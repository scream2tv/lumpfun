/**
 * DR-1 spike runner: deploy `spike.compact` on preprod, probe deposit()/withdraw()
 * to verify that `receiveUnshielded(nativeToken(), amount)` and
 * `sendUnshielded(nativeToken(), amount, recipient)` actually move native NIGHT
 * between the wallet and the contract.
 *
 * Usage:
 *   MIDNIGHT_WALLET_DIR=/Users/scream2/.lumpfun \
 *     npx tsx spikes/dr1_native_night/run.ts
 *
 * The script:
 *   1. Inits the LumpFun wallet (preprod) and waits for sync.
 *   2. Logs NIGHT/DUST balances BEFORE.
 *   3. Deploys the compiled spike contract.
 *   4. Calls deposit(1_000_000)  — 0.001 tNIGHT.
 *   5. Logs NIGHT balance AFTER deposit.
 *   6. Calls withdraw(wallet_address, 500_000).
 *   7. Logs NIGHT balance AFTER withdraw.
 *   8. Prints a summary of tx hashes and balance deltas.
 *
 * If balances move as expected, outcome (a) applies: primitives work natively.
 */

import { WebSocket } from 'ws';
if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

import * as path from 'path';
import { pathToFileURL } from 'url';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { initWallet, getBalances, stopWallet, type InitializedWallet } from '../../src/wallet.js';
import { getConfig, explorerLink } from '../../src/config.js';

const SPIKE_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'managed/spike',
);

const NIGHT = ledger.nativeToken().raw;

const DEPOSIT_AMT = 1_000_000n;
const WITHDRAW_AMT = 500_000n;

async function loadCompiledSpike() {
  const contractModule = await import(
    pathToFileURL(path.join(SPIKE_DIR, 'contract', 'index.js')).href
  );
  return { contractModule, dir: SPIKE_DIR };
}

function createInMemoryPrivateStateProvider() {
  const store = new Map<string, unknown>();
  const signingKeys = new Map<string, unknown>();
  let contractAddress: string | null = null;
  return {
    setContractAddress(addr: string) { contractAddress = addr; },
    async get(key: string) { return store.get(`${contractAddress}:${key}`) ?? null; },
    async set(key: string, value: unknown) { store.set(`${contractAddress}:${key}`, value); },
    async remove(key: string) { store.delete(`${contractAddress}:${key}`); },
    async clear() {
      for (const k of store.keys()) if (k.startsWith(`${contractAddress}:`)) store.delete(k);
    },
    async getSigningKey(key: string) { return signingKeys.get(key) ?? null; },
    async setSigningKey(key: string, value: unknown) { signingKeys.set(key, value); },
    async removeSigningKey(key: string) { signingKeys.delete(key); },
    async clearSigningKeys() { signingKeys.clear(); },
  };
}

interface TransactionWithIntents { intents?: Map<number, any>; }

function signTransactionIntents(
  tx: TransactionWithIntents,
  signFn: (payload: Uint8Array) => any,
): void {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent: any = tx.intents.get(segment);
    if (!intent) continue;
    const sigData = intent.signatureData(segment);
    const signature = signFn(sigData);
    if (intent.fallibleUnshieldedOffer) {
      const offer = intent.fallibleUnshieldedOffer;
      const sigs = offer.inputs.map((_: unknown, i: number) => offer.signatures.at(i) ?? signature);
      intent.fallibleUnshieldedOffer = offer.addSignatures(sigs);
    }
    if (intent.guaranteedUnshieldedOffer) {
      const offer = intent.guaranteedUnshieldedOffer;
      const sigs = offer.inputs.map((_: unknown, i: number) => offer.signatures.at(i) ?? signature);
      intent.guaranteedUnshieldedOffer = offer.addSignatures(sigs);
    }
  }
}

async function createProviders(wallet: InitializedWallet, zkConfigDir: string) {
  const { httpClientProofProvider } = await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  );
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { NodeZkConfigProvider } = await import(
    '@midnight-ntwrk/midnight-js-node-zk-config-provider'
  );
  const config = getConfig();
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigDir);

  const submitWithPoolRetry = async (tx: unknown) => {
    const max = 5;
    let lastErr: unknown;
    for (let i = 1; i <= max; i++) {
      try {
        return await wallet.facade.submitTransaction(tx as never);
      } catch (e: unknown) {
        lastErr = e;
        const msg = `${e instanceof Error ? e.message : String(e)} ${
          e instanceof Error && (e as Error).cause != null ? String((e as Error).cause) : ''
        }`;
        const maybePool =
          msg.includes('1016') ||
          msg.includes('Immediately Dropped') ||
          /pool|limit|dropped|busy/i.test(msg);
        if (maybePool && i < max) {
          const waitMs = 25_000 * i;
          console.log(`  Submit failed (${i}/${max}) — retry in ${waitMs / 1000}s (${msg.slice(0, 120)})`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  };

  const walletProvider: any = {
    getCoinPublicKey: () => wallet.keys.shielded.keys.coinPublicKey,
    getEncryptionPublicKey: () => wallet.keys.shielded.keys.encryptionPublicKey,
    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await wallet.facade.balanceUnboundTransaction(
        tx as never,
        {
          shieldedSecretKeys: wallet.keys.shielded.keys,
          dustSecretKey: wallet.keys.dust.key,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => wallet.keystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction as TransactionWithIntents, signFn);
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction as TransactionWithIntents, signFn);
      }
      return wallet.facade.finalizeRecipe(recipe);
    },
    submitTx: (tx: unknown) => submitWithPoolRetry(tx),
  };

  return {
    privateStateProvider: createInMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proverUrl, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

function fmtNight(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = (raw % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toLocaleString()}.${frac} NIGHT`;
}

async function probeBalance(wallet: InitializedWallet, label: string) {
  const bal = await getBalances(wallet);
  const night = bal.unshielded[NIGHT] ?? 0n;
  console.log(`[balance @ ${label}] NIGHT=${fmtNight(night)} (raw=${night}) | dust-coins=${bal.dustCoinCount}`);
  return night;
}

async function main() {
  console.log('DR-1 spike: native NIGHT in/out of Compact contract\n');
  console.log(`  Network: ${getConfig().networkId}`);
  console.log(`  Wallet dir: ${process.env.MIDNIGHT_WALLET_DIR ?? '(default)'}\n`);

  console.log('=== Init wallet ===');
  const wallet = await initWallet();
  console.log(`  Unshielded address: ${wallet.addresses.unshielded}\n`);
  const nightBefore = await probeBalance(wallet, 'T0 (before deploy)');

  // Build the wallet's own unshielded recipient Either<ContractAddress, UserAddress>.
  // The sendUnshielded primitive expects Either<ContractAddress, UserAddress>
  // where both sides wrap Bytes<32>. We send to ourselves: is_left=false (right=user).
  const userAddrHex = wallet.keystore.getAddress();
  const userAddrBytes = Buffer.from(userAddrHex, 'hex');
  if (userAddrBytes.length !== 32) {
    console.warn(`  warning: userAddr is ${userAddrBytes.length} bytes, expected 32`);
  }
  const toWallet = {
    is_left: false,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: userAddrBytes },
  };
  console.log(`  User address bytes: 0x${userAddrHex}\n`);

  console.log('=== Load compiled spike ===');
  const { contractModule } = await loadCompiledSpike();
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');
  const { deployContract, findDeployedContract } = await import(
    '@midnight-ntwrk/midnight-js-contracts'
  );

  const compiledContract = (CompiledContract as any).make(
    'dr1_spike',
    contractModule.Contract,
  ).pipe(
    (CompiledContract as any).withVacantWitnesses,
    (CompiledContract as any).withCompiledFileAssets(SPIKE_DIR),
  );

  const providers = await createProviders(wallet, SPIKE_DIR);

  console.log('\n=== Deploy spike ===');
  const deployed: any = await (deployContract as any)(providers, {
    compiledContract,
    privateStateId: 'dr1State',
    initialPrivateState: {},
    args: [],
  });

  const contractAddress: string = deployed.deployTxData.public.contractAddress;
  const deployTxId: string = deployed.deployTxData.public.txId;
  console.log(`  Contract address: ${contractAddress}`);
  console.log(`  Deploy tx: ${deployTxId}`);
  console.log(`  Explorer: ${explorerLink(`/contract/${contractAddress}`)}\n`);

  // Small wait for indexer to catch up
  await new Promise((r) => setTimeout(r, 8_000));
  const nightAfterDeploy = await probeBalance(wallet, 'T1 (after deploy)');

  console.log(`\n=== Connect to deployed spike & call deposit(${DEPOSIT_AMT}) ===`);
  const connected: any = await (findDeployedContract as any)(providers, {
    contractAddress,
    compiledContract,
    privateStateId: 'dr1State',
    initialPrivateState: {},
  });

  let depositTxId: string | undefined;
  try {
    const depTx = await connected.callTx.deposit(DEPOSIT_AMT);
    depositTxId = depTx?.public?.txId ?? depTx?.txId;
    console.log(`  Deposit tx: ${depositTxId}`);
  } catch (e: any) {
    console.log(`  Deposit call failed: ${e?.message ?? e}`);
    console.log(`  Stack: ${e?.stack?.slice(0, 600)}`);
  }

  await new Promise((r) => setTimeout(r, 15_000));
  const nightAfterDeposit = await probeBalance(wallet, 'T2 (after deposit)');

  console.log(`\n=== Call withdraw(self, ${WITHDRAW_AMT}) ===`);
  let withdrawTxId: string | undefined;
  try {
    const wdTx = await connected.callTx.withdraw(toWallet, WITHDRAW_AMT);
    withdrawTxId = wdTx?.public?.txId ?? wdTx?.txId;
    console.log(`  Withdraw tx: ${withdrawTxId}`);
  } catch (e: any) {
    console.log(`  Withdraw call failed: ${e?.message ?? e}`);
    console.log(`  Stack: ${e?.stack?.slice(0, 600)}`);
  }

  await new Promise((r) => setTimeout(r, 15_000));
  const nightAfterWithdraw = await probeBalance(wallet, 'T3 (after withdraw)');

  console.log('\n=== Summary ===');
  console.log(`  Contract:                ${contractAddress}`);
  console.log(`  Deploy tx:               ${deployTxId}`);
  console.log(`  Deposit tx:              ${depositTxId ?? 'FAILED'}`);
  console.log(`  Withdraw tx:             ${withdrawTxId ?? 'FAILED'}`);
  console.log(`  NIGHT T0 (start):        ${nightBefore}`);
  console.log(`  NIGHT T1 (post-deploy):  ${nightAfterDeploy}`);
  console.log(`  NIGHT T2 (post-deposit): ${nightAfterDeposit}`);
  console.log(`  NIGHT T3 (post-withdraw):${nightAfterWithdraw}`);
  console.log(`  Δ T0→T1 (deploy fees):   ${nightAfterDeploy - nightBefore}`);
  console.log(`  Δ T1→T2 (deposit + fee): ${nightAfterDeposit - nightAfterDeploy}`);
  console.log(`  Δ T2→T3 (withdraw + fee):${nightAfterWithdraw - nightAfterDeposit}`);
  console.log(`  Expected deposit Δ: close to -${DEPOSIT_AMT} (plus tx fees in NIGHT? mostly DUST)`);
  console.log(`  Expected withdraw Δ: close to +${WITHDRAW_AMT}`);

  await stopWallet(wallet);
}

main().catch((e) => {
  console.error(`FATAL: ${e?.message ?? e}`);
  console.error(e?.stack);
  process.exit(1);
});
