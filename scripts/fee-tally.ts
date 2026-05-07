#!/usr/bin/env ts-node
/**
 * One-off platform + creator fee tally for a Discord announcement.
 *
 * Pulls every launched token from the production registry (via /api/tokens),
 * walks each curve address's full tx history on Blockfrost, and for every
 * trade:
 *   - platform fee   = 1 ADA flat
 *   - creator fee    = creatorFeeBps × adaIn  (buys: ada flowing in to curve)
 *                    = creatorFeeBps × adaGross (sells: ada flowing out)
 * Run:  cd web && npx tsx ../scripts/fee-tally.ts
 *
 * Prints per-token rows + grand totals. Read-only; no chain writes.
 */

const PROD_API = process.env.PROD_API ?? 'https://lumpfun.com';
const BF_BASE  = process.env.BLOCKFROST_BASE_URL  ?? 'https://cardano-mainnet.blockfrost.io/api/v0';
const BF_KEY   = process.env.BLOCKFROST_PROJECT_ID ?? '';

if (!BF_KEY) {
  console.error('BLOCKFROST_PROJECT_ID not set. Run from web/ so .env.local is picked up by tsx, or export it.');
  process.exit(1);
}

interface TokenRow {
  policyId: string;
  assetName: string;
  ticker: string;
  curveAddress: string;
  creatorFeeBps: number;
}

interface BfTxRef { tx_hash: string; block_time: number }
interface BfUtxoSide {
  address: string;
  inline_datum: string | null;
  amount: Array<{ unit: string; quantity: string }>;
}
interface BfTxUtxos { inputs: BfUtxoSide[]; outputs: BfUtxoSide[] }

function readCborUint(hex: string, pos: number): [bigint, number] {
  const b = parseInt(hex.slice(pos, pos + 2), 16);
  if (b <= 0x17) return [BigInt(b), pos + 2];
  if (b === 0x18) return [BigInt(parseInt(hex.slice(pos + 2, pos + 4), 16)), pos + 4];
  if (b === 0x19) return [BigInt(parseInt(hex.slice(pos + 2, pos + 6), 16)), pos + 6];
  if (b === 0x1a) return [BigInt(parseInt(hex.slice(pos + 2, pos + 10), 16)), pos + 10];
  if (b === 0x1b) return [BigInt(parseInt(hex.slice(pos + 2, pos + 18), 16)), pos + 18];
  throw new Error(`bad cbor uint at ${pos}`);
}
function parseDatum(hex: string): { ada: bigint; tokens: bigint } | null {
  try {
    const body = hex.replace(/^d879[89a-f][0-9a-f]/, '');
    const [ada, p1] = readCborUint(body, 0);
    const [tokens]  = readCborUint(body, p1);
    return { ada, tokens };
  } catch { return null; }
}

async function bf<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BF_BASE}${path}`, { headers: { project_id: BF_KEY } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blockfrost ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function listAllTxs(address: string): Promise<BfTxRef[]> {
  const all: BfTxRef[] = [];
  for (let page = 1; page < 50; page++) {
    const chunk = await bf<BfTxRef[]>(`/addresses/${address}/transactions?order=asc&count=100&page=${page}`);
    if (!chunk || chunk.length === 0) break;
    all.push(...chunk);
    if (chunk.length < 100) break;
  }
  return all;
}

function fmtAda(lovelace: bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  return `${ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₳`;
}

async function main() {
  console.log(`Fetching token registry from ${PROD_API}/api/tokens …`);
  const tokensRes = await fetch(`${PROD_API}/api/tokens`);
  if (!tokensRes.ok) throw new Error(`/api/tokens → ${tokensRes.status}`);
  const tokens = await tokensRes.json() as TokenRow[];
  console.log(`Found ${tokens.length} tokens. Walking trade history per curve…\n`);

  let grandTrades  = 0;
  let grandPlatform = 0n;
  let grandCreator  = 0n;

  console.log('TICKER         TRADES   PLATFORM (₳)        CREATOR (₳)');
  console.log('────────────── ──────  ──────────────────  ──────────────────');

  for (const t of tokens) {
    const txs = await listAllTxs(t.curveAddress);
    let tradeCount = 0;
    let creatorAcc = 0n;

    for (const tx of txs) {
      const u = await bf<BfTxUtxos>(`/txs/${tx.tx_hash}/utxos`);
      if (!u) continue;
      const curveIn  = u.inputs.find(i  => i.address === t.curveAddress && i.inline_datum);
      const curveOut = u.outputs.find(o => o.address === t.curveAddress && o.inline_datum);
      if (!curveIn?.inline_datum || !curveOut?.inline_datum) continue; // launch / drain
      const inS  = parseDatum(curveIn.inline_datum);
      const outS = parseDatum(curveOut.inline_datum);
      if (!inS || !outS) continue;
      const adaDelta = outS.ada - inS.ada;
      if (adaDelta === 0n) continue;
      const adaSize = adaDelta < 0n ? -adaDelta : adaDelta;
      tradeCount += 1;
      creatorAcc += (adaSize * BigInt(t.creatorFeeBps)) / 10_000n;
    }

    const platformAcc = BigInt(tradeCount) * 1_000_000n;
    grandTrades   += tradeCount;
    grandPlatform += platformAcc;
    grandCreator  += creatorAcc;

    console.log(
      `${t.ticker.padEnd(14)} ${String(tradeCount).padStart(6)}  ` +
      `${fmtAda(platformAcc).padStart(18)}  ${fmtAda(creatorAcc).padStart(18)}`,
    );
  }

  console.log('────────────── ──────  ──────────────────  ──────────────────');
  console.log(
    `${'TOTAL'.padEnd(14)} ${String(grandTrades).padStart(6)}  ` +
    `${fmtAda(grandPlatform).padStart(18)}  ${fmtAda(grandCreator).padStart(18)}`,
  );
  console.log('');
  console.log('Notes:');
  console.log('  • Platform fee is 1 ADA per buy/sell (bonding curve only — pre-graduation).');
  console.log('  • Creator fee is creatorFeeBps × tx ADA size; goes to creator wallet (legacy)');
  console.log('    or fee accumulator script (new launches). Includes both swept and unclaimed.');
  console.log('  • Excludes Minswap V2 trading fees post-graduation.');
}

main().catch(e => { console.error(e); process.exit(1); });
