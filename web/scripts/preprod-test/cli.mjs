#!/usr/bin/env node
// Preprod batcher test harness — generates seeded wallets, drives buy/sell
// orders via the queue path directly, kicks the batcher tick, and reports
// status. Bypasses the browser UI / Vespr entirely so we can script
// arbitrary trade scenarios.
//
// Wallets are persisted in .wallets.json (gitignored) alongside this file.
// Seeds are plaintext — preprod-only, never reuse on mainnet.
//
// Usage examples:
//   node scripts/preprod-test/cli.mjs init 2
//   node scripts/preprod-test/cli.mjs status
//   node scripts/preprod-test/cli.mjs trade 0 buy 50
//   node scripts/preprod-test/cli.mjs trade 1 sell 1000000
//   node scripts/preprod-test/cli.mjs burst 5 25
//   node scripts/preprod-test/cli.mjs cancel 0
//   node scripts/preprod-test/cli.mjs faucet            # prints the addresses to fund

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  Lucid as LucidFn,
  Blockfrost as BlockfrostProvider,
  Constr, Data,
  generateSeedPhrase,
  getAddressDetails,
  validatorToAddress,
} from '@lucid-evolution/lucid';

// ── Paths ─────────────────────────────────────────────────────────────────

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const WEB_ROOT     = path.resolve(__dirname, '..', '..');
const WALLETS_FILE = path.join(__dirname, '.wallets.json');

// ── Env loader ────────────────────────────────────────────────────────────
// Reads web/.env.local with no extra dependencies. Mirrors Next.js's lax
// parse: ignores comments, strips quotes, allows leading whitespace
// (.env.local in this repo has indented keys).

async function loadEnv() {
  const envPath = path.join(WEB_ROOT, '.env.local');
  let txt;
  try { txt = await fs.readFile(envPath, 'utf8'); }
  catch { throw new Error(`web/.env.local not found at ${envPath}`); }
  for (const line of txt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[m[1]] ??= value;
  }
}

// ── Network / provider config ─────────────────────────────────────────────

function envConfig() {
  const network = (process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') === 'Mainnet'
    ? 'Mainnet' : 'Preprod';
  const projectId = process.env.BLOCKFROST_PROJECT_ID
                 ?? process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID
                 ?? '';
  const baseUrl = process.env.BLOCKFROST_BASE_URL
               ?? (network === 'Mainnet'
                    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
                    : 'https://cardano-preprod.blockfrost.io/api/v0');
  const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '';
  if (network === 'Mainnet') {
    throw new Error('preprod-test refuses to run on Mainnet. Check NEXT_PUBLIC_CARDANO_NETWORK.');
  }
  if (!projectId)       throw new Error('BLOCKFROST_PROJECT_ID not set in web/.env.local');
  if (!treasuryAddress) throw new Error('NEXT_PUBLIC_TREASURY_ADDRESS not set in web/.env.local');
  return { network, projectId, baseUrl, treasuryAddress };
}

async function lucidWith(seed) {
  const { network, projectId, baseUrl } = envConfig();
  const lucid = await LucidFn(new BlockfrostProvider(baseUrl, projectId), network);
  if (seed) lucid.selectWallet.fromSeed(seed);
  return lucid;
}

// ── Order-book script (mirror of web/src/lib/order-book.ts) ───────────────

const ORDER_BOOK_CBOR = '59010601010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cc01c0092225980099b8748008c01cdd500144c8cc8a60022b30013001300a375400513259800980118059baa0078a51899198008009bac300f30103010301030103010301030103010300d375400c44b30010018a508acc004cdc79bae3010001375c6020601c6ea800e29462660040046022002806100f2014300d300b3754005164025300a375400d300d003488966002600800515980098071baa009801c5900f456600266e1d20020028acc004c038dd5004c00e2c807a2c806100c0c02cc030004dc3a400060106ea800a2c8030600e00260066ea801e29344d9590011';

async function orderBookValidator() {
  const { applyDoubleCborEncoding } = await import('@lucid-evolution/lucid');
  return { type: 'PlutusV3', script: applyDoubleCborEncoding(ORDER_BOOK_CBOR) };
}

async function orderBookAddr() {
  const { network } = envConfig();
  return validatorToAddress(network, await orderBookValidator());
}

// ── Plutus codecs (mirror of web/src/lib/order-codec.ts) ──────────────────

const PLATFORM_FEE      = 1_000_000n;
const MIN_UTXO_LOVELACE = 2_000_000n;
const VIRTUAL_ADA       = 3_000_000_000n;

function encodeOptionByteArray(v) {
  return v ? new Constr(1, [v]) : new Constr(0, []);
}
function decodeOptionByteArray(c) {
  if (!c || typeof c !== 'object') return undefined;
  if (c.index === 0) return undefined;
  if (c.index === 1 && c.fields?.length === 1) return c.fields[0];
  return undefined;
}

function encodeOrderDatum(d) {
  const action = d.action === 'Buy' ? new Constr(0, []) : new Constr(1, []);
  return Data.to(new Constr(0, [
    d.ownerPkh,
    encodeOptionByteArray(d.ownerStake),
    d.curvePolicyId, d.curveAssetName,
    action, d.amount, d.minOut, d.creatorPkh, d.treasuryPkh,
  ]));
}

// Tolerates both 9-field (new) and 8-field (legacy) datums.
function decodeOrderDatum(raw) {
  const c = Data.from(raw);
  if (c.index !== 0) throw new Error('bad order datum');
  if (c.fields.length === 9) {
    return {
      ownerPkh:       c.fields[0],
      ownerStake:     decodeOptionByteArray(c.fields[1]),
      curvePolicyId:  c.fields[2],
      curveAssetName: c.fields[3],
      action:         c.fields[4].index === 0 ? 'Buy' : 'Sell',
      amount:         c.fields[5],
      minOut:         c.fields[6],
      creatorPkh:     c.fields[7],
      treasuryPkh:    c.fields[8],
    };
  }
  if (c.fields.length === 8) {
    return {
      ownerPkh:       c.fields[0],
      ownerStake:     undefined,
      curvePolicyId:  c.fields[1],
      curveAssetName: c.fields[2],
      action:         c.fields[3].index === 0 ? 'Buy' : 'Sell',
      amount:         c.fields[4],
      minOut:         c.fields[5],
      creatorPkh:     c.fields[6],
      treasuryPkh:    c.fields[7],
    };
  }
  throw new Error(`bad order datum (field count ${c.fields.length})`);
}

function encodeOrderRedeemerCancel() {
  return Data.to(new Constr(1, []));
}

// ── Curve math (mirror of web/src/lib/curve-math.ts) ──────────────────────

function quoteBuy(adaReserve, tokenReserve, adaIn) {
  const effective = adaReserve + VIRTUAL_ADA;
  const k = effective * tokenReserve;
  const newEffective = effective + adaIn;
  const newTokenReserve = k / newEffective;
  return tokenReserve - newTokenReserve;
}

function quoteSellGross(adaReserve, tokenReserve, tokensIn) {
  const effective = adaReserve + VIRTUAL_ADA;
  const k = effective * tokenReserve;
  const newTokenReserve = tokenReserve + tokensIn;
  const newEffective = k / newTokenReserve;
  const gross = effective - newEffective;
  return gross > adaReserve ? adaReserve : gross;
}

function pkhFromBech32(addr) {
  const d = getAddressDetails(addr);
  if (!d.paymentCredential?.hash) throw new Error(`No payment credential for ${addr.slice(0, 12)}…`);
  return d.paymentCredential.hash;
}

function stakeFromBech32(addr) {
  const d = getAddressDetails(addr);
  return d.stakeCredential?.hash;
}

// The batcher pays user trade-outputs to an *enterprise* address derived
// from the user's payment-key hash alone (no stake credential), which is
// a different bech32 from the user's base address (payment + stake).
// Seed-based Lucid wallets default to the base address for getUtxos, so
// token payouts are invisible to .wallet().getUtxos(). Real CIP-30
// wallets aggregate both transparently. For our CLI to see them we have
// to query the enterprise address manually and unify with the base set.
async function fetchAllWalletUtxos(lucid, walletAddress) {
  const { credentialToAddress } = await import('@lucid-evolution/lucid');
  const network = (process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod');
  const pkh = pkhFromBech32(walletAddress);
  const entAddr = credentialToAddress(network, { type: 'Key', hash: pkh });
  const baseUtxos = await lucid.wallet().getUtxos();
  if (entAddr === walletAddress) return baseUtxos;
  const entUtxos = await lucid.utxosAt(entAddr).catch(() => []);
  return [...baseUtxos, ...entUtxos];
}

// ── Wallet persistence ────────────────────────────────────────────────────

async function loadWallets() {
  try {
    const raw = await fs.readFile(WALLETS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveWallets(wallets) {
  await fs.writeFile(WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

// ── Token discovery ───────────────────────────────────────────────────────

async function fetchTokens(devOrigin = 'http://localhost:3000') {
  const res = await fetch(`${devOrigin}/api/tokens`);
  if (!res.ok) throw new Error(`/api/tokens → ${res.status}. Is npm run dev running?`);
  return res.json();
}

async function pickToken(ticker) {
  const all = await fetchTokens();
  const active = all.filter(t => !t.minswapPoolTxHash && !t.graduatedTxHash);
  if (ticker) {
    const m = active.find(t => t.ticker === ticker);
    if (!m) throw new Error(`No active token with ticker '${ticker}'. Available: ${active.map(t => t.ticker).join(', ') || '(none)'}`);
    return m;
  }
  if (active.length === 0) throw new Error('No active (non-graduated) tokens in the registry');
  return active[0];
}

async function fetchCurve(token, lucid) {
  const utxos = await lucid.utxosAt(token.curveAddress);
  const assetUnit = `${token.policyId}${token.assetName}`;
  const u = utxos.find(x => x.assets[assetUnit] !== undefined);
  if (!u || !u.datum) throw new Error(`Curve UTxO not found at ${token.curveAddress.slice(0, 16)}…`);
  const c = Data.from(u.datum);
  return { adaReserve: c.fields[0], tokenReserve: c.fields[1] };
}

// ── Subcommands ───────────────────────────────────────────────────────────

async function cmdInit(count) {
  count = Number(count) || 2;
  const { network } = envConfig();
  const existing = await loadWallets();

  // Grow semantics: if N wallets already exist and the user asks for M,
  // generate (M - N) more. Existing wallets keep their funded balances.
  // To start fresh, delete .wallets.json first.
  if (existing.length >= count) {
    console.log(`${existing.length} wallet(s) already exist (asked for ${count}). Nothing to do.`);
    console.log(`To start fresh, delete ${WALLETS_FILE} and re-run init.\n`);
    return cmdFaucet();
  }

  const fresh = [];
  for (let i = existing.length; i < count; i++) {
    const seed = generateSeedPhrase();
    const lucid = await lucidWith(seed);
    const address = await lucid.wallet().address();
    fresh.push({ name: `test-${i}`, seed, address });
  }
  const all = [...existing, ...fresh];
  await saveWallets(all);

  if (existing.length === 0) {
    console.log(`Generated ${fresh.length} ${network} wallets. Stored at ${WALLETS_FILE}`);
  } else {
    console.log(`Added ${fresh.length} ${network} wallet(s). Existing ${existing.length} preserved.`);
  }
  console.log('\nFund the new addresses from https://docs.cardano.org/cardano-testnet/tools/faucet:');
  for (const w of fresh) console.log(`  ${w.name}  ${w.address}`);
  console.log(`\nThen run:  npm run preprod -- status`);
}

async function cmdFaucet() {
  const wallets = await loadWallets();
  if (wallets.length === 0) {
    console.log('No wallets yet. Run `init <count>` first.');
    return;
  }
  console.log('Fund these addresses from https://docs.cardano.org/cardano-testnet/tools/faucet :');
  for (const w of wallets) console.log(`  ${w.name}  ${w.address}`);
}

async function cmdStatus() {
  const wallets = await loadWallets();
  if (wallets.length === 0) { console.log('No wallets. Run `init <count>` first.'); return; }

  const lucid = await lucidWith();
  const obAddr = await orderBookAddr();
  const allOrders = await lucid.utxosAt(obAddr).catch(() => []);

  console.log(`Order book : ${obAddr}`);
  console.log(`Pending overall: ${allOrders.length}\n`);

  const tokens = await fetchTokens();
  const tokenByPolicy = new Map(tokens.map(t => [`${t.policyId}${t.assetName}`, t]));

  for (const w of wallets) {
    // Mirror the sell path — collect base + enterprise so token holdings
    // (which the batcher delivers to enterprise) show up.
    const lucidW = await lucidWith(w.seed);
    const utxos = await fetchAllWalletUtxos(lucidW, w.address).catch(() => []);
    const lovelace = utxos.reduce((s, u) => s + (u.assets.lovelace ?? 0n), 0n);

    // Sum non-ADA assets, group by unit
    const tokensHeld = new Map();
    for (const u of utxos) {
      for (const [unit, qty] of Object.entries(u.assets)) {
        if (unit === 'lovelace') continue;
        tokensHeld.set(unit, (tokensHeld.get(unit) ?? 0n) + qty);
      }
    }

    // Pending orders for this wallet
    const ownerPkh = pkhFromBech32(w.address);
    const myOrders = [];
    for (const u of allOrders) {
      if (!u.datum) continue;
      try {
        const d = decodeOrderDatum(u.datum);
        if (d.ownerPkh === ownerPkh) myOrders.push({ utxo: u, datum: d });
      } catch { /* skip unrecognised */ }
    }

    console.log(`▶ ${w.name}  ${w.address.slice(0, 18)}…${w.address.slice(-6)}`);
    console.log(`    ${(Number(lovelace) / 1_000_000).toFixed(2)} tADA  •  ${utxos.length} UTxO${utxos.length === 1 ? '' : 's'}  •  ${myOrders.length} pending order${myOrders.length === 1 ? '' : 's'}`);
    for (const [unit, qty] of tokensHeld) {
      const meta = tokenByPolicy.get(unit);
      const label = meta ? `$${meta.ticker}` : `${unit.slice(0, 16)}…`;
      console.log(`      ${label}: ${Number(qty).toLocaleString()}`);
    }
    for (const o of myOrders) {
      const meta = tokenByPolicy.get(`${o.datum.curvePolicyId}${o.datum.curveAssetName}`);
      const ticker = meta?.ticker ?? '(unknown)';
      const amt = o.datum.action === 'Buy'
        ? `${(Number(o.datum.amount) / 1_000_000).toFixed(2)} tADA`
        : `${Number(o.datum.amount).toLocaleString()} $${ticker}`;
      console.log(`      ${o.datum.action.toUpperCase()} ${amt} → $${ticker}    ${o.utxo.txHash.slice(0, 12)}…#${o.utxo.outputIndex}`);
    }
  }
}

async function cmdTrade(walletIdx, action, amount, ticker, slippageBpsArg) {
  const wallets = await loadWallets();
  const w = wallets[Number(walletIdx)];
  if (!w) throw new Error(`No wallet at index ${walletIdx}. Have: ${wallets.map((x, i) => `${i}=${x.name}`).join(', ')}`);

  const token = await pickToken(ticker);
  const { treasuryAddress } = envConfig();
  const lucid = await lucidWith(w.seed);

  // Wait for the wallet's previous tx (if any) to confirm before
  // submitting the next one. Without this, two back-to-back trades from
  // the same wallet hit the Blockfrost cache window — Lucid's coin
  // selection sees the stale UTxO set and either picks an already-spent
  // input ("All inputs are spent") or doesn't see freshly-arrived tokens
  // ("wallet does not have enough funds"). Awaiting flushes the race.
  if (w.lastTxHash) {
    process.stdout.write(`▶ ${w.name}  awaiting prev tx ${w.lastTxHash.slice(0, 12)}…  `);
    try { await lucid.awaitTx(w.lastTxHash, 60_000); console.log('confirmed'); }
    catch { console.log('still pending — proceeding anyway, may fail'); }
  }

  const { adaReserve, tokenReserve } = await fetchCurve(token, lucid);

  // Slippage tolerance grows with burst size: each FIFO-queued order
  // ahead of yours moves the curve, so the order's minOut (set against
  // submission-time reserves) accumulates lag against execution-time
  // reserves. Empirically, a 5-order burst of 10 tADA on a fresh
  // ~2 tADA curve drives the *last* order ~7.5% below its quote. 10%
  // gives headroom up through 5–6 orders; bump explicitly for larger
  // bursts. The web app's 0.5% only works because real users issue
  // single trades against mature mainnet curves where compounding
  // queue impact doesn't apply.
  const SLIPPAGE_BPS = slippageBpsArg ? BigInt(slippageBpsArg) : 1000n;
  const ownerPkh    = pkhFromBech32(w.address);
  const ownerStake  = stakeFromBech32(w.address);
  const creatorPkh  = pkhFromBech32(token.creatorAddress);
  const treasuryPkh = pkhFromBech32(treasuryAddress);
  const obAddr      = await orderBookAddr();
  const assetUnit   = `${token.policyId}${token.assetName}`;

  let datum, value;
  if (action === 'buy') {
    const adaIn = BigInt(amount) * 1_000_000n; // CLI passes ADA, not lovelace
    const expectedOut = quoteBuy(adaReserve, tokenReserve, adaIn);
    const minOut = expectedOut - (expectedOut * SLIPPAGE_BPS) / 10_000n;
    const creatorFee = (adaIn * BigInt(token.creatorFeeBps)) / 10_000n;
    const lockedLovelace = adaIn + PLATFORM_FEE + creatorFee + MIN_UTXO_LOVELACE;
    datum = { ownerPkh, ownerStake, curvePolicyId: token.policyId, curveAssetName: token.assetName, action: 'Buy', amount: adaIn, minOut, creatorPkh, treasuryPkh };
    value = { lovelace: lockedLovelace };
    console.log(`▶ ${w.name}  BUY  ${amount} tADA  →  ~${Number(expectedOut).toLocaleString()} $${token.ticker}  (locks ${(Number(lockedLovelace)/1e6).toFixed(2)} tADA)`);
  } else if (action === 'sell') {
    const tokensIn = BigInt(amount); // CLI passes raw token units
    const grossAda = quoteSellGross(adaReserve, tokenReserve, tokensIn);
    const creatorFee = (grossAda * BigInt(token.creatorFeeBps)) / 10_000n;
    const adaNet = grossAda - PLATFORM_FEE - creatorFee;
    const minOut = adaNet - (adaNet * SLIPPAGE_BPS) / 10_000n;
    if (adaNet < MIN_UTXO_LOVELACE) throw new Error('Sell amount too small — net below 1 ADA min UTxO');
    datum = { ownerPkh, ownerStake, curvePolicyId: token.policyId, curveAssetName: token.assetName, action: 'Sell', amount: tokensIn, minOut, creatorPkh, treasuryPkh };
    value = { lovelace: MIN_UTXO_LOVELACE, [assetUnit]: tokensIn };
    console.log(`▶ ${w.name}  SELL  ${Number(tokensIn).toLocaleString()} $${token.ticker}  →  ~${(Number(adaNet)/1e6).toFixed(2)} tADA net  (locks ${Number(tokensIn).toLocaleString()} tokens + min UTxO)`);
  } else {
    throw new Error(`Unknown action '${action}'. Use 'buy' or 'sell'.`);
  }

  // Explicit coin selection on sells. Two reasons we can't rely on Lucid's
  // auto-selection here:
  //   1. Lucid Evolution v0.4.30 refuses to combine sparse UTxOs (one
  //      ADA-only + one ADA+token) to satisfy a mixed-asset output.
  //   2. The batcher pays trade-outputs to an enterprise address derived
  //      from the payment-key, distinct from the wallet's base address;
  //      lucid.wallet().getUtxos() only sees the base address. We have to
  //      union both ourselves.
  // Pre-listing every wallet-controlled UTxO via collectFrom bypasses (1)
  // and (2) at once. Buys don't need this hammer because they lock pure
  // ADA which the base UTxO already has plenty of.
  let txBuilder = lucid.newTx();
  if (action === 'sell') {
    const walletUtxos = await fetchAllWalletUtxos(lucid, w.address);
    txBuilder = txBuilder.collectFrom(walletUtxos);
  }
  const tx = await txBuilder
    .pay.ToAddressWithData(obAddr, { kind: 'inline', value: encodeOrderDatum(datum) }, value)
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`    locked  ${txHash}`);

  // Persist the lock txHash on the wallet so the NEXT trade from this
  // wallet can awaitTx before submitting (closes the Blockfrost-cache
  // race that produces "All inputs are spent" / "no funds" on rapid
  // back-to-back trades).
  const all = await loadWallets();
  const idx = all.findIndex(x => x.name === w.name);
  if (idx >= 0) { all[idx].lastTxHash = txHash; await saveWallets(all); }

  // Kick the batcher tick — fire-and-forget so submitting many orders
  // back-to-back doesn't serialise on each tick's lucid.awaitTx loop. The
  // user can run `tick` or `wait <i>` afterward to see the actual batcher
  // outcome.
  void kickBatcherAsync();
  console.log(`    batcher  kicked (fire-and-forget — run \`wait ${walletIdx}\` to follow)`);
}

async function cmdBurst(walletCount, adaEach, ticker, slippageBpsArg) {
  walletCount = Number(walletCount) || 2;
  const adaArg = adaEach ?? 25;
  const wallets = (await loadWallets()).slice(0, walletCount);
  if (wallets.length < walletCount) throw new Error(`Only ${wallets.length} wallet(s) initialised; run \`init ${walletCount}\` first.`);

  console.log(`▶ Burst: ${walletCount} concurrent BUY orders × ${adaArg} tADA each`);
  const t0 = Date.now();
  const results = await Promise.allSettled(wallets.map((_, i) => cmdTrade(i, 'buy', adaArg, ticker, slippageBpsArg)));
  console.log(`\n▶ Burst submitted in ${Date.now() - t0} ms`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') console.log(`  wallet ${i}: ✗ ${r.reason?.message ?? r.reason}`);
  }
}

async function cmdTick() {
  // Vercel cron only runs on deployed Vercel projects, not on `next dev`.
  // Use this to manually drain whatever's pending. Idempotent — the
  // server-side tickInFlight guard collapses concurrent triggers.
  //
  // For `tick` itself we DO wait for the response (this is the only place
  // we actually want the structured result). For wait-all + cmdTrade's
  // kicks we use a short-timeout abort because the fetch otherwise blocks
  // the calling loop for the whole batcher run (~150s on a 5-order tick).
  try {
    const r = await fetch('http://localhost:3000/api/orders', { method: 'POST', body: '{}' });
    if (!r.ok) { console.log(`/api/orders → ${r.status}. Is npm run dev running?`); return; }
    const j = await r.json();
    console.log(`tokensTried=${j.tokensTried ?? 0}  tokensWithOrders=${j.tokensWithOrders ?? 0}  processed=${j.ordersProcessed ?? 0}  skipped=${j.ordersSkipped ?? 0}  errors=${j.errors ?? 0}`);
    for (const t of (j.byToken ?? [])) {
      console.log(`  ${t.ticker}: processed=${t.processed} skipped=${t.skipped} errors=${t.errors}`);
    }
  } catch (e) { console.log(`/api/orders unreachable: ${e.message ?? e}`); }
}

// Fire-and-forget batcher kick. Sends the POST and abandons the response
// after a short window — the tick continues running on the server even
// after we abort (we only consume the connection), which is exactly what
// wait/wait-all want: kick, don't block, poll the chain ourselves.
async function kickBatcherAsync(timeoutMs = 3000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    await fetch('http://localhost:3000/api/orders', {
      method: 'POST', body: '{}', signal: ctrl.signal,
    }).catch(() => { /* expected on abort */ });
    clearTimeout(t);
  } catch { /* swallow */ }
}

async function cmdWait(walletIdx, timeoutSec = 180) {
  // Poll until the wallet's pending orders are all gone (or timeout).
  // Two correctness traps if you naively poll-and-exit-on-zero:
  //   (a) called immediately after a submit — Blockfrost hasn't indexed
  //       the lock yet, first poll is 0, you'd declare "settled" falsely.
  //   (b) the batcher kick blocks for the whole tick (~150s on 5 orders)
  //       so an awaited fetch drifts the elapsed clock past the timeout.
  // Fixes: require seeing at least one non-zero poll before treating zero
  // as a real terminal state (with a 45s grace exit if we never see one,
  // covering the "nothing was actually pending" case); kick the batcher
  // fire-and-forget with a short abort so the loop never blocks on it.
  const wallets = await loadWallets();
  const w = wallets[Number(walletIdx)];
  if (!w) throw new Error(`No wallet at index ${walletIdx}.`);
  const lucid = await lucidWith();
  const obAddr = await orderBookAddr();
  const ownerPkh = pkhFromBech32(w.address);
  const start = Date.now();
  let sawOrders = false;
  console.log(`▶ Waiting up to ${timeoutSec}s for ${w.name} pending orders to drain…`);
  while (Date.now() - start < timeoutSec * 1000) {
    const all = await lucid.utxosAt(obAddr).catch(() => []);
    const mine = all.filter(u => {
      if (!u.datum) return false;
      try { return decodeOrderDatum(u.datum).ownerPkh === ownerPkh; }
      catch { return false; }
    });
    if (mine.length > 0) sawOrders = true;
    const elapsed = ((Date.now() - start) / 1000);
    if (mine.length === 0 && sawOrders) {
      console.log(`✓ all settled (${elapsed.toFixed(1)}s)`);
      return;
    }
    if (mine.length === 0 && !sawOrders && elapsed > 45) {
      // 45s grace — if no orders ever surfaced, assume nothing was pending
      // and exit clean. Distinct from a real "settled" since we never saw
      // them, but the user clearly has nothing to wait for.
      console.log(`✓ no pending orders observed in ${elapsed.toFixed(0)}s — nothing to do`);
      return;
    }
    // Fire-and-forget kick — never blocks the loop.
    void kickBatcherAsync();
    console.log(`  ${mine.length} still pending… (${elapsed.toFixed(0)}s)`);
    await new Promise(r => setTimeout(r, 7_000));
  }
  console.log(`✗ timeout after ${timeoutSec}s — pending orders still present. Run \`status\` for detail.`);
}

async function cmdWaitAll(timeoutSec = 240) {
  // See cmdWait for the rationale on (a) the seen-orders gate and
  // (b) the fire-and-forget kick. Same shape, just polls every wallet
  // rather than one. Default timeout 240s gives headroom for ~6-order
  // bursts to drain serially across blocks.
  const wallets = await loadWallets();
  if (wallets.length === 0) { console.log('No wallets.'); return; }
  const lucid = await lucidWith();
  const obAddr = await orderBookAddr();
  const ownerPkhs = new Set(wallets.map(w => pkhFromBech32(w.address)));
  const start = Date.now();
  let sawOrders = false;
  console.log(`▶ Waiting up to ${timeoutSec}s for ${wallets.length} wallets' orders to drain…`);
  while (Date.now() - start < timeoutSec * 1000) {
    const all = await lucid.utxosAt(obAddr).catch(() => []);
    const mine = all.filter(u => {
      if (!u.datum) return false;
      try { return ownerPkhs.has(decodeOrderDatum(u.datum).ownerPkh); }
      catch { return false; }
    });
    if (mine.length > 0) sawOrders = true;
    const elapsed = ((Date.now() - start) / 1000);
    if (mine.length === 0 && sawOrders) {
      console.log(`✓ all settled across ${wallets.length} wallets (${elapsed.toFixed(1)}s)`);
      return;
    }
    if (mine.length === 0 && !sawOrders && elapsed > 45) {
      console.log(`✓ no pending orders observed in ${elapsed.toFixed(0)}s — nothing to do`);
      return;
    }
    void kickBatcherAsync();
    console.log(`  ${mine.length} still pending across all wallets… (${elapsed.toFixed(0)}s)`);
    await new Promise(r => setTimeout(r, 7_000));
  }
  console.log(`✗ timeout after ${timeoutSec}s. Run \`status\` for detail.`);
}

async function cmdCancel(walletIdx) {
  const wallets = await loadWallets();
  const w = wallets[Number(walletIdx)];
  if (!w) throw new Error(`No wallet at index ${walletIdx}.`);

  const lucid = await lucidWith(w.seed);
  const obAddr = await orderBookAddr();

  // Await prev tx BEFORE fetching order_book UTxOs — otherwise a cancel
  // that immediately follows a trade returns "no pending orders" because
  // the lock tx hasn't been indexed yet, even though the order is in
  // mempool. This is the cancel-race-test path.
  if (w.lastTxHash) {
    process.stdout.write(`  awaiting prev tx ${w.lastTxHash.slice(0, 12)}…  `);
    try { await lucid.awaitTx(w.lastTxHash, 60_000); console.log('confirmed'); }
    catch { console.log('still pending — proceeding anyway'); }
  }

  const all = await lucid.utxosAt(obAddr);
  const ownerPkh = pkhFromBech32(w.address);

  const mine = [];
  for (const u of all) {
    if (!u.datum) continue;
    try {
      const d = decodeOrderDatum(u.datum);
      if (d.ownerPkh === ownerPkh) mine.push(u);
    } catch { /* skip */ }
  }

  if (mine.length === 0) { console.log(`No pending orders for ${w.name}.`); return; }
  console.log(`▶ Cancelling ${mine.length} order(s) for ${w.name}`);

  const validator = await orderBookValidator();
  let lastCancelHash = null;
  for (const u of mine) {
    try {
      const tx = await lucid.newTx()
        .collectFrom([u], encodeOrderRedeemerCancel())
        .attach.SpendingValidator(validator)
        .addSigner(w.address)
        .complete();
      const signed = await tx.sign.withWallet().complete();
      const txHash = await signed.submit();
      lastCancelHash = txHash;
      console.log(`    cancel  ${u.txHash.slice(0, 12)}…#${u.outputIndex}  →  ${txHash.slice(0, 12)}…`);
    } catch (e) {
      console.log(`    cancel  ${u.txHash.slice(0, 12)}…#${u.outputIndex}  ✗  ${e.message ?? e}`);
    }
  }

  if (lastCancelHash) {
    const all = await loadWallets();
    const idx = all.findIndex(x => x.name === w.name);
    if (idx >= 0) { all[idx].lastTxHash = lastCancelHash; await saveWallets(all); }
  }
}

// ── Argv dispatch ─────────────────────────────────────────────────────────

const HELP = `Preprod batcher test harness.

  init [count]                 Generate wallets (default 2). Stores seed phrases in .wallets.json
  faucet                       Print the wallet addresses to fund
  status                       Show every wallet's tADA, token holdings, pending orders
  trade <i> buy  <ada>  [tkr] [slippageBps]   BUY  from wallet i (default 1000 bps = 10%)
  trade <i> sell <tokens> [tkr] [slippageBps] SELL from wallet i (raw token units)
  burst <count> [adaEach] [tkr] [slippageBps] <count> concurrent BUYs (bump bps for >5 orders)
  tick                         Kick the batcher (cron doesn't fire under \`next dev\`)
  wait <i> [seconds]           Block until wallet i's pending orders all drain (default 180s)
  wait-all [seconds]           Block until every wallet's orders drain (default 240s)
  cancel <i>                   Cancel every pending order owned by wallet i
`;

async function main() {
  await loadEnv();
  const [, , subcmd, ...args] = process.argv;
  switch (subcmd) {
    case 'init':   await cmdInit(args[0]); break;
    case 'faucet': await cmdFaucet(); break;
    case 'status': await cmdStatus(); break;
    case 'trade':  await cmdTrade(args[0], args[1], args[2], args[3], args[4]); break;
    case 'burst':  await cmdBurst(args[0], args[1], args[2], args[3]); break;
    case 'tick':   await cmdTick(); break;
    case 'wait':   await cmdWait(args[0], Number(args[1]) || 180); break;
    case 'wait-all': await cmdWaitAll(Number(args[0]) || 240); break;
    case 'cancel': await cmdCancel(args[0]); break;
    case 'help':
    case '--help':
    case undefined:
      console.log(HELP); break;
    default:
      console.log(`Unknown subcommand '${subcmd}'.\n\n${HELP}`); process.exit(1);
  }
}

main().catch(err => {
  console.error('✗ ' + (err?.message ?? err));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
