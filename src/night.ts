/**
 * NIGHT payment adapter — the DR-1 seam.
 *
 * The launchpad's Compact circuits (buy, sell, withdraw_*) declare
 * unshielded token transfers via `receiveUnshielded(nativeToken(), amount)`
 * and `sendUnshielded(nativeToken(), amount, recipient)`. For these to
 * succeed on-chain, the wallet SDK must attach matching unshielded NIGHT
 * UTXOs to the transaction. `balanceUnboundTransaction` with
 * `tokenKindsToBalance: 'all'` is the API that does this (the default
 * 'dust' only balances tx fees, which is what broke the Task 3 DR-1 spike).
 *
 * See spikes/dr1_native_night/OUTCOME.md for the full rationale.
 */

import type { InitializedWallet } from './wallet.js';
import { getConfig, assertPreprod } from './config.js';

/**
 * Build the providers bag that @midnight-ntwrk/midnight-js-contracts expects
 * for deploy/connect, wired so that contract calls requiring unshielded
 * NIGHT inputs (e.g., `buy`) get matching UTXOs attached at tx-assembly
 * time.
 *
 * @param wallet — initialized via initWallet() from ./wallet.js
 * @param zkConfigDir — absolute path to the compiled contract's managed dir
 *                      (e.g., contracts/managed/lump_launch)
 */
export async function createContractProviders(
  wallet: InitializedWallet,
  zkConfigDir: string,
) {
  assertPreprod();

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

  const walletProvider = {
    getCoinPublicKey: () => wallet.keys.shielded.keys.coinPublicKey,
    getEncryptionPublicKey: () => wallet.keys.shielded.keys.encryptionPublicKey,

    async balanceTx(tx: unknown, ttl?: Date) {
      if (process.env.LUMPFUN_DEBUG_TX === '1') dumpTx('BEFORE balance', tx);

      const recipe = await wallet.facade.balanceUnboundTransaction(
        tx as never,
        {
          shieldedSecretKeys: wallet.keys.shielded.keys,
          dustSecretKey: wallet.keys.dust.key,
        },
        {
          tokenKindsToBalance: 'all', // <-- the DR-1 fix; default 'dust' won't attach NIGHT
          ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
        },
      );

      if (process.env.LUMPFUN_DEBUG_TX === '1') {
        dumpTx('AFTER balance (baseTransaction)', recipe.baseTransaction);
        if (recipe.balancingTransaction) dumpTx('AFTER balance (balancingTransaction)', recipe.balancingTransaction);
      }

      const signFn = (payload: Uint8Array) => wallet.keystore.signData(payload);

      signTransactionIntents(
        recipe.baseTransaction as TransactionWithIntents,
        signFn,
      );
      if (recipe.balancingTransaction) {
        signTransactionIntents(
          recipe.balancingTransaction as TransactionWithIntents,
          signFn,
        );
      }

      if (process.env.LUMPFUN_DEBUG_TX === '1') {
        dumpTx('AFTER sign (baseTransaction)', recipe.baseTransaction);
        if (recipe.balancingTransaction) dumpTx('AFTER sign (balancingTransaction)', recipe.balancingTransaction);
      }

      const finalized = await wallet.facade.finalizeRecipe(recipe);

      if (process.env.LUMPFUN_DEBUG_TX === '1') dumpTx('AFTER finalize', finalized);

      return finalized;
    },

    submitTx: (tx: unknown) => wallet.facade.submitTransaction(tx as never),
  };

  return {
    privateStateProvider: createInMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUrl,
      config.indexerWsUrl,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proverUrl, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── In-memory private-state provider ────────────────────────────────────

function createInMemoryPrivateStateProvider() {
  const store = new Map<string, unknown>();
  const signingKeys = new Map<string, unknown>();
  let contractAddress: string | null = null;

  return {
    setContractAddress(a: string) {
      contractAddress = a;
    },
    async get(k: string) {
      return store.get(`${contractAddress}:${k}`) ?? null;
    },
    async set(k: string, v: unknown) {
      store.set(`${contractAddress}:${k}`, v);
    },
    async remove(k: string) {
      store.delete(`${contractAddress}:${k}`);
    },
    async clear() {
      for (const k of store.keys())
        if (k.startsWith(`${contractAddress}:`)) store.delete(k);
    },
    async getSigningKey(k: string) {
      return signingKeys.get(k) ?? null;
    },
    async setSigningKey(k: string, v: unknown) {
      signingKeys.set(k, v);
    },
    async removeSigningKey(k: string) {
      signingKeys.delete(k);
    },
    async clearSigningKeys() {
      signingKeys.clear();
    },
  };
}

// ─── Transaction signing helpers (ported from reference) ─────────────────

interface TransactionWithIntents {
  intents?: Map<number, IntentLike>;
}

interface IntentLike {
  signatureData(segment: number): Uint8Array;
  fallibleUnshieldedOffer?: OfferLike;
  guaranteedUnshieldedOffer?: OfferLike;
}

interface OfferLike {
  inputs: unknown[];
  signatures: { at(i: number): unknown };
  addSignatures(sigs: unknown[]): OfferLike;
}

function dumpTx(label: string, tx: unknown): void {
  const t = tx as TransactionWithIntents;
  const intents = t.intents;
  if (!intents || intents.size === 0) {
    console.log(`[LUMPFUN_DEBUG_TX] ${label}: no intents`);
    return;
  }
  for (const [segmentId, intent] of intents.entries()) {
    const g = (intent as any).guaranteedUnshieldedOffer;
    const f = (intent as any).fallibleUnshieldedOffer;
    const describe = (name: string, offer: any) => {
      if (!offer) return `${name}=none`;
      const ins = offer.inputs?.length ?? '?';
      const outs = offer.outputs?.length ?? '?';
      let sigs = '?';
      try {
        const arr: unknown[] = [];
        for (let i = 0; i < (offer.inputs?.length ?? 0); i++) {
          arr.push(offer.signatures.at(i));
        }
        sigs = `${arr.length} (non-null: ${arr.filter((s) => s != null).length})`;
      } catch {}
      return `${name}=[in:${ins} out:${outs} sig:${sigs}]`;
    };
    console.log(`[LUMPFUN_DEBUG_TX] ${label} seg=${segmentId}: ${describe('guar', g)} ${describe('fall', f)}`);
  }
}

function signTransactionIntents(
  tx: TransactionWithIntents,
  signFn: (payload: Uint8Array) => unknown,
): void {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const sigData = intent.signatureData(segment);
    const signature = signFn(sigData);

    if (intent.fallibleUnshieldedOffer) {
      const offer = intent.fallibleUnshieldedOffer;
      const sigs = offer.inputs.map(
        (_: unknown, i: number) => offer.signatures.at(i) ?? signature,
      );
      intent.fallibleUnshieldedOffer = offer.addSignatures(sigs);
    }

    if (intent.guaranteedUnshieldedOffer) {
      const offer = intent.guaranteedUnshieldedOffer;
      const sigs = offer.inputs.map(
        (_: unknown, i: number) => offer.signatures.at(i) ?? signature,
      );
      intent.guaranteedUnshieldedOffer = offer.addSignatures(sigs);
    }
  }
}
