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
import { rpcCall } from './chain.js';

const NATIVE_TOKEN_TYPE = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Walks recent indexer blocks for unspent native-NIGHT UTXOs owned by `address`.
 *
 * v0 implementation: scans the last `blocksBack` blocks. Adds new outputs to
 * the candidate set, removes any spent in the same window. Good enough for
 * a fresh preprod wallet whose funding tx is recent. Long-term: maintain a
 * persistent index keyed by the wallet, or use the indexer's
 * `unshieldedTransactions(address)` subscription stream.
 *
 * Returns native NIGHT UTXOs only; ignores other token types.
 */
interface UnspentUtxo {
  intentHash: string;
  outputIndex: number;
  value: bigint;
}

async function fetchUnspentNightUtxos(
  address: string,
  blocksBack: number,
): Promise<UnspentUtxo[]> {
  const indexerUrl = getConfig().indexerUrl;
  const headQuery = `{ b: block { height } }`;
  const headRes = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: headQuery }),
  });
  const headJson = (await headRes.json()) as { data?: { b?: { height: number } } };
  const headHeightMaybe = headJson.data?.b?.height;
  if (!headHeightMaybe) throw new Error('indexer: could not get head height');
  const headHeight: number = headHeightMaybe;

  const candidates = new Map<string, UnspentUtxo>(); // key = `${intentHash}:${outputIndex}`
  const BATCH = 5;
  const CONCURRENCY = 8;

  const FIELDS = `
    height
    transactions {
      hash
      unshieldedCreatedOutputs { owner value tokenType intentHash outputIndex }
      unshieldedSpentOutputs { intentHash outputIndex }
    }
  `;

  const starts: number[] = [];
  for (let s = 0; s < blocksBack; s += BATCH) starts.push(s);

  async function scanBatch(start: number) {
    const aliases: string[] = [];
    for (let i = start; i < Math.min(start + BATCH, blocksBack); i++) {
      const h = headHeight - i;
      if (h <= 0) continue;
      aliases.push(`b${i}: block(offset: { height: ${h} }) { ${FIELDS} }`);
    }
    if (aliases.length === 0) return;
    const res = await fetch(indexerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ ${aliases.join(' ')} }` }),
    });
    if (!res.ok) return;
    const j = (await res.json()) as { data?: Record<string, {
      transactions: Array<{
        unshieldedCreatedOutputs: Array<{ owner: string; value: string; tokenType: string; intentHash: string; outputIndex: number }>;
        unshieldedSpentOutputs: Array<{ intentHash: string; outputIndex: number }>;
      }>;
    } | null> };
    if (!j.data) return;
    for (const block of Object.values(j.data)) {
      if (!block) continue;
      for (const tx of block.transactions) {
        for (const o of tx.unshieldedCreatedOutputs) {
          if (o.owner === address && o.tokenType === NATIVE_TOKEN_TYPE) {
            candidates.set(`${o.intentHash}:${o.outputIndex}`, {
              intentHash: o.intentHash,
              outputIndex: o.outputIndex,
              value: BigInt(o.value),
            });
          }
        }
        for (const s of tx.unshieldedSpentOutputs) {
          candidates.delete(`${s.intentHash}:${s.outputIndex}`);
        }
      }
    }
  }

  for (let i = 0; i < starts.length; i += CONCURRENCY) {
    await Promise.all(starts.slice(i, i + CONCURRENCY).map(scanBatch));
  }

  // Largest-first sort makes single-input selection more likely.
  return [...candidates.values()].sort((a, b) => (b.value > a.value ? 1 : -1));
}

function selectUtxosCovering(utxos: UnspentUtxo[], amount: bigint): UnspentUtxo[] | null {
  // Try single largest first
  for (const u of utxos) if (u.value >= amount) return [u];
  // Greedy accumulation
  const picked: UnspentUtxo[] = [];
  let total = 0n;
  for (const u of utxos) {
    picked.push(u);
    total += u.value;
    if (total >= amount) return picked;
  }
  return null;
}

/**
 * Attach native-NIGHT UTXO inputs to a proven tx so the chain accepts it.
 *
 * The proven tx's circuit declares `receiveUnshielded(NIGHT, X)` calls. The
 * SDK's `httpClientProofProvider` proves the circuit but does NOT attach
 * NIGHT UTXOs from the wallet — that's normally `wallet.facade
 * .balanceUnboundTransaction(tokenKindsToBalance:'all')`'s job. Since our
 * sponsored path skips the facade entirely (its sync is unreliable), we
 * do the attachment here against the indexer's UTXO set.
 *
 * For each segment with a NIGHT deficit (from `tx.imbalances(segId)`):
 *   - pick UTXOs covering the deficit
 *   - construct an UnshieldedOffer (inputs + change output back to ourselves)
 *   - assign to intent.guaranteedUnshieldedOffer
 *
 * The proven tx is mutated in place. Signatures are added afterward by
 * `signTransactionIntents`.
 */
async function attachNightInputs(provenTx: unknown, wallet: InitializedWallet): Promise<void> {
  const tx = provenTx as {
    intents?: Map<number, IntentLike>;
    imbalances?: (segment: number, fees?: bigint) => Map<string, bigint>;
  };
  if (!tx.intents || !tx.imbalances) return;

  // `imbalances()` returns a Map keyed by ledger-v8 `TokenType` (a tagged
  // union: `{ tag: 'unshielded' | 'shielded' | 'dust', raw?: hex }`). We
  // only care about the unshielded native token (raw === all-zeros). DUST
  // deficits are 1AM's job; shielded tokens never appear here for buy/sell.
  const isNativeUnshielded = (k: unknown): boolean => {
    const t = k as { tag?: string; raw?: string };
    return t?.tag === 'unshielded'
      && typeof t.raw === 'string'
      && t.raw.toLowerCase().replace(/^0x/, '') === NATIVE_TOKEN_TYPE;
  };
  const describeKey = (k: unknown): string => {
    const t = k as { tag?: string; raw?: string };
    if (t?.tag === 'dust') return 'dust';
    if (t?.tag && t.raw) return `${t.tag}:${t.raw.slice(0, 12)}…`;
    return JSON.stringify(t).slice(0, 30);
  };

  let needsAnyInput = false;
  const perSegment = new Map<number, bigint>();
  for (const segId of tx.intents.keys()) {
    let im: Map<unknown, bigint>;
    try {
      im = tx.imbalances(segId) as Map<unknown, bigint>;
    } catch (e) {
      if (process.env.LUMPFUN_DEBUG_TX === '1') console.log(`  attachNight: imbalances(${segId}) threw: ${e}`);
      continue;
    }
    if (process.env.LUMPFUN_DEBUG_TX === '1') {
      const entries = [...im.entries()].map(([t, v]) => `${describeKey(t)}=${v}`).join(', ');
      console.log(`  attachNight: seg=${segId} imbalances: ${entries || '<empty>'}`);
    }
    let deficit = 0n;
    for (const [tokenType, delta] of im.entries()) {
      if (isNativeUnshielded(tokenType) && delta < 0n) deficit = -delta;
    }
    if (deficit > 0n) {
      perSegment.set(segId, deficit);
      needsAnyInput = true;
    }
  }
  if (!needsAnyInput) {
    if (process.env.LUMPFUN_DEBUG_TX === '1') console.log(`  attachNight: no NIGHT deficit detected — nothing to attach`);
    return;
  }

  const blocksBack = Number(process.env.LUMPFUN_UTXO_SCAN_BLOCKS ?? '20000');
  const utxos = await fetchUnspentNightUtxos(wallet.addresses.unshielded, blocksBack);
  if (process.env.LUMPFUN_DEBUG_TX === '1') {
    const total = utxos.reduce((a, u) => a + u.value, 0n);
    console.log(`  attachNight: ${utxos.length} unspent NIGHT UTXOs found, total ${total}`);
  }

  const ledger = await import('@midnight-ntwrk/ledger-v8');
  const verifyingKey = ledger.signatureVerifyingKey(wallet.keys.unshielded.toString('hex'));
  // UtxoOutput.owner / UtxoSpend.owner take the raw 32-byte hex form, not the
  // bech32 `mn_addr_preprod1...` we expose to users. addressFromKey gives the
  // hex (same as our wallet-hex.ts utility).
  const ourAddressHex = ledger.addressFromKey(verifyingKey);

  for (const [segId, deficit] of perSegment.entries()) {
    const selected = selectUtxosCovering(utxos, deficit);
    if (!selected) {
      throw new Error(
        `attachNightInputs: no unspent NIGHT UTXOs cover seg=${segId} deficit=${deficit}. ` +
        `Wallet has ${utxos.reduce((a, u) => a + u.value, 0n)} NIGHT in ${utxos.length} UTXOs.`,
      );
    }
    const total = selected.reduce((a, u) => a + u.value, 0n);
    const change = total - deficit;

    const inputs = selected.map(u => ({
      value: u.value,
      owner: verifyingKey,
      type: NATIVE_TOKEN_TYPE,
      intentHash: u.intentHash,
      outputNo: u.outputIndex,
    }));
    const outputs = change > 0n
      ? [{ value: change, owner: ourAddressHex, type: NATIVE_TOKEN_TYPE }]
      : [];

    if (process.env.LUMPFUN_DEBUG_TX === '1') {
      console.log(`  attachNight: seg=${segId} deficit=${deficit} inputs=${inputs.length} change=${change}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offer = (ledger as any).UnshieldedOffer.new(inputs, outputs, []);
    const intent = tx.intents.get(segId);
    if (!intent) continue;
    intent.guaranteedUnshieldedOffer = offer;

    // Step 1: did the setter on the local reference actually take?
    const localPersists = !!intent.guaranteedUnshieldedOffer;
    if (process.env.LUMPFUN_DEBUG_TX === '1') console.log(`  attachNight: local intent setter persisted=${localPersists}`);

    // Step 2: write back into the Map.
    (tx.intents as Map<number, IntentLike>).set(segId, intent);
    if (process.env.LUMPFUN_DEBUG_TX === '1') {
      const reGet = tx.intents.get(segId) as IntentLike | undefined;
      console.log(`  attachNight: map.get after set persisted=${!!reGet?.guaranteedUnshieldedOffer}`);
    }

    // Step 3: if neither worked, try reassigning the whole intents map.
    if (process.env.LUMPFUN_DEBUG_TX === '1') {
      const fullTx = tx as { intents?: Map<number, IntentLike> };
      const newMap = new Map<number, IntentLike>();
      if (fullTx.intents) for (const [k, v] of fullTx.intents.entries()) newMap.set(k, k === segId ? intent : v);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fullTx as any).intents = newMap;
        const reGet2 = (fullTx.intents as Map<number, IntentLike> | undefined)?.get(segId);
        console.log(`  attachNight: after reassigning whole intents map, persisted=${!!reGet2?.guaranteedUnshieldedOffer}`);
      } catch (e) {
        console.log(`  attachNight: reassign whole intents threw: ${e}`);
      }
    }

    // Remove the consumed UTXOs from the candidate pool for the next iteration.
    const consumedKeys = new Set(selected.map(u => `${u.intentHash}:${u.outputIndex}`));
    for (let i = utxos.length - 1; i >= 0; i--) {
      if (consumedKeys.has(`${utxos[i].intentHash}:${utxos[i].outputIndex}`)) utxos.splice(i, 1);
    }
  }
}

/**
 * Submit a balanced Midnight transaction to the chain.
 *
 * `balancedHex` is the raw Midnight tx envelope (e.g. `0x6d69646e696768743a...`).
 * It must be wrapped in a Substrate `Call::Midnight::sendMnTransaction(bytes)`
 * extrinsic before submission — the chain's TaggedTransactionQueue rejects
 * raw Midnight bytes with a wasm-trap. We use Polkadot.js to do the wrapping
 * exactly the way the SDK's PolkadotNodeClient.sendMidnightTransaction does
 * (see node_modules/@midnight-ntwrk/wallet-sdk-node-client/dist/effect/
 * PolkadotNodeClient.js:78-94).
 */
async function submitMidnightTransaction(wssUrl: string, balancedHex: string): Promise<string> {
  const debug = process.env.LUMPFUN_DEBUG_TX === '1';
  const log = (s: string) => { if (debug) console.log(`  [submit] ${s}`); };

  log('importing @polkadot/api...');
  const { ApiPromise, WsProvider } = await import('@polkadot/api');

  log(`connecting WsProvider ${wssUrl}...`);
  const provider = new WsProvider(wssUrl);

  log('ApiPromise.create (pulling chain metadata, may take 10-30s)...');
  const api = await ApiPromise.create({ provider, throwOnConnect: false, noInitWarn: true });
  log(`api ready: chain=${(await api.rpc.system.chain()).toString()}`);

  try {
    if (!api.tx.midnight || typeof api.tx.midnight.sendMnTransaction !== 'function') {
      throw new Error('Chain metadata has no api.tx.midnight.sendMnTransaction — pallet missing?');
    }
    const hex = balancedHex.startsWith('0x') ? balancedHex : `0x${balancedHex}`;
    log(`constructing api.tx.midnight.sendMnTransaction(${hex.length} hex chars)...`);

    // Polkadot.js's `.send(callback)` subscribes; the callback fires with
    // status updates (Ready → Broadcast → InBlock → Finalized). The promise
    // resolves to an unsubscribe thunk. We treat the first InBlock event
    // (or a rejection) as the terminal status and return the tx hash.
    const submission = api.tx.midnight.sendMnTransaction(hex);
    const txHash = submission.hash.toHex();
    log(`extrinsic hash (pre-submit): ${txHash}`);

    return await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('submit timed out after 60s')), 60_000);
      let unsub: (() => void) | undefined;

      submission
        .send((result) => {
          log(`status: ${result.status.type}`);
          if (result.status.isInBlock || result.status.isFinalized) {
            clearTimeout(t);
            unsub?.();
            resolve(txHash);
          } else if (result.isError || result.status.isDropped || result.status.isInvalid) {
            clearTimeout(t);
            unsub?.();
            reject(new Error(`submission rejected: ${result.status.type}`));
          }
        })
        .then((u) => { unsub = u as () => void; })
        .catch((err) => {
          clearTimeout(t);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  } finally {
    await api.disconnect();
  }
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

  const proofProvider = httpClientProofProvider(config.proverUrl, zkConfigProvider);

  return {
    privateStateProvider: createInMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUrl,
      config.indexerWsUrl,
    ),
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider: walletProvider,
  };
}

/**
 * Wraps the local proof provider so that, before proving, we attach
 * unshielded NIGHT inputs the circuit demands. Writing to a tx's intents
 * map only works while it's unbound + unproven (per the ledger-v8
 * docstring), so this is the right seam — modifying after prove silently
 * fails on the WASM-backed Map.
 */
function wrapProofProviderWithNightAttach(
  base: { proveTx: (tx: unknown, ...rest: unknown[]) => Promise<unknown> },
  wallet: InitializedWallet,
) {
  return {
    ...base,
    async proveTx(tx: unknown, ...rest: unknown[]) {
      await attachNightInputs(tx, wallet);
      const signFn = (payload: Uint8Array) => wallet.keystore.signData(payload);
      signTransactionIntents(tx as TransactionWithIntents, signFn);
      if (process.env.LUMPFUN_DEBUG_TX === '1') dumpTx('AFTER attach+sign (pre-prove)', tx);
      return base.proveTx(tx, ...rest);
    },
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
/**
 * Probe a proven tx's `imbalances()` map for any shielded/unshielded deficit.
 * Returns true if the tx requires the local wallet to attach NIGHT (or other
 * non-DUST) inputs. Returns false for deploys and other no-transfer txs.
 *
 * Token-type key shape: `{ tag: 'unshielded' | 'shielded' | 'dust', raw?: hex }`.
 */
function hasShieldedOrUnshieldedDeficit(tx: unknown): boolean {
  const t = tx as {
    intents?: Map<number, unknown>;
    imbalances?: (segment: number) => Map<unknown, bigint>;
  };
  if (!t.intents || !t.imbalances) return false;
  for (const segId of t.intents.keys()) {
    let im: Map<unknown, bigint>;
    try {
      im = t.imbalances(segId);
    } catch { continue; }
    for (const [tokenType, delta] of im.entries()) {
      const tt = tokenType as { tag?: string };
      if ((tt?.tag === 'unshielded' || tt?.tag === 'shielded') && delta < 0n) return true;
    }
  }
  return false;
}

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

    async balanceTx(tx: unknown, ttl?: Date) {
      if (process.env.LUMPFUN_DEBUG_TX === '1') dumpTx('BEFORE sponsored balance', tx);

      // Hybrid balance: if this tx has any shielded/unshielded deficit (e.g.
      // a buy/sell with native NIGHT inputs the circuit consumes), have the
      // local WalletFacade attach them via balanceUnboundTransaction with
      // tokenKindsToBalance:['shielded','unshielded']. That deliberately
      // excludes DUST so we don't need DUST sync — 1AM /balance pays the fee.
      // For deploys (no NIGHT transfers), this branch is skipped entirely
      // and the proven tx goes straight to 1AM.
      let workingTx = tx;
      const needsLocalBalance = hasShieldedOrUnshieldedDeficit(tx);
      if (needsLocalBalance) {
        if (!wallet.facade) {
          throw new Error(
            'Sponsored buy/sell needs the full WalletFacade for NIGHT-balance. ' +
            'Use initWallet() (not initWalletKeysOnly) for these actions.',
          );
        }
        if (process.env.LUMPFUN_DEBUG_TX === '1') {
          console.log('  hybrid: facade.balanceUnboundTransaction (shielded+unshielded only)…');
        }
        const recipe = await wallet.facade.balanceUnboundTransaction(
          tx as never,
          {
            shieldedSecretKeys: wallet.keys.shielded.keys,
            dustSecretKey: wallet.keys.dust.key,
          },
          {
            tokenKindsToBalance: ['shielded', 'unshielded'],
            ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
          },
        );
        if (process.env.LUMPFUN_DEBUG_TX === '1') {
          dumpTx('AFTER facade balance (baseTransaction)', recipe.baseTransaction);
          if (recipe.balancingTransaction) dumpTx('AFTER facade balance (balancingTransaction)', recipe.balancingTransaction);
        }

        // The SDK's signRecipe is the canonical signer — it produces the
        // correct binding hash (embedded-fr) that the chain + 1AM require.
        // Hand-rolled signTransactionIntents writes via WASM Map.set which
        // silently no-ops, leaving the tx with pedersen-schnorr binding
        // that 1AM rejects with INVALID_TX deserialize.
        const signFn = (payload: Uint8Array) => wallet.keystore.signData(payload);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const signed = await (wallet.facade as any).signRecipe(recipe, signFn);

        // Send the signed recipe's baseTransaction (still PreBinding,
        // proven) rather than the finalized+Binding tx. The deploy uses
        // PreBinding bytes and 1AM accepts them; the Binding form trips
        // the 'embedded-fr expected' rejection on /balance.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workingTx = (signed as any).baseTransaction ?? signed;
        if (process.env.LUMPFUN_DEBUG_TX === '1') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = workingTx as any;
          const firstBytes = Buffer.from(w.serialize()).slice(0, 80);
          const headerAscii = firstBytes.toString('utf-8').replace(/[^\x20-\x7e]/g, '.');
          console.log(`  signed-recipe baseTransaction header: ${headerAscii}`);
          dumpTx('AFTER facade signRecipe (using baseTransaction)', workingTx);
        }
      }

      const provenBytes = (workingTx as { serialize(): Uint8Array }).serialize();
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-Client-Name': 'lumpfun',
      };
      if (remoteApiKey) headers['X-API-Key'] = remoteApiKey;

      // Endpoint selection: deploys (no NIGHT deficit) go to /balance with
      // proven bytes — that's what the first LumpFun launch used successfully.
      // Buy/sell would normally also use /balance after the facade attaches
      // NIGHT inputs, but our SDK's finalized binding format ('pedersen-
      // schnorr[v1]') doesn't match what 1AM preprod's /balance currently
      // expects ('embedded-fr[v1]'). As a workaround, send the FACADE-
      // balanced bytes to /prove-and-balance instead — that endpoint did
      // accept our SDK format for deploy. 1AM re-runs prove + balance from
      // their newer ledger.
      // /balance for both deploy and buy/sell — deploy proves it accepts our
      // SDK's wire format when the tx is PreBinding (proven, not finalized).
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

          // Preprod /balance returns a balanced-but-unsubmitted Midnight tx
          // (hex of `midnight:transaction[v9](...)`). Wrap it in a Substrate
          // Call::Midnight::sendMnTransaction extrinsic via Polkadot.js and
          // submit over WSS (the public HTTPS RPC 403's write methods anyway).
          const wssUrl = getConfig().rpcWssUrl;
          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  submitting balanced tx via ${wssUrl} api.tx.midnight.sendMnTransaction...`);
          }
          const submitHash = await submitMidnightTransaction(wssUrl, balancedHex);
          if (process.env.LUMPFUN_DEBUG_TX === '1') {
            console.log(`  submit ok: extrinsic hash ${submitHash}`);
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
