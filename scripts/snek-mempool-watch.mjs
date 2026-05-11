#!/usr/bin/env node
// Phase 0 observation: measure snek.fun's on-chain throughput patterns
// without running their off-chain agent. Two modes:
//
//   --mode=kupo     Historical analysis. Pulls recently-spent order
//                   UTxOs from Kupo, groups by spending tx, and reports
//                   the distribution of batch sizes (how many orders
//                   each tx absorbed). Confirms or refutes intra-tx
//                   batching using ledger truth, no live trading needed.
//
//   --mode=mempool  Live mempool watcher via Ogmios. For each tx that
//                   creates an output at snek's pool script address,
//                   records first-seen timestamp. Later cross-reference
//                   with Kupo to compute mempool->block latency.
//
//   --mode=both     Run kupo first for historical baseline, then mempool
//                   for the rest of the configured duration.
//
// Usage:
//   node scripts/snek-mempool-watch.mjs --mode=kupo --hours=24
//   node scripts/snek-mempool-watch.mjs --mode=mempool --minutes=30
//
// Defaults assume Kupo at http://127.0.0.1:1442 and Ogmios at
// ws://127.0.0.1:1337 (the standard local-node ports). Override with
// --kupo=URL or --ogmios=URL.
//
// Requires Node 22+ (global WebSocket + fetch). No npm install needed.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname }          from 'node:path';

// Mainnet script hashes pulled from snek-cardano-agent/resources/
// mainnet.deployment.json (commit develop @ 2026-05-11).
const SNEK_MAINNET = {
  poolV1:    '905ab869961b094f1b8197278cfe15b45cbe49fa8f32c6b014f85a2d',
  poolV1T2T: 'c876c435e1de1bd93ac71f0e9f956a844cd72493514d2740221bfea6',
  order:     'd9143ac63473b17a215d1b7484dfb6ac6b4a0005beb0e26a6ca02c96',
  witness:   'a5643b4a22a192d7691d05baf4a9bbb8acdbb5daa60be1f333e128f1',
};

// ── CLI parsing (tiny, no deps) ─────────────────────────────────────────

function parseArgs() {
  const args = { mode: 'kupo', hours: 24, minutes: 30,
    kupo: 'http://127.0.0.1:1442', ogmios: 'ws://127.0.0.1:1337',
    out: 'docs/snekfun-observation-log.md' };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'hours' || k === 'minutes') args[k] = Number(v);
    else args[k] = v;
  }
  return args;
}

// ── Kupo helpers ────────────────────────────────────────────────────────

// Kupo's pattern matcher accepts a raw script hash and treats it as a
// payment-credential wildcard (matches both enterprise and base addrs
// whose payment cred is that hash). The `?spent` filter restricts to
// UTxOs that have been consumed.
//
// Modern Kupo (>=2.10) populates `spent_at.transaction_id`. Older
// versions only give slot_no + header_hash; we error out clearly in
// that case so the user knows to upgrade.
async function kupoMatches(kupo, scriptHash, { spent } = { spent: false }) {
  const url = `${kupo}/matches/${scriptHash}${spent ? '?spent' : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kupo ${url} → ${res.status}`);
  return res.json();
}

// Convert an absolute mainnet slot number to Unix ms. Cardano's slot 0
// is byron genesis (20s slots); shelley starts at slot 4492800 with 1s
// slots and a wall-clock time of 1596059091 (Jul 29, 2020 21:44:51 UTC).
// All modern txs are post-shelley so the linear branch is fine.
function slotToMs(slot) {
  const SHELLEY_START_SLOT = 4492800;
  const SHELLEY_START_S    = 1596059091;
  return (SHELLEY_START_S + (slot - SHELLEY_START_SLOT)) * 1000;
}

async function analyseViaKupo(args, sink) {
  sink.section('Kupo historical analysis');
  sink.info(`Window: last ${args.hours}h`);
  sink.info(`Querying Kupo at ${args.kupo}`);

  const matches = await kupoMatches(args.kupo, SNEK_MAINNET.order, { spent: true });
  sink.info(`Total spent order UTxOs returned: ${matches.length}`);

  if (matches.length === 0) {
    sink.warn('No spent orders at snek order-script address. Either Kupo is not synced, the script hash is wrong, or snek has been inactive.');
    return;
  }
  if (!matches[0].spent_at?.transaction_id) {
    sink.error('This Kupo version does not return spent_at.transaction_id. Upgrade Kupo to >= 2.10.');
    return;
  }

  const cutoffMs = Date.now() - args.hours * 3_600_000;
  const recent = matches.filter(m => slotToMs(m.spent_at.slot_no) >= cutoffMs);
  sink.info(`Within window: ${recent.length} spent orders`);

  // Group by spending tx → batch size = # of order UTxOs in that tx.
  const byTx = new Map();
  for (const m of recent) {
    const id = m.spent_at.transaction_id;
    byTx.set(id, (byTx.get(id) ?? 0) + 1);
  }

  const sizes = [...byTx.values()].sort((a, b) => a - b);
  if (sizes.length === 0) { sink.warn('Window empty.'); return; }

  const hist = {};
  for (const s of sizes) hist[s] = (hist[s] ?? 0) + 1;

  const sum = sizes.reduce((a, b) => a + b, 0);
  const pct = (p) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))];

  sink.result(`Pool batch txs in window: ${byTx.size}`);
  sink.result(`Total orders settled:     ${sum}`);
  sink.result(`Avg batch size:           ${(sum / byTx.size).toFixed(2)}`);
  sink.result(`Median (p50):             ${pct(0.5)}`);
  sink.result(`p95:                      ${pct(0.95)}`);
  sink.result(`Max:                      ${sizes[sizes.length - 1]}`);
  sink.subsection('Batch-size histogram (orders/tx → tx count)');
  for (const [size, count] of Object.entries(hist).sort((a,b) => Number(a[0]) - Number(b[0]))) {
    const bar = '█'.repeat(Math.min(40, count));
    sink.kv(`${size.padStart(3)}`, `${String(count).padStart(4)} ${bar}`);
  }

  return { sizes, byTx, recent };
}

// ── Ogmios mempool watcher ──────────────────────────────────────────────

// Watch the local node's mempool for txs that look like snek pool
// settlements. Heuristic: any tx whose outputs include an address with
// payment credential = poolV1 or poolV1T2T script hash. Record the
// hash + first-seen-at timestamp. After the run, cross-reference with
// Kupo for confirmation slot to compute mempool→block latency.
// Learn the bech32 forms of the pool script addresses from Kupo. We
// can't substring-match a raw hex hash against a bech32 string, so we
// ask Kupo for any UTxO at each pool script and collect the resulting
// `.address` strings. Different stake credentials yield different
// addresses, so this can return >1 per hash.
async function discoverPoolAddresses(kupo, sink) {
  const set = new Set();
  for (const h of [SNEK_MAINNET.poolV1, SNEK_MAINNET.poolV1T2T]) {
    const ms = await kupoMatches(kupo, h).catch(() => []);
    for (const m of ms) if (m.address) set.add(m.address);
  }
  sink.info(`Discovered ${set.size} distinct pool bech32 addresses via Kupo`);
  for (const a of set) sink.kv('pool', a);
  return set;
}

async function watchMempool(args, sink) {
  sink.section('Ogmios mempool watcher');
  sink.info(`Connecting to ${args.ogmios}`);
  sink.info(`Duration: ${args.minutes}min`);

  const poolAddrs = await discoverPoolAddresses(args.kupo, sink);
  if (poolAddrs.size === 0) {
    sink.error('No pool addresses discovered. Is Kupo synced? Are the script hashes still current?');
    return;
  }

  const ws = new WebSocket(args.ogmios);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  sink.info('Connected.');

  const seen = new Map();   // tx_hash → firstSeenMs

  let acquired = false;
  let inflight = false;

  function send(method, params, id) {
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
  }
  function pump() {
    if (inflight) return;
    inflight = true;
    if (!acquired) send('acquireMempool', {}, 'acq');
    else           send('nextTransaction', { fields: 'all' }, 'next');
  }

  ws.onmessage = (raw) => {
    const msg = JSON.parse(raw.data.toString());
    inflight = false;
    if (msg.id === 'acq') {
      acquired = true;
      pump();
    } else if (msg.id === 'next') {
      const tx = msg.result?.transaction;
      if (!tx) {
        // End of snapshot; release implicitly by re-acquiring after a
        // short pause (avoid hammering Ogmios during quiet periods).
        acquired = false;
        setTimeout(pump, 750);
        return;
      }
      // Tx is a snek pool tx if any output goes back to a known pool
      // bech32 address (learned via Kupo on startup).
      const isSnekPoolTx = (tx.outputs ?? []).some(o => poolAddrs.has(o.address));
      if (isSnekPoolTx && !seen.has(tx.id)) {
        seen.set(tx.id, Date.now());
        sink.info(`[mempool +${(Date.now() - startMs)/1000 | 0}s] saw snek pool tx ${tx.id.slice(0, 12)}… (n=${seen.size})`);
      }
      pump();
    } else if (msg.error) {
      sink.warn(`Ogmios error: ${JSON.stringify(msg.error)}`);
    }
  };

  const startMs = Date.now();
  pump();

  await new Promise(r => setTimeout(r, args.minutes * 60_000));
  ws.close();
  sink.result(`Captured ${seen.size} snek pool txs in mempool over ${args.minutes}min`);

  if (seen.size === 0) {
    sink.warn('No snek pool txs seen. Either the pool was quiet during this window, the heuristic missed them (try increasing duration), or the address-substring check needs tightening.');
    return { seen };
  }

  // Cross-reference with Kupo for confirmation slots.
  sink.subsection('Cross-referencing with Kupo for confirmation time');
  // Pull all spent order UTxOs since startMs and group by spending tx.
  // For each tx_hash in `seen`, look up its slot via Kupo and compute
  // mempool→block latency.
  const matches = await kupoMatches(args.kupo, SNEK_MAINNET.order, { spent: true });
  const txToSlot = new Map();
  for (const m of matches) {
    if (m.spent_at?.transaction_id && m.spent_at?.slot_no != null) {
      txToSlot.set(m.spent_at.transaction_id, m.spent_at.slot_no);
    }
  }
  const latencies = [];
  for (const [tx, firstSeenMs] of seen) {
    const slot = txToSlot.get(tx);
    if (slot == null) continue;
    const confirmedMs = slotToMs(slot);
    latencies.push(Math.max(0, confirmedMs - firstSeenMs));
  }
  if (latencies.length === 0) {
    sink.warn('Could not match any mempool txs back to Kupo confirmations (likely the txs are too recent or Kupo is still indexing).');
    return { seen, latencies };
  }
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
  sink.result(`Mempool→block latency (n=${latencies.length}):`);
  sink.kv('p50', `${(pct(0.5)/1000).toFixed(1)}s`);
  sink.kv('p95', `${(pct(0.95)/1000).toFixed(1)}s`);
  sink.kv('max', `${(latencies[latencies.length-1]/1000).toFixed(1)}s`);

  return { seen, latencies };
}

// ── Markdown sink: collects results to stdout AND a file ───────────────

function makeSink(outPath) {
  const lines = [];
  const print = (s) => { console.log(s); lines.push(s); };
  return {
    section:    (t) => print(`\n## ${t}\n`),
    subsection: (t) => print(`\n### ${t}\n`),
    info:       (t) => print(`- ${t}`),
    warn:       (t) => print(`- WARN: ${t}`),
    error:      (t) => print(`- ERROR: ${t}`),
    result:     (t) => print(`- **${t}**`),
    kv:         (k, v) => print(`  - \`${k}\`: ${v}`),
    raw:        (t) => print(t),
    async flush() {
      if (!outPath) return;
      await mkdir(dirname(outPath), { recursive: true });
      const header = `# snek.fun observation log\n\nGenerated ${new Date().toISOString()}\n`;
      await writeFile(outPath, header + lines.join('\n') + '\n');
      console.log(`\n[wrote ${outPath}]`);
    },
  };
}

// ── Entry ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const sink = makeSink(args.out);

  sink.raw(`Config: mode=${args.mode}  hours=${args.hours}  minutes=${args.minutes}`);
  sink.raw(`        kupo=${args.kupo}`);
  sink.raw(`        ogmios=${args.ogmios}`);

  try {
    if (args.mode === 'kupo' || args.mode === 'both') {
      await analyseViaKupo(args, sink);
    }
    if (args.mode === 'mempool' || args.mode === 'both') {
      await watchMempool(args, sink);
    }
    if (!['kupo', 'mempool', 'both'].includes(args.mode)) {
      sink.error(`Unknown --mode=${args.mode}. Use kupo | mempool | both.`);
      process.exit(2);
    }
  } finally {
    await sink.flush();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
