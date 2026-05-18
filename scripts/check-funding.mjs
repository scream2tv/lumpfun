#!/usr/bin/env node
/**
 * Scan recent Midnight preprod blocks for unshielded outputs to the LumpFun
 * server wallet. Used to confirm faucet drops without running a full wallet sync.
 *
 * Usage: node scripts/check-funding.mjs [blocksBack]
 */

const INDEXER = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const ADDRESSES = [
  'mn_addr_preprod1k9ys85cvmjaad0utq6yqtpwz6e9qnecf6jc37grr02qs3gse229qlkvayw',
];
const ADDR_SET = new Set(ADDRESSES);
const blocksBack = Math.min(Math.max(1, Number(process.argv[2] ?? 200)), 20000);
const CONCURRENCY = 8;

async function gql(query) {
  const res = await fetch(INDEXER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

const FIELDS = `
  hash height timestamp
  transactions {
    hash
    unshieldedCreatedOutputs { owner tokenType value intentHash outputIndex }
  }
`;

const head = (await gql(`{ b0: block { ${FIELDS} } }`)).b0;
if (!head) { console.error('no head block'); process.exit(1); }

console.log(`Head: height=${head.height} ts=${new Date(head.timestamp).toISOString()}`);
console.log(`Scanning ${blocksBack} blocks back, filtering ${ADDRESSES.length} address(es):`);
for (const a of ADDRESSES) console.log(`  - ${a}`);

const BATCH = 5;
const matches = [];
let scanned = 0;

async function scanBatch(start) {
  const aliases = [];
  for (let i = start; i < Math.min(start + BATCH, blocksBack); i++) {
    aliases.push(`b${i}: block(offset: { height: ${head.height - i} }) { ${FIELDS} }`);
  }
  const data = await gql(`{ ${aliases.join(' ')} }`);
  for (const key of Object.keys(data)) {
    const b = data[key];
    if (!b) continue;
    scanned++;
    for (const tx of b.transactions) {
      for (const out of tx.unshieldedCreatedOutputs) {
        if (ADDR_SET.has(out.owner)) {
          matches.push({
            blockHeight: b.height,
            blockTimestamp: new Date(b.timestamp).toISOString(),
            txHash: tx.hash,
            owner: out.owner,
            tokenType: out.tokenType,
            value: out.value,
            outputIndex: out.outputIndex,
          });
        }
      }
    }
  }
}

const starts = [];
for (let s = 0; s < blocksBack; s += BATCH) starts.push(s);

for (let i = 0; i < starts.length; i += CONCURRENCY) {
  await Promise.all(starts.slice(i, i + CONCURRENCY).map(scanBatch));
  process.stdout.write(`\r  scanned ${scanned}/${blocksBack} blocks, ${matches.length} match(es)...`);
}
process.stdout.write('\n');

if (matches.length === 0) {
  console.log('No outputs found to this address in the scanned window.');
  console.log('  → Either the faucet tx is older than the window, or it has not landed yet.');
} else {
  console.log(`\nFound ${matches.length} output(s):`);
  for (const m of matches) console.log('  ', JSON.stringify(m));
  const total = matches.reduce((a, m) => a + BigInt(m.value), 0n);
  console.log(`\nTotal incoming (unshielded, all token types combined): ${total.toString()}`);
}
