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

import { WebSocket } from 'ws';
import type { InitializedWallet } from './wallet.js';
import { getConfig, assertPreprod } from './config.js';
import { rpcCall } from './chain.js';

/**
 * Submit a hex-encoded extrinsic via the Midnight node's WebSocket RPC.
 *
 * The public HTTP RPC at https://rpc.preprod.midnight.network/ returns 403
 * for write methods (author_submitExtrinsic, transaction_v1_broadcast).
 * The same methods work over WSS. The SDK's wallet.facade.submitTransaction
 * also goes through WSS for the same reason.
 */
async function submitExtrinsicWss(wssUrl: string, hexExtrinsic: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wssUrl);
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      reject(err);
    };

    const timeout = setTimeout(() => fail(new Error('WSS submit timed out after 30s')), 30_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'author_submitExtrinsic',
        params: [hexExtrinsic],
      }));
    });

    ws.on('message', (data: Buffer) => {
      let msg: { id?: number; result?: string; error?: { code: number; message: string } };
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return fail(new Error(`WSS submit: malformed response: ${data.toString().slice(0, 200)}`));
      }
      if (msg.id !== 1) return;
      clearTimeout(timeout);
      settled = true;
      ws.close();
      if (msg.error) {
        reject(new Error(`WSS submit RPC error ${msg.error.code}: ${msg.error.message}`));
      } else if (typeof msg.result === 'string') {
        resolve(msg.result);
      } else {
        reject(new Error('WSS submit: response had no result or error'));
      }
    });

    ws.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
}

export interface CreateProvidersOptions {
  /**
   * If true (default), skip the local WalletFacade's balanceUnboundTransaction
   * path entirely and instead POST the proven tx to a remote balancer (1AM
   * preprod by default). The remote service adds DUST input from its sponsor
   * wallet, signs the fee, and submits to the node — no DUST registration on
   * our side, no buggy SDK indexer-sync subscription. Requires only a
   * keys-only wallet (initWalletKeysOnly).
   *
   * If false, use the historical local-balance path (requires a fully synced
   * WalletFacade with DUST registered).
   */
  useGasSponsorship?: boolean;

  /** Base URL of the remote balancer. Defaults to 1AM preprod. */
  remoteSubmitUrl?: string;

  /** Optional 1AM API key (X-API-Key header). Unauthenticated works but is
   *  rate-limited. */
  remoteApiKey?: string;
}

/**
 * Build the providers bag that @midnight-ntwrk/midnight-js-contracts expects
 * for deploy/connect.
 *
 * Two modes, selected by `useGasSponsorship`:
 *   - **sponsored (default)** — the walletProvider.balanceTx hook POSTs the
 *     proven tx to ${remoteSubmitUrl}/balance-and-submit; the remote balancer
 *     adds DUST and submits. submitTx returns the cached txHash.
 *   - **local-balance** — the historical path; calls the local WalletFacade
 *     to balance + sign DUST + submit. Requires a fully-synced facade.
 *
 * @param wallet — initWallet() for local-balance mode, initWalletKeysOnly() for sponsored.
 * @param zkConfigDir — absolute path to the compiled contract's managed dir
 *                      (e.g., contracts/managed/lump_launch)
 */
export async function createContractProviders(
  wallet: InitializedWallet,
  zkConfigDir: string,
  options?: CreateProvidersOptions,
) {
  assertPreprod();

  const useSponsorship = options?.useGasSponsorship ?? true;
  const remoteSubmitUrl =
    options?.remoteSubmitUrl
    ?? process.env.MIDNIGHT_REMOTE_SUBMIT_URL
    ?? 'https://api-preprod.1am.xyz';
  const remoteApiKey = options?.remoteApiKey ?? process.env.ONEAM_API_KEY;

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

  const walletProvider = useSponsorship
    ? buildSponsoredWalletProvider(wallet, remoteSubmitUrl, remoteApiKey)
    : buildLocalWalletProvider(wallet);

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

// ─── Wallet provider builders ───────────────────────────────────────────

function buildLocalWalletProvider(wallet: InitializedWallet) {
  return {
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

      signTransactionIntents(recipe.baseTransaction as TransactionWithIntents, signFn);
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction as TransactionWithIntents, signFn);
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
}

/**
 * Sponsored balancer: POST the proven tx to the remote balancer's
 * /balance-and-submit endpoint. The remote service adds DUST from its
 * sponsor wallet, signs the fee, submits to the node, and returns
 * { txHash, contractAddresses }. We cache the txHash so submitTx can
 * return it when the SDK calls it next.
 *
 * The DR-1 "attach unshielded NIGHT for buys/sells" concern is moot here
 * because the local proofProvider has already produced the proven tx with
 * the wallet's NIGHT inputs/outputs baked in; the remote balancer only
 * adds the DUST fee input.
 */
function buildSponsoredWalletProvider(
  wallet: InitializedWallet,
  remoteSubmitUrl: string,
  remoteApiKey?: string,
) {
  let cachedTxHash: string | null = null;
  let cachedContractAddresses: Record<string, string> | undefined;

  const provider = {
    getCoinPublicKey: () => wallet.keys.shielded.keys.coinPublicKey,
    getEncryptionPublicKey: () => wallet.keys.shielded.keys.encryptionPublicKey,

    /** Exposed for callers that need the deploy's contract addresses. */
    getContractAddresses: () => cachedContractAddresses,

    async balanceTx(tx: unknown, _ttl?: Date) {
      if (process.env.LUMPFUN_DEBUG_TX === '1') dumpTx('BEFORE sponsored balance', tx);

      const provenBytes = (tx as { serialize(): Uint8Array }).serialize();
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-Client-Name': 'lumpfun',
      };
      if (remoteApiKey) headers['X-API-Key'] = remoteApiKey;

      // Preprod 1AM exposes /balance (which returns the balanced tx hex with
      // submitted:false). We submit it ourselves via RPC below. Mainnet 1AM
      // additionally exposes /balance-and-submit; we may switch endpoints
      // based on network later.
      const url = `${remoteSubmitUrl}/balance`;
      const maxRetries = 5;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (process.env.LUMPFUN_DEBUG_TX === '1') {
          console.log(`  POST ${url} (attempt ${attempt}/${maxRetries}) — ${provenBytes.length} bytes`);
        }
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: provenBytes as unknown as BodyInit,
        });
        const respText = await resp.text();

        if (resp.ok) {
          const result = JSON.parse(respText) as {
            tx?: string;
            txBytes?: string;
            txHash?: string;
            hash?: string;
            txId?: string;
            submitted?: boolean;
            contractAddresses?: Record<string, string>;
          };
          const txHash = result.txHash ?? result.hash;
          // Preprod returns `txBytes`; mainnet spec says `tx`. Accept both.
          const balancedHex = result.tx ?? result.txBytes;
          if (!txHash || !balancedHex) {
            throw new Error(`balancer response missing tx or txHash: ${respText.slice(0, 200)}`);
          }

          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  balanced: txHash=${txHash}, hex=${balancedHex.length} chars, submitted=${result.submitted}`);
          }

          if (result.submitted) {
            // Mainnet 1AM's /balance-and-submit already broadcast; nothing more to do.
            cachedTxHash = txHash;
            cachedContractAddresses = result.contractAddresses;
            return tx;
          }

          // Preprod /balance returns a balanced-but-unsubmitted hex tx. The
          // public HTTPS RPC blocks write methods (403); submit over WSS.
          const hexPayload = balancedHex.startsWith('0x') ? balancedHex : `0x${balancedHex}`;
          const wssUrl = getConfig().rpcWssUrl;
          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  submitting balanced tx via ${wssUrl} author_submitExtrinsic...`);
          }
          const submitHash = await submitExtrinsicWss(wssUrl, hexPayload);
          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  WSS submit ok: ${submitHash}`);
          }
          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  RPC submit ok: ${txHash}`);
          }

          cachedTxHash = txHash;
          cachedContractAddresses = result.contractAddresses;
          return tx;
        }

        // Retry on transient errors with the server's hint.
        let retryMs = 60_000;
        try {
          const err = JSON.parse(respText) as { retryAfterMs?: number; error?: string; message?: string };
          if (typeof err.retryAfterMs === 'number') retryMs = err.retryAfterMs;
          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  sponsored error (${resp.status}): ${err.error ?? ''} — ${err.message ?? respText.slice(0, 200)}`);
          }
        } catch {
          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  sponsored error (${resp.status}): ${respText.slice(0, 200)}`);
          }
        }

        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryMs));
        }
      }

      throw new Error(`Sponsored deploy failed: ${url} exhausted ${maxRetries} retries`);
    },

    submitTx(_tx: unknown): Promise<string> {
      if (!cachedTxHash) {
        throw new Error('submitTx called before balanceTx in sponsored mode — order invariant violated');
      }
      return Promise.resolve(cachedTxHash);
    },
  };

  return provider;
}
