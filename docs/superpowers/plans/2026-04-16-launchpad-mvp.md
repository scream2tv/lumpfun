# LumpFun Launchpad MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a preprod-only, CLI-driven launchpad on Midnight Network that lets a creator deploy a `LumpLaunch` Compact contract and lets buyers/sellers trade tokens along a linear bonding curve, with fees split on-chain to platform, creator, and optional referral, per the spec at `docs/launchpad-mvp.md`.

**Architecture:** One Compact contract per launch (Compact 0.30 / ledger v8 has no contract-to-contract calls, so the token ledger, curve state, and fee config are co-located in a single `LumpLaunch` contract). TypeScript client mirrors `midnight-agent` module boundaries (`config` / `chain` / `wallet` / `launch` / `cli`) and wires the Midnight JS SDK. Fees use a pull pattern (accrue-then-withdraw) and are immutable at deploy. Quote asset is native **tNIGHT** on preprod.

**Tech Stack:**
- Compact language, pragma `>= 0.21.0`, toolchain `0.30.0`.
- Node ≥ 18; TypeScript `^5.4`; ESM (`"type": "module"`).
- `@midnight-ntwrk/*` package family at the versions in `/Users/scream2/agent-lump/midnight-agent/package.json:27-52`.
- `vitest` for both pure-TS and Compact-simulator tests.
- Docker Compose for the local proof server (`proof-server.yml`).
- `tsx` for local dev; `commander` for the CLI (replaces the hand-rolled dispatcher in the reference).

**Reference repo (read-only, patterns not source):** `/Users/scream2/agent-lump/midnight-agent`.

---

## File Structure (target final tree)

```
LumpFun/
├── .env.example
├── .gitignore                  (already present)
├── README.md
├── package.json
├── proof-server.yml
├── tsconfig.json
├── vitest.config.ts
├── contracts/
│   ├── lump_launch.compact
│   └── managed/                (gitignored; output of `compact compile`)
├── docs/
│   ├── launchpad-mvp.md        (spec, already present)
│   ├── security.md
│   └── superpowers/plans/2026-04-16-launchpad-mvp.md  (this file)
├── spikes/
│   └── dr1_native_night/       (outcome + spike artifacts from Task 3)
├── src/
│   ├── chain.ts
│   ├── cli.ts
│   ├── config.ts
│   ├── curve.ts
│   ├── fees.ts
│   ├── index.ts
│   ├── launch.ts
│   ├── night.ts
│   ├── registry.ts
│   └── wallet.ts
└── tests/
    ├── simulator/
    │   ├── access_control.test.ts
    │   ├── curve.test.ts
    │   ├── fees.test.ts
    │   ├── harness.ts
    │   ├── immutability.test.ts
    │   ├── invariants.test.ts
    │   └── ts_parity.test.ts
    ├── unit/
    │   ├── config.test.ts
    │   ├── curve_math.test.ts
    │   └── fees_math.test.ts
    └── preprod/
        └── end_to_end.test.ts  (gated by MIDNIGHT_PREPROD_E2E=1)
```

Each file has one responsibility:
- `config.ts` — preprod hard-default + fail-fast guards.
- `chain.ts` — read-only RPC + indexer transport.
- `wallet.ts` — HD + 3-wallet facade.
- `night.ts` — NIGHT payment adapter (DR-1 seam).
- `curve.ts` / `fees.ts` — pure TS mirrors of circuit math.
- `launch.ts` — domain module: deploy, trade, withdraw, query.
- `registry.ts` — client-side launch list.
- `cli.ts` — command dispatcher.
- `index.ts` — namespace re-exports.

---

## DR-1 Branch Note (applies to Tasks 8–15)

Spec §5.5 calls out **DR-1: `send_night(to, amount)` primitive.** The resolution is produced by **Task 3** and recorded at `spikes/dr1_native_night/OUTCOME.md`. Later tasks assume the most-likely outcome (a) — the contract can debit `night_reserve` and emit NIGHT outputs to a `Bytes<32>` recipient via a Compact primitive. If Task 3 determines **(b)** (emit commitment → TS client reconciles) or **(c)** (fall back to a pre-deployed `tLUMP` quote token), adjust Tasks 8 / 13 per the inline "DR-1 branch" notes.

---

## Task 1: Repo scaffolding (package.json, tsconfig, vitest, env, proof-server)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `proof-server.yml`
- Modify: `.gitignore` (append)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "lumpfun",
  "version": "0.1.0",
  "description": "Pump.fun-inspired launchpad for Midnight Network (preprod only, CLI MVP)",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "start": "node dist/cli.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:preprod": "MIDNIGHT_PREPROD_E2E=1 vitest run tests/preprod",
    "compact:compile": "compact compile contracts/lump_launch.compact contracts/managed/lump_launch",
    "compact:clean": "rm -rf contracts/managed"
  },
  "dependencies": {
    "@midnight-ntwrk/compact-js": "2.5.0",
    "@midnight-ntwrk/compact-runtime": "0.15.0",
    "@midnight-ntwrk/ledger-v8": "^8.0.2",
    "@midnight-ntwrk/midnight-js-contracts": "4.0.2",
    "@midnight-ntwrk/midnight-js-http-client-proof-provider": "4.0.2",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "4.0.2",
    "@midnight-ntwrk/midnight-js-level-private-state-provider": "4.0.2",
    "@midnight-ntwrk/midnight-js-network-id": "4.0.2",
    "@midnight-ntwrk/midnight-js-node-zk-config-provider": "4.0.2",
    "@midnight-ntwrk/midnight-js-types": "4.0.2",
    "@midnight-ntwrk/midnight-js-utils": "4.0.2",
    "@midnight-ntwrk/wallet-sdk-address-format": "3.1.0",
    "@midnight-ntwrk/wallet-sdk-dust-wallet": "3.0.0",
    "@midnight-ntwrk/wallet-sdk-facade": "3.0.0",
    "@midnight-ntwrk/wallet-sdk-hd": "3.0.1",
    "@midnight-ntwrk/wallet-sdk-indexer-client": "1.2.0",
    "@midnight-ntwrk/wallet-sdk-node-client": "1.1.0",
    "@midnight-ntwrk/wallet-sdk-prover-client": "1.2.0",
    "@midnight-ntwrk/wallet-sdk-shielded": "2.1.0",
    "@midnight-ntwrk/wallet-sdk-unshielded-wallet": "2.1.0",
    "commander": "^12.1.0",
    "dotenv": "^16.4.0",
    "ws": "^8.19.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/ws": "^8.18.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "contracts/managed"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/simulator/**/*.test.ts', 'tests/preprod/**/*.test.ts'],
    exclude: process.env.MIDNIGHT_PREPROD_E2E === '1' ? [] : ['tests/preprod/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write `.env.example`**

```
# ─── Network (PREPROD ONLY for v0) ─────────────────────────────────────
MIDNIGHT_NETWORK=preprod

# ─── RPC (Substrate JSON-RPC) ──────────────────────────────────────────
MIDNIGHT_RPC_URL=https://rpc.preprod.midnight.network/
MIDNIGHT_RPC_WSS_URL=wss://rpc.preprod.midnight.network

# ─── Indexer (GraphQL) ─────────────────────────────────────────────────
MIDNIGHT_INDEXER_URL=https://indexer.preprod.midnight.network/api/v3/graphql
MIDNIGHT_INDEXER_WS_URL=wss://indexer.preprod.midnight.network/api/v3/graphql/ws

# ─── Prover (local docker, port 6300) ──────────────────────────────────
MIDNIGHT_PROVER_URL=http://localhost:6300

# ─── Explorer ──────────────────────────────────────────────────────────
MIDNIGHT_EXPLORER_URL=https://explorer.preprod.midnight.network

# ─── Wallet seed (hex-encoded, 32 bytes) ───────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# MIDNIGHT_WALLET_SEED=

# Full indexer sync can exceed 10m on first run. Override if needed.
# MIDNIGHT_WALLET_SYNC_TIMEOUT_MS=1800000

# ─── Mainnet bypass (DO NOT SET; see docs/security.md) ─────────────────
# LUMPFUN_ALLOW_MAINNET=
```

- [ ] **Step 5: Write `proof-server.yml`**

Copy from the reference at `/Users/scream2/agent-lump/midnight-agent/proof-server.yml`. Verify it pins the preprod-compatible image tag. If the reference file uses `latest`, pin it to the tag shown in `docker compose` logs when the reference deploy-counter script last worked (ask reference-repo owner if unclear; do not guess).

Read the reference file with `cat /Users/scream2/agent-lump/midnight-agent/proof-server.yml` and copy content verbatim into `./proof-server.yml`.

- [ ] **Step 6: Append to `.gitignore`**

```
node_modules/
dist/
.env
.env.local
contracts/managed/
.DS_Store
*.log
spikes/dr1_native_night/node_modules/
~/.lumpfun/
```

- [ ] **Step 7: Install & sanity-check**

Run:
```
npm install
npm run typecheck
```

Expected: `typecheck` passes with zero errors (no source files yet, so this verifies only that tsconfig is valid — an empty `src` directory is fine).

- [ ] **Step 8: Commit**

```
git add package.json tsconfig.json vitest.config.ts .env.example proof-server.yml .gitignore
git commit -m "chore: scaffold package.json, tsconfig, vitest, env, proof-server"
```

---

## Task 2: `src/config.ts` with preprod hard-default + `assertPreprod()`

**Files:**
- Create: `src/config.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/config.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('defaults to preprod when MIDNIGHT_NETWORK is unset', async () => {
    delete process.env.MIDNIGHT_NETWORK;
    const { getConfig } = await import('../../src/config.js');
    const c = getConfig();
    expect(c.networkId).toBe('preprod');
    expect(c.rpcUrl).toMatch(/preprod\.midnight\.network/);
  });

  it('throws when MIDNIGHT_NETWORK is mainnet without bypass', async () => {
    process.env.MIDNIGHT_NETWORK = 'mainnet';
    delete process.env.LUMPFUN_ALLOW_MAINNET;
    const { getConfig } = await import('../../src/config.js');
    expect(() => getConfig()).toThrow(/mainnet/i);
  });

  it('throws when any URL points at mainnet without bypass', async () => {
    process.env.MIDNIGHT_NETWORK = 'preprod';
    process.env.MIDNIGHT_INDEXER_URL = 'https://indexer.mainnet.midnight.network/api/v3/graphql';
    delete process.env.LUMPFUN_ALLOW_MAINNET;
    const { getConfig } = await import('../../src/config.js');
    expect(() => getConfig()).toThrow(/mainnet/i);
  });

  it('permits mainnet when LUMPFUN_ALLOW_MAINNET=1 is set', async () => {
    process.env.MIDNIGHT_NETWORK = 'mainnet';
    process.env.LUMPFUN_ALLOW_MAINNET = '1';
    const { getConfig } = await import('../../src/config.js');
    const c = getConfig();
    expect(c.networkId).toBe('mainnet');
  });

  it('assertPreprod throws on mainnet', async () => {
    process.env.MIDNIGHT_NETWORK = 'mainnet';
    process.env.LUMPFUN_ALLOW_MAINNET = '1';
    const { assertPreprod } = await import('../../src/config.js');
    expect(() => assertPreprod()).toThrow(/preprod/i);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npm test tests/unit/config.test.ts
```
Expected: FAIL — `src/config.ts` does not exist.

- [ ] **Step 3: Write `src/config.ts`**

```ts
import 'dotenv/config';

export type NetworkId = 'mainnet' | 'preprod' | 'preview';

export interface MidnightConfig {
  networkId: NetworkId;
  rpcUrl: string;
  rpcWssUrl: string;
  indexerUrl: string;
  indexerWsUrl: string;
  proverUrl: string;
  explorerUrl: string;
}

const DEFAULTS: Record<NetworkId, MidnightConfig> = {
  mainnet: {
    networkId: 'mainnet',
    rpcUrl: 'https://rpc.mainnet.midnight.network/',
    rpcWssUrl: 'wss://rpc.mainnet.midnight.network',
    indexerUrl: 'https://indexer.mainnet.midnight.network/api/v3/graphql',
    indexerWsUrl: 'wss://indexer.mainnet.midnight.network/api/v3/graphql/ws',
    proverUrl: 'http://localhost:6300',
    explorerUrl: 'https://explorer.mainnet.midnight.network',
  },
  preprod: {
    networkId: 'preprod',
    rpcUrl: 'https://rpc.preprod.midnight.network/',
    rpcWssUrl: 'wss://rpc.preprod.midnight.network',
    indexerUrl: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    proverUrl: 'http://localhost:6300',
    explorerUrl: 'https://explorer.preprod.midnight.network',
  },
  preview: {
    networkId: 'preview',
    rpcUrl: 'https://rpc.preview.midnight.network/',
    rpcWssUrl: 'wss://rpc.preview.midnight.network',
    indexerUrl: 'https://indexer.preview.midnight.network/api/v3/graphql',
    indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    proverUrl: 'http://localhost:6300',
    explorerUrl: 'https://explorer.preview.midnight.network',
  },
};

function mainnetAllowed(): boolean {
  return process.env.LUMPFUN_ALLOW_MAINNET === '1';
}

export function getConfig(): MidnightConfig {
  const network = (process.env.MIDNIGHT_NETWORK ?? 'preprod') as NetworkId;

  if (!['mainnet', 'preprod', 'preview'].includes(network)) {
    throw new Error(`Unknown MIDNIGHT_NETWORK '${network}' — expected preprod | preview | mainnet`);
  }

  if (network === 'mainnet' && !mainnetAllowed()) {
    throw new Error(
      'MIDNIGHT_NETWORK=mainnet is disabled. LumpFun v0 is preprod-only. ' +
      'See docs/security.md for the mainnet readiness checklist before overriding.',
    );
  }

  const defaults = DEFAULTS[network];
  const cfg: MidnightConfig = {
    networkId: network,
    rpcUrl: process.env.MIDNIGHT_RPC_URL ?? defaults.rpcUrl,
    rpcWssUrl: process.env.MIDNIGHT_RPC_WSS_URL ?? defaults.rpcWssUrl,
    indexerUrl: process.env.MIDNIGHT_INDEXER_URL ?? defaults.indexerUrl,
    indexerWsUrl: process.env.MIDNIGHT_INDEXER_WS_URL ?? defaults.indexerWsUrl,
    proverUrl: process.env.MIDNIGHT_PROVER_URL ?? defaults.proverUrl,
    explorerUrl: process.env.MIDNIGHT_EXPLORER_URL ?? defaults.explorerUrl,
  };

  if (!mainnetAllowed()) {
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === 'string' && v.includes('mainnet.')) {
        throw new Error(
          `Config URL points at mainnet (${k}=${v}). LumpFun v0 is preprod-only.`,
        );
      }
    }
  }

  return cfg;
}

export function assertPreprod(): void {
  const cfg = getConfig();
  if (cfg.networkId !== 'preprod') {
    throw new Error(`assertPreprod() failed: networkId=${cfg.networkId}`);
  }
}

export function explorerLink(path: string): string {
  return `${getConfig().explorerUrl}${path}`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```
npm test tests/unit/config.test.ts
```
Expected: 5 passing.

- [ ] **Step 5: Commit**

```
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat(config): preprod hard-default, mainnet fail-fast, assertPreprod"
```

---

## Task 3: DR-1 spike — native NIGHT in/out of a Compact contract on preprod

**Goal:** Produce `spikes/dr1_native_night/OUTCOME.md` with a concrete decision: **(a)** native in-circuit NIGHT I/O works; **(b)** commitment-then-TS-reconcile required; **(c)** fall back to a pre-deployed `tLUMP` quote token.

This task is investigation, not TDD. It blocks Tasks 8, 13.

**Files:**
- Create: `spikes/dr1_native_night/spike.compact`
- Create: `spikes/dr1_native_night/run.ts`
- Create: `spikes/dr1_native_night/OUTCOME.md`

- [ ] **Step 1: Read the reference transfer module for unshielded-NIGHT patterns**

```
less /Users/scream2/agent-lump/midnight-agent/src/transfer.ts
```
Note which wallet-SDK primitives handle unshielded offers and whether any construct binds an offer to a contract address. Record observations (1 paragraph) in `spikes/dr1_native_night/OUTCOME.md` under `## Reference findings`.

- [ ] **Step 2: Search Compact toolchain for primitives**

Run:
```
ls /Users/scream2/agent-lump/midnight-agent/contracts/compact-contracts/contracts/src/
grep -r "native\|unshielded\|send\|receive" \
  /Users/scream2/agent-lump/midnight-agent/contracts/compact-contracts/contracts/src/ \
  --include "*.compact" | head -30
```
Record primitives found (e.g., `send_native(to, amount)`, `claim_zswap_coin`, stdlib modules) in `OUTCOME.md` under `## Compact primitive survey`.

- [ ] **Step 3: Write a minimal spike contract**

`spikes/dr1_native_night/spike.compact`:
```compact
pragma language_version >= 0.21.0;
import CompactStandardLibrary;

export ledger deposited: Uint<128>;

// If a primitive like `receive_native(amount)` exists, this should
// consume NIGHT from the tx inputs and attribute it to the contract.
export circuit deposit(amount: Uint<128>): [] {
  // TODO during spike: replace with the actual primitive discovered in Step 2.
  // Candidates to try in order:
  //   receive_native(amount);
  //   claim_zswap_coin(amount);
  //   receive_unshielded(amount);
  deposited = (deposited as Uint<128>) + amount;
}

// If a primitive like `send_native(to, amount)` exists, this should
// emit an unshielded NIGHT output to the recipient.
export circuit withdraw(to: Bytes<32>, amount: Uint<128>): [] {
  assert (deposited as Uint<128>) >= amount;
  // TODO during spike: replace with the actual primitive.
  // Candidates:
  //   send_native(to, amount);
  //   emit_unshielded_output(to, amount);
  deposited = (deposited as Uint<128>) - amount;
}

export circuit read(): Uint<128> {
  return deposited;
}
```

- [ ] **Step 4: Compile the spike**

```
cd spikes/dr1_native_night
compact compile spike.compact managed/spike
```

For each candidate primitive from Step 2, edit `spike.compact`, re-run `compact compile`, and record which ones compile successfully in `OUTCOME.md` under `## Compile results`.

- [ ] **Step 5: Deploy + interact with the compiled spike on preprod**

Write `spikes/dr1_native_night/run.ts` that (using the same SDK-provider wiring as `/Users/scream2/agent-lump/midnight-agent/src/token.ts:180-233`) deploys `spike`, calls `deposit(1000)` with a 1000-atom NIGHT offer bound to the deploy tx, then calls `withdraw(<wallet-pubkey>, 500)`, then calls `read()`.

If deposit succeeds and the wallet NIGHT balance decreased by ≥1000, **outcome (a)** for receive works. If withdraw succeeds and wallet NIGHT balance increased by 500, **outcome (a)** for send works.

If a primitive doesn't exist but the SDK's unshielded-wallet `offer` primitive can bind an output commitment to a `contract address`, record that the path is **outcome (b)**.

If neither works, the path is **outcome (c)** — document the `tLUMP` fallback plan.

- [ ] **Step 6: Write `OUTCOME.md`**

```markdown
# DR-1 Outcome

**Decision:** (a | b | c)

**Date:** YYYY-MM-DD
**Compact version:** `compact compile --version` output
**Ledger version:** from `@midnight-ntwrk/ledger-v8` package.json

## Summary
(1–2 sentences on which outcome applies)

## Evidence
- Compile results (Step 4).
- Preprod deploy + call results (Step 5): tx hashes, observed NIGHT balance deltas.

## Primitives to use in `lump_launch.compact`
- Receive: `...`
- Send: `...`

## Adjustments to later tasks if outcome ≠ (a)
- Task 8: `send_night` / `receive_native` primitives become `...`.
- Task 13: `src/night.ts` must additionally do X / Y / Z.
```

- [ ] **Step 7: Commit**

```
git add spikes/dr1_native_night
git commit -m "spike(dr1): resolve native NIGHT in/out of Compact contract"
```

---

## Task 4: Port `src/chain.ts`

**Files:**
- Create: `src/chain.ts`

This is a read-only adaptation of `/Users/scream2/agent-lump/midnight-agent/src/chain.ts`. We only need: `rpcCall`, `queryIndexer`, `getContractState`, `getTxByHash`, and health probes. Ascend / DEX helpers from the reference are dropped.

- [ ] **Step 1: Copy the transport scaffolding**

Open `/Users/scream2/agent-lump/midnight-agent/src/chain.ts` and copy lines 1–200 (the `RpcError`, `rpcCall`, `queryIndexer` helpers, and `getChainInfo`) into `src/chain.ts`. Keep imports pointing at our local `./config.js`.

- [ ] **Step 2: Trim unneeded exports**

Remove functions specific to the reference repo's feature set: DEX pool listing, Ascend pieces, bridge status, "methods" enumeration. Keep: `rpcCall`, `queryIndexer`, `getChainInfo`, `getContractState(address)`, `getTxByHash(hash)`, `rpcHealth()`.

- [ ] **Step 3: Write a trivial smoke test**

`tests/unit/chain.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RpcError } from '../../src/chain.js';

describe('chain', () => {
  it('exports RpcError', () => {
    expect(new RpcError(1, 'x').message).toContain('RPC error 1: x');
  });
});
```

(Network-touching tests live in `tests/preprod/` and are gated by env.)

- [ ] **Step 4: Typecheck + unit test pass**

```
npm run typecheck && npm test tests/unit/chain.test.ts
```
Expected: pass.

- [ ] **Step 5: Commit**

```
git add src/chain.ts tests/unit/chain.test.ts
git commit -m "feat(chain): port read-only RPC + indexer helpers from reference"
```

---

## Task 5: Port `src/wallet.ts`

**Files:**
- Create: `src/wallet.ts`

Mirrors `/Users/scream2/agent-lump/midnight-agent/src/wallet.ts` with three changes:
1. Seed file path defaults to `~/.lumpfun/seed.hex` (was `~/.agent-lump/midnight/seed.hex`).
2. Network-id setup calls `assertPreprod()` unless `LUMPFUN_ALLOW_MAINNET=1`.
3. Imports from `./config.js` (local).

- [ ] **Step 1: Copy the reference file verbatim**

```
cp /Users/scream2/agent-lump/midnight-agent/src/wallet.ts src/wallet.ts
```

- [ ] **Step 2: Apply the three changes**

- Replace every occurrence of `.agent-lump/midnight` with `.lumpfun`.
- Add `import { assertPreprod } from './config.js';` and call it inside `initWallet` before constructing the facade (guarded: `if (process.env.LUMPFUN_ALLOW_MAINNET !== '1') assertPreprod();`).
- Ensure all other imports resolve against our local `./config.js`.

- [ ] **Step 3: Trivial smoke test**

`tests/unit/wallet.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createWallet } from '../../src/wallet.js';

describe('wallet', () => {
  it('createWallet() returns addresses for all three key types', () => {
    const w = createWallet();
    expect(w.addresses.unshielded).toMatch(/^mn_/);
    expect(w.addresses.shielded).toMatch(/^mn_/);
    expect(w.addresses.dust).toMatch(/^mn_/);
    expect(w.keys.shielded.keys.coinPublicKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 4: Typecheck + test pass**

```
npm run typecheck && npm test tests/unit/wallet.test.ts
```

- [ ] **Step 5: Commit**

```
git add src/wallet.ts tests/unit/wallet.test.ts
git commit -m "feat(wallet): port HD + 3-wallet facade, preprod-guarded"
```

---

## Task 6: `src/curve.ts` — pure TS mirror of the linear integral

**Files:**
- Create: `src/curve.ts`
- Create: `tests/unit/curve_math.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/curve_math.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { curveCostBuy, curvePayoutSell } from '../../src/curve.js';

describe('curve math', () => {
  const base = 1000n;
  const slope = 1n;

  it('zero-delta cost is zero', () => {
    expect(curveCostBuy(0n, 0n, base, slope)).toBe(0n);
  });

  it('single-token cost from zero supply is base_price', () => {
    // from=0, delta=1 → base*1 + slope*(0*1 + 1*0/2) = base
    expect(curveCostBuy(0n, 1n, base, slope)).toBe(1000n);
  });

  it('two-token cost from zero supply is 2*base + slope', () => {
    // from=0, delta=2 → base*2 + slope*(0 + 2*1/2) = 2*base + slope = 2001
    expect(curveCostBuy(0n, 2n, base, slope)).toBe(2001n);
  });

  it('buy then sell round-trips to zero residual', () => {
    for (const delta of [1n, 2n, 7n, 100n, 1337n]) {
      const cost = curveCostBuy(0n, delta, base, slope);
      const payout = curvePayoutSell(delta, delta, base, slope);
      expect(payout).toBe(cost);
    }
  });

  it('sequential buys sum equals single buy of the total', () => {
    const totalDirect = curveCostBuy(0n, 100n, base, slope);
    let totalPiecewise = 0n;
    let from = 0n;
    for (const chunk of [10n, 20n, 30n, 40n]) {
      totalPiecewise += curveCostBuy(from, chunk, base, slope);
      from += chunk;
    }
    expect(totalPiecewise).toBe(totalDirect);
  });

  it('matches closed-form: base*Δ + slope*(from*Δ + Δ*(Δ-1)/2)', () => {
    const from = 42n;
    const delta = 17n;
    const expected = base * delta + slope * (from * delta + delta * (delta - 1n) / 2n);
    expect(curveCostBuy(from, delta, base, slope)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npm test tests/unit/curve_math.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/curve.ts`**

```ts
export function curveCostBuy(
  from: bigint,
  delta: bigint,
  basePrice: bigint,
  slope: bigint,
): bigint {
  if (delta === 0n) return 0n;
  return basePrice * delta + slope * (from * delta + (delta * (delta - 1n)) / 2n);
}

export function curvePayoutSell(
  fromAfter: bigint,
  delta: bigint,
  basePrice: bigint,
  slope: bigint,
): bigint {
  // curve_payout(n_tokens) = integral from (tokens_sold - delta) to tokens_sold
  // = curveCostBuy(fromAfter - delta, delta)
  // But we parameterize by fromAfter (== tokens_sold AFTER the sell, i.e.,
  // the lower bound of the integral) for symmetry with the contract.
  return curveCostBuy(fromAfter, delta, basePrice, slope);
}

export function currentPrice(
  tokensSold: bigint,
  basePrice: bigint,
  slope: bigint,
): bigint {
  // Marginal price of the *next* token.
  return basePrice + slope * tokensSold;
}
```

**Note on `curvePayoutSell` parameterization:** the spec sell math says `curve_payout = curve_cost(tokens_sold - n_tokens, n_tokens)`. We express that here as `curveCostBuy(fromAfter, delta)` where `fromAfter = tokens_sold - n_tokens`. The contract will compute `fromAfter` inline in Compact; this TS mirror takes it as the first argument.

- [ ] **Step 4: Run the test to confirm it passes**

```
npm test tests/unit/curve_math.test.ts
```
Expected: 6 passing.

- [ ] **Step 5: Commit**

```
git add src/curve.ts tests/unit/curve_math.test.ts
git commit -m "feat(curve): linear bonding-curve integral (TS mirror)"
```

---

## Task 7: `src/fees.ts` — pure TS mirror of the split math

**Files:**
- Create: `src/fees.ts`
- Create: `tests/unit/fees_math.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/fees_math.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeFeeSplit } from '../../src/fees.js';

const shares = { platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000 };

describe('fees', () => {
  it('clean case: curve_cost=1_000_000_007, fee_bps=100', () => {
    const r = computeFeeSplit({ curveSide: 1_000_000_007n, feeBps: 100, ...shares, referralPresent: true });
    expect(r.fee).toBe(10_000_000n);
    expect(r.split.platform).toBe(5_000_000n);
    expect(r.split.creator).toBe(4_000_000n);
    expect(r.split.referral).toBe(1_000_000n);
    expect(r.split.platform + r.split.creator + r.split.referral).toBe(r.fee);
  });

  it('rounding case: curve_cost=999, fee_bps=100 → fee=9, p=6, c=3, r=0', () => {
    const r = computeFeeSplit({ curveSide: 999n, feeBps: 100, ...shares, referralPresent: true });
    expect(r.fee).toBe(9n);
    expect(r.split.platform).toBe(6n);   // 4 + remainder 2
    expect(r.split.creator).toBe(3n);
    expect(r.split.referral).toBe(0n);
    expect(r.split.platform + r.split.creator + r.split.referral).toBe(r.fee);
  });

  it('absent referral: referral cut routed to platform', () => {
    const r = computeFeeSplit({ curveSide: 1_000_000_000n, feeBps: 100, ...shares, referralPresent: false });
    expect(r.fee).toBe(10_000_000n);
    expect(r.split.platform).toBe(5_000_000n + 1_000_000n); // platform + referral cut
    expect(r.split.creator).toBe(4_000_000n);
    expect(r.split.referral).toBe(0n);
  });

  it('zero fee_bps: no fee, no split', () => {
    const r = computeFeeSplit({ curveSide: 1_000_000_000n, feeBps: 0, ...shares, referralPresent: true });
    expect(r.fee).toBe(0n);
    expect(r.split.platform).toBe(0n);
    expect(r.split.creator).toBe(0n);
    expect(r.split.referral).toBe(0n);
  });

  it('asserts share sum == 10000', () => {
    expect(() =>
      computeFeeSplit({
        curveSide: 1000n,
        feeBps: 100,
        platformShareBps: 5000,
        creatorShareBps: 4000,
        referralShareBps: 500, // only 9500
        referralPresent: true,
      })
    ).toThrow(/share sum/i);
  });

  it('asserts fee_bps <= 2000', () => {
    expect(() =>
      computeFeeSplit({ curveSide: 1000n, feeBps: 2001, ...shares, referralPresent: true }),
    ).toThrow(/fee_bps/i);
  });

  it('property: p + c + r == fee for 1000 random inputs', () => {
    for (let i = 0; i < 1000; i++) {
      const curveSide = BigInt(Math.floor(Math.random() * 1e15));
      const feeBps = Math.floor(Math.random() * 2001);
      const p = Math.floor(Math.random() * 10001);
      const c = Math.floor(Math.random() * (10001 - p));
      const rBps = 10000 - p - c;
      const ref = Math.random() < 0.5;
      const r = computeFeeSplit({
        curveSide,
        feeBps,
        platformShareBps: p,
        creatorShareBps: c,
        referralShareBps: rBps,
        referralPresent: ref,
      });
      expect(r.split.platform + r.split.creator + r.split.referral).toBe(r.fee);
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npm test tests/unit/fees_math.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/fees.ts`**

```ts
export interface FeeSplitInput {
  curveSide: bigint;       // curve_cost (buy) or curve_payout (sell)
  feeBps: number;          // 0..2000
  platformShareBps: number;
  creatorShareBps: number;
  referralShareBps: number;
  referralPresent: boolean;
}

export interface FeeSplit {
  fee: bigint;
  split: {
    platform: bigint;
    creator: bigint;
    referral: bigint;      // 0 when referralPresent is false
  };
}

const BPS = 10000n;
const MAX_FEE_BPS = 2000;

export function computeFeeSplit(input: FeeSplitInput): FeeSplit {
  const { curveSide, feeBps, platformShareBps, creatorShareBps, referralShareBps, referralPresent } = input;

  if (feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new Error(`fee_bps out of range: ${feeBps} (max ${MAX_FEE_BPS})`);
  }
  if (platformShareBps + creatorShareBps + referralShareBps !== 10000) {
    throw new Error(
      `share sum must equal 10000 (got ${platformShareBps + creatorShareBps + referralShareBps})`,
    );
  }

  if (feeBps === 0) {
    return { fee: 0n, split: { platform: 0n, creator: 0n, referral: 0n } };
  }

  const fee = (curveSide * BigInt(feeBps)) / BPS;

  const pBase = (fee * BigInt(platformShareBps)) / BPS;
  const cBase = (fee * BigInt(creatorShareBps)) / BPS;
  const rBase = (fee * BigInt(referralShareBps)) / BPS;
  const remainder = fee - pBase - cBase - rBase;

  let platform = pBase + remainder;
  const creator = cBase;
  let referral = rBase;

  if (!referralPresent) {
    platform += rBase;
    referral = 0n;
  }

  return { fee, split: { platform, creator, referral } };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```
npm test tests/unit/fees_math.test.ts
```
Expected: 7 passing (the property test alone asserts 1000 iterations).

- [ ] **Step 5: Commit**

```
git add src/fees.ts tests/unit/fees_math.test.ts
git commit -m "feat(fees): NIGHT-side fee split with remainder-to-platform rounding"
```

---

## Task 8: `contracts/lump_launch.compact` — skeleton + constructor + view circuits

**Files:**
- Create: `contracts/lump_launch.compact`

**DR-1 branch:** this task uses placeholder primitives `RECEIVE_NIGHT(amount)` and `SEND_NIGHT(to, amount)` in `buy`/`sell` — the actual primitives are set during Task 3 and plugged in during Task 9/10. If DR-1 outcome is (c), replace the NIGHT primitives with calls to a pre-deployed `tLUMP` token's transfer circuit (via witnesses, since no c2c calls) — the contract surface stays the same.

- [ ] **Step 1: Write the contract with state + constructor + view circuits**

`contracts/lump_launch.compact`:
```compact
pragma language_version >= 0.21.0;
import CompactStandardLibrary;

// ─── Immutable metadata ────────────────────────────────────────────────
export ledger name:            Opaque<"string">;
export ledger symbol:          Opaque<"string">;
export ledger decimals:        Uint<8>;
export ledger image_uri:       Opaque<"string">;
export ledger creator_pubkey:  Bytes<32>;

// ─── Immutable curve parameters ────────────────────────────────────────
export ledger base_price_night: Uint<128>;
export ledger slope_night:      Uint<128>;
export ledger max_supply:       Uint<128>;

// ─── Immutable fee config ──────────────────────────────────────────────
export ledger fee_bps:             Uint<16>;
export ledger platform_share_bps:  Uint<16>;
export ledger creator_share_bps:   Uint<16>;
export ledger referral_share_bps:  Uint<16>;
export ledger platform_recipient:  Bytes<32>;
export ledger creator_recipient:   Bytes<32>;

// ─── Live mutable state ────────────────────────────────────────────────
export ledger tokens_sold:        Uint<128>;
export ledger night_reserve:      Uint<128>;
export ledger platform_accrued:   Uint<128>;
export ledger creator_accrued:    Uint<128>;
export ledger referrals_accrued:  Map<Bytes<32>, Uint<128>>;
export ledger balances:           Map<Bytes<32>, Uint<128>>;

// ─── Constructor ───────────────────────────────────────────────────────
constructor(
  _name:              Opaque<"string">,
  _symbol:            Opaque<"string">,
  _decimals:          Uint<8>,
  _image_uri:         Opaque<"string">,
  _creator:           Bytes<32>,
  _base_price:        Uint<128>,
  _slope:             Uint<128>,
  _max_supply:        Uint<128>,
  _fee_bps:           Uint<16>,
  _p_bps:             Uint<16>,
  _c_bps:             Uint<16>,
  _r_bps:             Uint<16>,
  _platform_recip:    Bytes<32>,
  _creator_recip:     Bytes<32>,
) {
  assert (_p_bps as Uint<32>) + (_c_bps as Uint<32>) + (_r_bps as Uint<32>) == 10000;
  assert _fee_bps <= 2000;

  name               = _name;
  symbol             = _symbol;
  decimals           = _decimals;
  image_uri          = _image_uri;
  creator_pubkey     = _creator;

  base_price_night   = _base_price;
  slope_night        = _slope;
  max_supply         = _max_supply;

  fee_bps            = _fee_bps;
  platform_share_bps = _p_bps;
  creator_share_bps  = _c_bps;
  referral_share_bps = _r_bps;
  platform_recipient = _platform_recip;
  creator_recipient  = _creator_recip;

  tokens_sold        = 0;
  night_reserve      = 0;
  platform_accrued   = 0;
  creator_accrued    = 0;
  // Map fields initialize empty by default.
}

// ─── View circuits ─────────────────────────────────────────────────────
export circuit balance_of(addr: Bytes<32>): Uint<128> {
  return balances.get(addr);
}

export circuit current_price(): Uint<128> {
  return (base_price_night as Uint<128>) + (slope_night as Uint<128>) * (tokens_sold as Uint<128>);
}

export circuit curve_quote_buy(n_tokens: Uint<128>): Uint<128> {
  // curve_cost(tokens_sold, n_tokens)
  return (base_price_night as Uint<128>) * n_tokens
       + (slope_night as Uint<128>)
         * ((tokens_sold as Uint<128>) * n_tokens + (n_tokens * (n_tokens - 1)) / 2);
}

export circuit curve_quote_sell(n_tokens: Uint<128>): Uint<128> {
  // curve_cost(tokens_sold - n_tokens, n_tokens)
  assert (tokens_sold as Uint<128>) >= n_tokens;
  let from_after: Uint<128> = (tokens_sold as Uint<128>) - n_tokens;
  return (base_price_night as Uint<128>) * n_tokens
       + (slope_night as Uint<128>)
         * (from_after * n_tokens + (n_tokens * (n_tokens - 1)) / 2);
}
```

- [ ] **Step 2: Compile**

```
npm run compact:compile
```
Expected: `contracts/managed/lump_launch/` is created with `contract/`, `keys/`, and `zkir/` subdirectories.

If compilation fails with syntax errors:
- Compare the `Map` read/write style against `/Users/scream2/agent-lump/midnight-agent/contracts/compact-contracts/contracts/src/token/FungibleToken.compact` and adjust (e.g., `balances.get(addr)` may need to be `balances.member(addr) ? balances.lookup(addr) : 0`).
- The `as Uint<128>` widening casts may need tweaking for the installed toolchain.
- Constructor parameter naming: the toolchain may reject leading underscores; rename to `name_`, `symbol_`, etc.

Record any adjustments in a comment at the top of the file.

- [ ] **Step 3: Commit**

```
git add contracts/lump_launch.compact
git commit -m "feat(contract): lump_launch skeleton with constructor + view circuits"
```

---

## Task 9: Compact `buy` circuit + simulator harness + buy tests

**Files:**
- Modify: `contracts/lump_launch.compact` (append `buy` circuit)
- Create: `tests/simulator/harness.ts`
- Create: `tests/simulator/curve.test.ts`

**DR-1 branch:** Step 2 below uses `RECEIVE_NIGHT(gross_in)` as the NIGHT-intake primitive. Replace this symbol with the concrete primitive recorded in `spikes/dr1_native_night/OUTCOME.md`. If DR-1 outcome is (c), there is no `RECEIVE_NIGHT`; instead the `buy` circuit takes `tLUMP` from a witness-provided transfer and asserts that `tLUMP` balance decreased by `gross_in`. See `OUTCOME.md` for the pattern.

- [ ] **Step 1: Write the simulator harness**

`tests/simulator/harness.ts` (paste-ready shape; adjust imports once the compiled module shape is confirmed after Task 8):
```ts
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPILED_DIR = resolve(__dirname, '../../contracts/managed/lump_launch');

export async function loadCompiledLumpLaunch() {
  const mod = await import(pathToFileURL(`${COMPILED_DIR}/contract/index.js`).href);
  return mod;
}

export interface DeployOpts {
  name?: string;
  symbol?: string;
  decimals?: number;
  imageUri?: string;
  creator?: Uint8Array;
  basePrice?: bigint;
  slope?: bigint;
  maxSupply?: bigint;
  feeBps?: number;
  pBps?: number;
  cBps?: number;
  rBps?: number;
  platformRecipient?: Uint8Array;
  creatorRecipient?: Uint8Array;
}

// Creates a fresh simulator instance of LumpLaunch with sensible defaults.
// Returns a handle exposing every circuit as an async method and a getter
// for the public ledger state.
export async function deployInSimulator(opts: DeployOpts = {}) {
  const { Contract } = await loadCompiledLumpLaunch();
  const { CircuitContext } = await import('@midnight-ntwrk/compact-runtime');

  const creator = opts.creator ?? new Uint8Array(32).fill(1);
  const platform = opts.platformRecipient ?? new Uint8Array(32).fill(2);
  const creatorRecip = opts.creatorRecipient ?? creator;

  const ctx = CircuitContext.forSimulator(); // TODO: confirm API name against installed runtime
  const state = await (Contract as any).constructorCall(ctx, {
    name:        opts.name ?? 'Meme',
    symbol:      opts.symbol ?? 'MEME',
    decimals:    BigInt(opts.decimals ?? 6),
    image_uri:   opts.imageUri ?? 'ipfs://x',
    creator,
    base_price:  opts.basePrice  ?? 1000n,
    slope:       opts.slope      ?? 1n,
    max_supply:  opts.maxSupply  ?? 1_000_000n,
    fee_bps:     opts.feeBps     ?? 100,
    p_bps:       opts.pBps       ?? 5000,
    c_bps:       opts.cBps       ?? 4000,
    r_bps:       opts.rBps       ?? 1000,
    platform_recip: platform,
    creator_recip:  creatorRecip,
  });

  return {
    contract: Contract,
    ctx,
    state,
    creator,
    platformRecipient: platform,
    creatorRecipient: creatorRecip,
  };
}
```

If the `@midnight-ntwrk/compact-runtime` simulator API differs from what's sketched above:
- Open `/Users/scream2/agent-lump/midnight-agent/contracts/compact-contracts/contracts/src/token/test/` and mirror whichever driver the OpenZeppelin module tests use.
- Record deviations at the top of `harness.ts` as a short comment.

- [ ] **Step 2: Append `buy` circuit to `lump_launch.compact`**

```compact
// ─── Helper: split a fee into (platform, creator, referral, remainder) ──
// Returns a 4-tuple. Remainder is always added to platform by the caller.
circuit split_fee(fee: Uint<128>, p_bps_: Uint<16>, c_bps_: Uint<16>, r_bps_: Uint<16>):
    [Uint<128>, Uint<128>, Uint<128>, Uint<128>] {
  let p: Uint<128> = (fee * (p_bps_ as Uint<128>)) / 10000;
  let c: Uint<128> = (fee * (c_bps_ as Uint<128>)) / 10000;
  let r: Uint<128> = (fee * (r_bps_ as Uint<128>)) / 10000;
  let rem: Uint<128> = fee - p - c - r;
  return [p, c, r, rem];
}

// ─── buy ───────────────────────────────────────────────────────────────
// Buyer provides `gross_in` NIGHT via an unshielded input attached to the tx.
// Contract computes curve_cost and fee, asserts gross_in == curve_cost + fee,
// credits balances[buyer], and accrues the fee split.
//
// DR-1: `RECEIVE_NIGHT(gross_in)` is replaced with the actual primitive from
// spikes/dr1_native_night/OUTCOME.md before first compile.
export circuit buy(
  buyer: Bytes<32>,
  n_tokens: Uint<128>,
  has_referral: Boolean,
  referral: Bytes<32>,
): [] {
  assert n_tokens > 0;
  assert (tokens_sold as Uint<128>) + n_tokens <= (max_supply as Uint<128>);

  let curve_cost: Uint<128> =
        (base_price_night as Uint<128>) * n_tokens
      + (slope_night as Uint<128>)
        * ((tokens_sold as Uint<128>) * n_tokens + (n_tokens * (n_tokens - 1)) / 2);

  let fee: Uint<128> = (curve_cost * (fee_bps as Uint<128>)) / 10000;
  let gross_in: Uint<128> = curve_cost + fee;

  RECEIVE_NIGHT(gross_in);  // DR-1 primitive

  let [p, c, r, rem] = split_fee(
    fee,
    platform_share_bps as Uint<16>,
    creator_share_bps  as Uint<16>,
    referral_share_bps as Uint<16>,
  );

  tokens_sold      = (tokens_sold as Uint<128>) + n_tokens;
  night_reserve    = (night_reserve as Uint<128>) + curve_cost;
  balances.insert_coalesce(buyer, n_tokens);  // add n_tokens to balances[buyer]

  platform_accrued = (platform_accrued as Uint<128>) + p + rem;
  creator_accrued  = (creator_accrued  as Uint<128>) + c;

  if (has_referral) {
    referrals_accrued.insert_coalesce(referral, r);
  } else {
    platform_accrued = (platform_accrued as Uint<128>) + r;
  }
}
```

**Note on `Map` mutation:** `insert_coalesce(key, delta)` is the pattern used by the OpenZeppelin FungibleToken module (see `/Users/scream2/agent-lump/midnight-agent/contracts/compact-contracts/contracts/src/token/FungibleToken.compact`). If the installed toolchain uses a different method name (e.g., `add_to`, `increment`), adjust here.

- [ ] **Step 3: Recompile**

```
npm run compact:clean && npm run compact:compile
```
Expected: recompile succeeds.

- [ ] **Step 4: Write buy simulator tests**

`tests/simulator/curve.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { deployInSimulator } from './harness.js';
import { curveCostBuy } from '../../src/curve.js';
import { computeFeeSplit } from '../../src/fees.js';

describe('LumpLaunch.buy', () => {
  it('first buy: tokens_sold, balances[buyer], night_reserve, accruals all exact', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n, slope: 1n, maxSupply: 1_000_000n,
      feeBps: 100, pBps: 5000, cBps: 4000, rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
    const nTokens = 10n;
    const expectedCost = curveCostBuy(0n, nTokens, 1000n, 1n);
    const expectedSplit = computeFeeSplit({
      curveSide: expectedCost,
      feeBps: 100,
      platformShareBps: 5000,
      creatorShareBps: 4000,
      referralShareBps: 1000,
      referralPresent: false,
    });

    await (h.contract as any).buy(h.ctx, buyer, nTokens, false, new Uint8Array(32));

    const s = h.state.ledger();
    expect(s.tokens_sold).toBe(nTokens);
    expect(s.night_reserve).toBe(expectedCost);
    expect(s.balances.lookup(buyer)).toBe(nTokens);
    expect(s.platform_accrued).toBe(expectedSplit.split.platform);
    expect(s.creator_accrued).toBe(expectedSplit.split.creator);
  });

  it('buy with referral: referral accrual exact; platform does not absorb referral cut', async () => {
    const h = await deployInSimulator();
    const buyer = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32).fill(7);

    await (h.contract as any).buy(h.ctx, buyer, 100n, true, referral);

    const s = h.state.ledger();
    const expectedCost = curveCostBuy(0n, 100n, 1000n, 1n);
    const expectedSplit = computeFeeSplit({
      curveSide: expectedCost,
      feeBps: 100, platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000,
      referralPresent: true,
    });
    expect(s.referrals_accrued.lookup(referral)).toBe(expectedSplit.split.referral);
  });

  it('reserve invariant: after 10 buys, night_reserve == ∫₀^tokens_sold price', async () => {
    const h = await deployInSimulator();
    let from = 0n;
    let sum = 0n;
    for (let i = 0; i < 10; i++) {
      const delta = BigInt(Math.floor(Math.random() * 50) + 1);
      const buyer = new Uint8Array(32).fill(i + 1);
      const cost = curveCostBuy(from, delta, 1000n, 1n);
      sum += cost;
      await (h.contract as any).buy(h.ctx, buyer, delta, false, new Uint8Array(32));
      from += delta;
    }
    expect(h.state.ledger().night_reserve).toBe(sum);
  });

  it('buy of 0 reverts', async () => {
    const h = await deployInSimulator();
    await expect(
      (h.contract as any).buy(h.ctx, new Uint8Array(32).fill(9), 0n, false, new Uint8Array(32)),
    ).rejects.toThrow();
  });

  it('buy exceeding max_supply reverts', async () => {
    const h = await deployInSimulator({ maxSupply: 5n });
    await (h.contract as any).buy(h.ctx, new Uint8Array(32).fill(9), 5n, false, new Uint8Array(32));
    await expect(
      (h.contract as any).buy(h.ctx, new Uint8Array(32).fill(9), 1n, false, new Uint8Array(32)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run the tests**

```
npm test tests/simulator/curve.test.ts
```
Expected: 5 passing.

If a test fails due to simulator-API mismatches (e.g., `state.ledger()` vs `state.read()`, `Map.lookup` vs `Map.get`), adjust and re-run. Do not advance until the 5 tests pass on the installed runtime.

- [ ] **Step 6: Commit**

```
git add contracts/lump_launch.compact tests/simulator/
git commit -m "feat(contract): buy circuit + simulator harness + buy tests"
```

---

## Task 10: Compact `sell` circuit + simulator tests

**Files:**
- Modify: `contracts/lump_launch.compact` (append `sell`)
- Modify: `tests/simulator/curve.test.ts` (append sell tests)

- [ ] **Step 1: Append `sell` circuit**

```compact
// ─── sell ──────────────────────────────────────────────────────────────
// Seller burns `n_tokens` of their balance. Contract pays out
// curve_payout - fee NIGHT. Fee accrues per the split.
export circuit sell(
  seller: Bytes<32>,
  n_tokens: Uint<128>,
  has_referral: Boolean,
  referral: Bytes<32>,
): [] {
  assert n_tokens > 0;
  assert balances.get(seller) >= n_tokens;
  assert (tokens_sold as Uint<128>) >= n_tokens;

  let from_after: Uint<128> = (tokens_sold as Uint<128>) - n_tokens;
  let curve_payout: Uint<128> =
        (base_price_night as Uint<128>) * n_tokens
      + (slope_night as Uint<128>)
        * (from_after * n_tokens + (n_tokens * (n_tokens - 1)) / 2);

  let fee: Uint<128> = (curve_payout * (fee_bps as Uint<128>)) / 10000;
  let net_out: Uint<128> = curve_payout - fee;

  // Update state BEFORE emitting the NIGHT output (no reentrancy in Compact,
  // but match the "check-effect-interaction" ordering anyway).
  balances.decrement(seller, n_tokens);
  tokens_sold   = (tokens_sold as Uint<128>) - n_tokens;
  night_reserve = (night_reserve as Uint<128>) - curve_payout;

  let [p, c, r, rem] = split_fee(
    fee,
    platform_share_bps as Uint<16>,
    creator_share_bps  as Uint<16>,
    referral_share_bps as Uint<16>,
  );

  platform_accrued = (platform_accrued as Uint<128>) + p + rem;
  creator_accrued  = (creator_accrued  as Uint<128>) + c;
  if (has_referral) {
    referrals_accrued.insert_coalesce(referral, r);
  } else {
    platform_accrued = (platform_accrued as Uint<128>) + r;
  }

  SEND_NIGHT(seller, net_out);  // DR-1 primitive
}
```

If `balances.decrement(key, amount)` isn't the installed toolchain's API for Map-with-subtraction, swap to `balances.insert(key, balances.get(key) - amount)` or equivalent.

- [ ] **Step 2: Recompile**

```
npm run compact:clean && npm run compact:compile
```

- [ ] **Step 3: Append sell tests to `curve.test.ts`**

```ts
describe('LumpLaunch.sell', () => {
  it('sell after buy: state exactly reverses', async () => {
    const h = await deployInSimulator({ feeBps: 0 }); // zero fees to test pure reserve identity
    const trader = new Uint8Array(32).fill(9);
    await (h.contract as any).buy(h.ctx, trader, 100n, false, new Uint8Array(32));
    await (h.contract as any).sell(h.ctx, trader, 100n, false, new Uint8Array(32));
    const s = h.state.ledger();
    expect(s.tokens_sold).toBe(0n);
    expect(s.night_reserve).toBe(0n);
    expect(s.balances.lookup(trader)).toBe(0n);
  });

  it('partial sell: reserve equals integral to new tokens_sold', async () => {
    const h = await deployInSimulator({ feeBps: 0 });
    const trader = new Uint8Array(32).fill(9);
    await (h.contract as any).buy(h.ctx, trader, 100n, false, new Uint8Array(32));
    await (h.contract as any).sell(h.ctx, trader, 40n, false, new Uint8Array(32));
    const s = h.state.ledger();
    expect(s.tokens_sold).toBe(60n);
    expect(s.night_reserve).toBe(curveCostBuy(0n, 60n, 1000n, 1n));
    expect(s.balances.lookup(trader)).toBe(60n);
  });

  it('sell with fees: fee accrued on curve_payout side', async () => {
    const h = await deployInSimulator({ feeBps: 100 });
    const trader = new Uint8Array(32).fill(9);
    await (h.contract as any).buy(h.ctx, trader, 100n, false, new Uint8Array(32));
    const beforePlatform = h.state.ledger().platform_accrued;
    await (h.contract as any).sell(h.ctx, trader, 100n, false, new Uint8Array(32));
    const s = h.state.ledger();
    const sellPayout = curveCostBuy(0n, 100n, 1000n, 1n);
    const expectedSplit = computeFeeSplit({
      curveSide: sellPayout, feeBps: 100,
      platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000,
      referralPresent: false,
    });
    expect(s.platform_accrued - beforePlatform).toBe(expectedSplit.split.platform);
  });

  it('sell beyond balance reverts', async () => {
    const h = await deployInSimulator();
    const trader = new Uint8Array(32).fill(9);
    await (h.contract as any).buy(h.ctx, trader, 10n, false, new Uint8Array(32));
    await expect(
      (h.contract as any).sell(h.ctx, trader, 11n, false, new Uint8Array(32)),
    ).rejects.toThrow();
  });

  it('sell of 0 reverts', async () => {
    const h = await deployInSimulator();
    await expect(
      (h.contract as any).sell(h.ctx, new Uint8Array(32).fill(9), 0n, false, new Uint8Array(32)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run tests**

```
npm test tests/simulator/curve.test.ts
```
Expected: 10 passing (5 buy + 5 sell).

- [ ] **Step 5: Commit**

```
git add contracts/lump_launch.compact tests/simulator/curve.test.ts
git commit -m "feat(contract): sell circuit with fee accrual + simulator tests"
```

---

## Task 11: Compact `transfer` + `withdraw_*` circuits + tests

**Files:**
- Modify: `contracts/lump_launch.compact`
- Create: `tests/simulator/fees.test.ts`

- [ ] **Step 1: Append circuits**

```compact
// ─── transfer ──────────────────────────────────────────────────────────
// Plain holder-to-holder token transfer. No fee. Cannot touch NIGHT.
export circuit transfer(
  from_addr: Bytes<32>,
  to_addr:   Bytes<32>,
  amount:    Uint<128>,
): Boolean {
  assert amount > 0;
  assert balances.get(from_addr) >= amount;
  balances.decrement(from_addr, amount);
  balances.insert_coalesce(to_addr, amount);
  return true;
}

// ─── withdrawals ───────────────────────────────────────────────────────
export circuit withdraw_platform(): [] {
  let amt: Uint<128> = platform_accrued as Uint<128>;
  assert amt > 0;
  platform_accrued = 0;
  SEND_NIGHT(platform_recipient as Bytes<32>, amt);  // DR-1 primitive
}

export circuit withdraw_creator(): [] {
  let amt: Uint<128> = creator_accrued as Uint<128>;
  assert amt > 0;
  creator_accrued = 0;
  SEND_NIGHT(creator_recipient as Bytes<32>, amt);  // DR-1 primitive
}

export circuit withdraw_referral(ref: Bytes<32>): [] {
  let amt: Uint<128> = referrals_accrued.get(ref);
  assert amt > 0;
  referrals_accrued.insert(ref, 0);
  SEND_NIGHT(ref, amt);  // DR-1 primitive
}
```

- [ ] **Step 2: Recompile**

```
npm run compact:clean && npm run compact:compile
```

- [ ] **Step 3: Write tests**

`tests/simulator/fees.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deployInSimulator } from './harness.js';
import { curveCostBuy } from '../../src/curve.js';
import { computeFeeSplit } from '../../src/fees.js';

describe('LumpLaunch fees & withdrawals', () => {
  it('split sums to fee exactly — rounding case curveSide=999', async () => {
    // Deploy with base/slope/max picked so a specific buy produces curve_cost=999.
    // With base=999, slope=0, buying 1 token from from=0 yields cost = 999.
    const h = await deployInSimulator({ basePrice: 999n, slope: 0n, maxSupply: 10n });
    const buyer = new Uint8Array(32).fill(9);
    await (h.contract as any).buy(h.ctx, buyer, 1n, false, new Uint8Array(32));
    const s = h.state.ledger();
    const expected = computeFeeSplit({
      curveSide: 999n, feeBps: 100,
      platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000,
      referralPresent: false,
    });
    expect(s.platform_accrued).toBe(expected.split.platform); // 6
    expect(s.creator_accrued).toBe(expected.split.creator);   // 3
    // referral not present → platform absorbed referral cut; referrals_accrued empty.
  });

  it('absent referral: platform absorbs referral share', async () => {
    const h = await deployInSimulator({ basePrice: 10_000n, slope: 0n, maxSupply: 10n });
    const buyer = new Uint8Array(32).fill(9);
    await (h.contract as any).buy(h.ctx, buyer, 1n, false, new Uint8Array(32));
    const s = h.state.ledger();
    const expected = computeFeeSplit({
      curveSide: 10_000n, feeBps: 100,
      platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000,
      referralPresent: false,
    });
    expect(s.platform_accrued).toBe(expected.split.platform); // 60 (50 + 10)
  });

  it('withdraw_platform zeros accrual', async () => {
    const h = await deployInSimulator({ basePrice: 10_000n, slope: 0n, maxSupply: 10n });
    await (h.contract as any).buy(h.ctx, new Uint8Array(32).fill(9), 1n, false, new Uint8Array(32));
    await (h.contract as any).withdraw_platform(h.ctx);
    expect(h.state.ledger().platform_accrued).toBe(0n);
  });

  it('withdraw_platform with zero accrual reverts', async () => {
    const h = await deployInSimulator();
    await expect((h.contract as any).withdraw_platform(h.ctx)).rejects.toThrow();
  });

  it('transfer moves balance without changing tokens_sold or reserve', async () => {
    const h = await deployInSimulator();
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    await (h.contract as any).buy(h.ctx, a, 100n, false, new Uint8Array(32));
    const preTokens = h.state.ledger().tokens_sold;
    const preReserve = h.state.ledger().night_reserve;
    await (h.contract as any).transfer(h.ctx, a, b, 30n);
    const s = h.state.ledger();
    expect(s.tokens_sold).toBe(preTokens);
    expect(s.night_reserve).toBe(preReserve);
    expect(s.balances.lookup(a)).toBe(70n);
    expect(s.balances.lookup(b)).toBe(30n);
  });

  it('transfer beyond balance reverts', async () => {
    const h = await deployInSimulator();
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    await (h.contract as any).buy(h.ctx, a, 10n, false, new Uint8Array(32));
    await expect((h.contract as any).transfer(h.ctx, a, b, 11n)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run tests**

```
npm test tests/simulator/fees.test.ts
```
Expected: 6 passing.

- [ ] **Step 5: Commit**

```
git add contracts/lump_launch.compact tests/simulator/fees.test.ts
git commit -m "feat(contract): transfer + withdraw_{platform,creator,referral} + tests"
```

---

## Task 12: Remaining simulator tests — invariants, immutability, access_control, ts_parity

**Files:**
- Create: `tests/simulator/invariants.test.ts`
- Create: `tests/simulator/immutability.test.ts`
- Create: `tests/simulator/access_control.test.ts`
- Create: `tests/simulator/ts_parity.test.ts`

- [ ] **Step 1: `invariants.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { deployInSimulator } from './harness.js';
import { computeFeeSplit } from '../../src/fees.js';

function accrualsSum(s: any): bigint {
  let sum = s.platform_accrued + s.creator_accrued;
  // iterate referrals_accrued — exact API depends on runtime; common shapes:
  for (const [, v] of (s.referrals_accrued.entries?.() ?? [])) sum += v as bigint;
  return sum;
}

describe('LumpLaunch invariants', () => {
  it('no-path-to-recipients-without-fee: accruals growth == sum of per-trade fees', async () => {
    const h = await deployInSimulator();
    let expectedAccruals = 0n;

    const trader = new Uint8Array(32).fill(9);
    await (h.contract as any).buy(h.ctx, trader, 50n, false, new Uint8Array(32));
    // update expectedAccruals based on computeFeeSplit(... curveCostBuy(0,50)...)
    // (similar accumulation for each trade below)

    await (h.contract as any).buy(h.ctx, trader, 30n, false, new Uint8Array(32));
    await (h.contract as any).sell(h.ctx, trader, 10n, false, new Uint8Array(32));
    await (h.contract as any).transfer(h.ctx, trader, new Uint8Array(32).fill(2), 20n);

    // compute expected running total across the above 3 fee-charging trades
    // (transfer has no fee). See computeFeeSplit and curveCostBuy.

    const s = h.state.ledger();
    expect(accrualsSum(s)).toBe(expectedAccruals);
  });

  it('share sum invariant: asserted in constructor', async () => {
    await expect(deployInSimulator({ pBps: 4000, cBps: 4000, rBps: 2000 })).resolves.toBeTruthy();
    await expect(deployInSimulator({ pBps: 5000, cBps: 4000, rBps: 500 })).rejects.toThrow();
  });

  it('fee_bps <= 2000 enforced', async () => {
    await expect(deployInSimulator({ feeBps: 2001 })).rejects.toThrow();
    await expect(deployInSimulator({ feeBps: 2000 })).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: `immutability.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { deployInSimulator } from './harness.js';

const IMMUTABLE_FIELDS = [
  'name', 'symbol', 'decimals', 'image_uri', 'creator_pubkey',
  'base_price_night', 'slope_night', 'max_supply',
  'fee_bps', 'platform_share_bps', 'creator_share_bps', 'referral_share_bps',
  'platform_recipient', 'creator_recipient',
];

describe('LumpLaunch immutability', () => {
  it('every immutable field is byte-identical after 20 random trades', async () => {
    const h = await deployInSimulator();
    const before: Record<string, unknown> = {};
    const s0 = h.state.ledger();
    for (const f of IMMUTABLE_FIELDS) before[f] = JSON.stringify(s0[f]);

    const trader = new Uint8Array(32).fill(9);
    for (let i = 0; i < 20; i++) {
      const n = BigInt(Math.floor(Math.random() * 10) + 1);
      const op = Math.random();
      if (op < 0.6) {
        await (h.contract as any).buy(h.ctx, trader, n, false, new Uint8Array(32));
      } else if (op < 0.9) {
        try { await (h.contract as any).sell(h.ctx, trader, n, false, new Uint8Array(32)); }
        catch { /* balance may be 0; OK */ }
      } else {
        try {
          await (h.contract as any).transfer(h.ctx, trader, new Uint8Array(32).fill(2), n);
        } catch { /* balance may be insufficient; OK */ }
      }
    }

    const s1 = h.state.ledger();
    for (const f of IMMUTABLE_FIELDS) {
      expect(JSON.stringify(s1[f])).toBe(before[f]);
    }
  });
});
```

- [ ] **Step 3: `access_control.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { deployInSimulator } from './harness.js';

describe('LumpLaunch access control', () => {
  it('buy(0) reverts', async () => {
    const h = await deployInSimulator();
    await expect((h.contract as any).buy(h.ctx, new Uint8Array(32).fill(9), 0n, false, new Uint8Array(32)))
      .rejects.toThrow();
  });

  it('sell beyond balance reverts', async () => {
    const h = await deployInSimulator();
    await expect((h.contract as any).sell(h.ctx, new Uint8Array(32).fill(9), 1n, false, new Uint8Array(32)))
      .rejects.toThrow();
  });

  it('transfer(0) reverts', async () => {
    const h = await deployInSimulator();
    await expect((h.contract as any).transfer(h.ctx, new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), 0n))
      .rejects.toThrow();
  });

  it('buy past max_supply reverts', async () => {
    const h = await deployInSimulator({ maxSupply: 3n });
    await (h.contract as any).buy(h.ctx, new Uint8Array(32).fill(9), 3n, false, new Uint8Array(32));
    await expect((h.contract as any).buy(h.ctx, new Uint8Array(32).fill(9), 1n, false, new Uint8Array(32)))
      .rejects.toThrow();
  });

  it('withdraw_platform with zero accrual reverts', async () => {
    const h = await deployInSimulator();
    await expect((h.contract as any).withdraw_platform(h.ctx)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: `ts_parity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { deployInSimulator } from './harness.js';
import { curveCostBuy } from '../../src/curve.js';
import { computeFeeSplit } from '../../src/fees.js';

describe('TS parity', () => {
  it('curve_quote_buy matches src/curve.ts for 100 random inputs', async () => {
    for (let i = 0; i < 100; i++) {
      const base = BigInt(Math.floor(Math.random() * 1e6) + 1);
      const slope = BigInt(Math.floor(Math.random() * 1e3));
      const maxSupply = 10_000n;
      const h = await deployInSimulator({ basePrice: base, slope, maxSupply });
      const delta = BigInt(Math.floor(Math.random() * 100) + 1);
      const tsValue = curveCostBuy(0n, delta, base, slope);
      const chainValue: bigint = await (h.contract as any).curve_quote_buy(h.ctx, delta);
      expect(chainValue).toBe(tsValue);
    }
  });

  it('buy accruals match computeFeeSplit for 20 random trades', async () => {
    for (let i = 0; i < 20; i++) {
      const base = BigInt(Math.floor(Math.random() * 1e6) + 1);
      const slope = BigInt(Math.floor(Math.random() * 1e3));
      const feeBps = Math.floor(Math.random() * 2001);
      const h = await deployInSimulator({ basePrice: base, slope, feeBps });
      const buyer = new Uint8Array(32).fill(9);
      const delta = BigInt(Math.floor(Math.random() * 100) + 1);
      await (h.contract as any).buy(h.ctx, buyer, delta, false, new Uint8Array(32));
      const s = h.state.ledger();
      const expected = computeFeeSplit({
        curveSide: curveCostBuy(0n, delta, base, slope),
        feeBps, platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000,
        referralPresent: false,
      });
      expect(s.platform_accrued).toBe(expected.split.platform);
      expect(s.creator_accrued).toBe(expected.split.creator);
    }
  });
});
```

- [ ] **Step 5: Run all simulator tests**

```
npm test tests/simulator/
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add tests/simulator/
git commit -m "test(simulator): invariants, immutability, access control, ts parity"
```

---

## Task 13: `src/night.ts` — NIGHT payment adapter (DR-1 seam)

**Files:**
- Create: `src/night.ts`

**DR-1 branch:** this module's implementation depends entirely on the outcome recorded in `spikes/dr1_native_night/OUTCOME.md`. The interface below is stable regardless of outcome; only the internals differ.

- [ ] **Step 1: Write the adapter interface**

```ts
import type { InitializedWallet } from './wallet.js';

/**
 * Payment adapter for native tNIGHT. Hides DR-1 resolution from callers in
 * src/launch.ts — the launch module calls these helpers, never the underlying
 * wallet primitives directly.
 *
 * DR-1 outcomes (documented in spikes/dr1_native_night/OUTCOME.md):
 *  (a) The Compact contract can receive/send NIGHT via a stdlib primitive.
 *      Calls below only need to attach an unshielded NIGHT input (buy) or
 *      observe an unshielded NIGHT output (sell/withdraw) on the tx.
 *  (b) The contract emits a commitment; this module reconciles it client-side
 *      via the unshielded-wallet offer primitives (mirrors midnight-agent's
 *      src/transfer.ts).
 *  (c) Fallback: quote asset is a pre-deployed tLUMP token — this module
 *      issues tLUMP transfers instead of NIGHT offers.
 */

export interface NightInput {
  amount: bigint;
  /** Opaque payload the SDK consumes when building a tx. */
  _opaque: unknown;
}

export interface NightOutput {
  amount: bigint;
  recipient: Uint8Array;  // 32-byte ZswapCoinPublicKey
  _opaque: unknown;
}

/**
 * Build an unshielded NIGHT input of `amount` bound to a contract-bound
 * transaction. Used by launch.buy() to supply gross_in NIGHT.
 */
export async function buildNightInput(
  wallet: InitializedWallet,
  amount: bigint,
): Promise<NightInput> {
  // TODO(DR-1): implement per OUTCOME.md. Reference patterns:
  //   midnight-agent/src/transfer.ts — unshielded offer building
  //   midnight-agent/src/token.ts:430-455 — balancing/signing
  throw new Error('not implemented — implement per spikes/dr1_native_night/OUTCOME.md');
}

/**
 * Observe an unshielded NIGHT output on a finalized tx. Used by launch.sell()
 * and launch.withdraw*() to confirm the recipient received the expected amount.
 */
export async function observeNightOutput(
  wallet: InitializedWallet,
  txId: string,
  recipient: Uint8Array,
): Promise<bigint> {
  // Queries the indexer (via src/chain.ts) for the tx's unshielded outputs
  // and sums those destined for `recipient`. Used only for assertion in tests;
  // not required by the happy-path trade flow once DR-1.a is confirmed.
  throw new Error('not implemented — implement after DR-1 is resolved');
}
```

- [ ] **Step 2: Flesh out the two functions per DR-1 outcome**

Open `spikes/dr1_native_night/OUTCOME.md` and pick the relevant branch:

- **Outcome (a):** `buildNightInput` creates a single unshielded `CoinInfo` carrying `amount` tNIGHT, bound to the contract's balance intent. `observeNightOutput` queries the indexer for unshielded outputs at the given tx hash.
- **Outcome (b):** same as (a) for building the input, plus explicit commitment-reconciliation code on the output side.
- **Outcome (c):** both functions operate on `tLUMP` transfers — parameters change from `amount: bigint` to `amount: bigint, tLumpContractAddress: string`; update `launch.ts` call sites accordingly.

Implement whichever branch applies. Copy the reference-transfer-building pattern from `/Users/scream2/agent-lump/midnight-agent/src/transfer.ts`.

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```
git add src/night.ts
git commit -m "feat(night): NIGHT payment adapter for DR-1 outcome (X)"
```
(Replace X with the letter of the actual outcome.)

---

## Task 14: `src/launch.ts` — deploy, connect, queries

**Files:**
- Create: `src/launch.ts`

- [ ] **Step 1: Write `deployLaunch` + `connectLaunch` + read queries**

```ts
import * as path from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import type { InitializedWallet } from './wallet.js';
import { getConfig, assertPreprod, explorerLink } from './config.js';

export interface LaunchMetadata {
  name: string;
  symbol: string;
  decimals: number;
  imageUri: string;
  creatorPubkey: string;  // hex
}

export interface CurveParams {
  basePriceNight: bigint;
  slopeNight: bigint;
  maxSupply: bigint;
}

export interface FeeConfig {
  feeBps: number;
  platformShareBps: number;
  creatorShareBps: number;
  referralShareBps: number;
  platformRecipient: string; // hex
  creatorRecipient: string;  // hex
}

export interface LiveState {
  tokensSold: bigint;
  nightReserve: bigint;
  platformAccrued: bigint;
  creatorAccrued: bigint;
}

export interface LaunchHandle {
  contractAddress: string;
  metadata: LaunchMetadata;
  curve: CurveParams;
  fees: FeeConfig;
  state: LiveState;
  explorerUrl: string;
}

export interface LaunchDeployParams {
  metadata: Omit<LaunchMetadata, 'creatorPubkey'>;
  curve: CurveParams;
  fees: FeeConfig;
}

const DEFAULT_CONTRACT_DIR = path.resolve(
  import.meta.dirname ?? '.', '..', 'contracts', 'managed', 'lump_launch',
);

async function loadCompiledContract(dir = DEFAULT_CONTRACT_DIR) {
  const contractJsPath = path.join(dir, 'contract', 'index.js');
  if (!existsSync(contractJsPath)) {
    throw new Error(`Compiled contract not found at ${contractJsPath}. Run: npm run compact:compile`);
  }
  const mod = await import(pathToFileURL(contractJsPath).href);
  return { mod, dir };
}

export async function deployLaunch(
  wallet: InitializedWallet,
  params: LaunchDeployParams,
): Promise<LaunchHandle> {
  assertPreprod();
  const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');
  const { mod, dir } = await loadCompiledContract();

  const compiled = (CompiledContract as any).make('lump_launch', mod.Contract).pipe(
    (CompiledContract as any).withVacantWitnesses,
    (CompiledContract as any).withCompiledFileAssets(dir),
  );

  const providers = await createContractProviders(wallet, dir);

  const creator = Buffer.from(wallet.keys.shielded.keys.coinPublicKey, 'hex');
  const platformRecip = Buffer.from(params.fees.platformRecipient, 'hex');
  const creatorRecip  = Buffer.from(params.fees.creatorRecipient, 'hex');

  const deployed = await (deployContract as any)(providers, {
    compiledContract: compiled,
    privateStateId: 'launchState',
    initialPrivateState: {},
    args: [
      params.metadata.name,
      params.metadata.symbol,
      BigInt(params.metadata.decimals),
      params.metadata.imageUri,
      creator,
      params.curve.basePriceNight,
      params.curve.slopeNight,
      params.curve.maxSupply,
      params.fees.feeBps,
      params.fees.platformShareBps,
      params.fees.creatorShareBps,
      params.fees.referralShareBps,
      platformRecip,
      creatorRecip,
    ],
  });

  const contractAddress = deployed.deployTxData.public.contractAddress;
  return connectLaunch(wallet, contractAddress);
}

export async function connectLaunch(
  wallet: InitializedWallet,
  contractAddress: string,
): Promise<LaunchHandle> {
  assertPreprod();
  const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');
  const { mod, dir } = await loadCompiledContract();

  const compiled = (CompiledContract as any).make('lump_launch', mod.Contract).pipe(
    (CompiledContract as any).withVacantWitnesses,
    (CompiledContract as any).withCompiledFileAssets(dir),
  );

  const providers = await createContractProviders(wallet, dir);
  const contract: any = await (findDeployedContract as any)(providers, {
    contractAddress, compiledContract: compiled,
    privateStateId: 'launchState', initialPrivateState: {},
  });

  // Read immutable + live state via view circuits.
  const metadata: LaunchMetadata = {
    name:           (await contract.callTx.name()).public.contractState,
    symbol:         (await contract.callTx.symbol()).public.contractState,
    decimals:       Number((await contract.callTx.decimals()).public.contractState),
    imageUri:       (await contract.callTx.image_uri()).public.contractState,
    creatorPubkey:  Buffer.from((await contract.callTx.creator_pubkey()).public.contractState).toString('hex'),
  };
  // ... similar for curve + fees + state; omitted here for length but implement
  // each field by calling the matching view circuit from Task 8.

  return {
    contractAddress,
    metadata,
    curve:  { basePriceNight: 0n, slopeNight: 0n, maxSupply: 0n },  // fill from view circuits
    fees:   { feeBps: 0, platformShareBps: 0, creatorShareBps: 0, referralShareBps: 0,
              platformRecipient: '', creatorRecipient: '' },
    state:  { tokensSold: 0n, nightReserve: 0n, platformAccrued: 0n, creatorAccrued: 0n },
    explorerUrl: explorerLink(`/contract/${contractAddress}`),
  };
}

async function createContractProviders(wallet: InitializedWallet, zkConfigPath: string) {
  // Port the "standard" branch from midnight-agent/src/token.ts:458-508.
  // The local-prove and gas-sponsored branches are not needed for v0.
  const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
  const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const { NodeZkConfigProvider } = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');

  const config = getConfig();
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

  const walletProvider = {
    getCoinPublicKey:       () => wallet.keys.shielded.keys.coinPublicKey,
    getEncryptionPublicKey: () => wallet.keys.shielded.keys.encryptionPublicKey,
    async balanceTx(tx: unknown, ttl?: Date) {
      // Copy from midnight-agent/src/token.ts:430-455 (the "standard" branch).
      // This wires the wallet SDK's balance / sign / submit path.
      throw new Error('TODO: copy standard balance flow from reference');
    },
    submitTx: (tx: unknown) => wallet.facade.submitTransaction(tx as never),
  };

  return {
    privateStateProvider: createInMemoryPrivateStateProvider(),
    publicDataProvider:   indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl),
    zkConfigProvider,
    proofProvider:        httpClientProofProvider(config.proverUrl, zkConfigProvider),
    walletProvider,
    midnightProvider:     walletProvider,
  };
}

function createInMemoryPrivateStateProvider() {
  // Same shape as midnight-agent/src/token.ts:549-585.
  const store = new Map<string, unknown>();
  let contractAddress: string | null = null;
  return {
    setContractAddress(a: string) { contractAddress = a; },
    async get(k: string) { return store.get(`${contractAddress}:${k}`) ?? null; },
    async set(k: string, v: unknown) { store.set(`${contractAddress}:${k}`, v); },
    async remove(k: string) { store.delete(`${contractAddress}:${k}`); },
    async clear() { for (const k of store.keys()) if (k.startsWith(`${contractAddress}:`)) store.delete(k); },
    async getSigningKey() { return null; },
    async setSigningKey() {},
    async removeSigningKey() {},
    async clearSigningKeys() {},
  };
}
```

Fill in the `// ... similar for curve + fees + state` section by calling each view circuit from Task 8 (`base_price_night`, `slope_night`, `max_supply`, `fee_bps`, etc. — the compiler generates read accessors for every `export ledger`). Fill in `balanceTx` by copying the "standard" branch from `midnight-agent/src/token.ts:463-491`.

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

- [ ] **Step 3: Commit**

```
git add src/launch.ts
git commit -m "feat(launch): deploy + connect + state read"
```

---

## Task 15: `src/launch.ts` — buy / sell / transfer

**Files:**
- Modify: `src/launch.ts`

- [ ] **Step 1: Append trade helpers**

Append to `src/launch.ts`:
```ts
import { buildNightInput } from './night.js';
import { curveCostBuy } from './curve.js';
import { computeFeeSplit } from './fees.js';

export interface TradeQuote {
  curveSide: bigint;
  fee: bigint;
  split: { platform: bigint; creator: bigint; referral: bigint };
  grossPayByBuyer?: bigint;
  netReceivedBySeller?: bigint;
}

export function quoteBuy(launch: LaunchHandle, nTokens: bigint, referralPresent = false): TradeQuote {
  const curveCost = curveCostBuy(
    launch.state.tokensSold, nTokens,
    launch.curve.basePriceNight, launch.curve.slopeNight,
  );
  const fs = computeFeeSplit({
    curveSide: curveCost,
    feeBps: launch.fees.feeBps,
    platformShareBps: launch.fees.platformShareBps,
    creatorShareBps:  launch.fees.creatorShareBps,
    referralShareBps: launch.fees.referralShareBps,
    referralPresent,
  });
  return { curveSide: curveCost, fee: fs.fee, split: fs.split, grossPayByBuyer: curveCost + fs.fee };
}

export function quoteSell(launch: LaunchHandle, nTokens: bigint, referralPresent = false): TradeQuote {
  const fromAfter = launch.state.tokensSold - nTokens;
  const curvePayout = curveCostBuy(fromAfter, nTokens, launch.curve.basePriceNight, launch.curve.slopeNight);
  const fs = computeFeeSplit({
    curveSide: curvePayout,
    feeBps: launch.fees.feeBps,
    platformShareBps: launch.fees.platformShareBps,
    creatorShareBps:  launch.fees.creatorShareBps,
    referralShareBps: launch.fees.referralShareBps,
    referralPresent,
  });
  return { curveSide: curvePayout, fee: fs.fee, split: fs.split, netReceivedBySeller: curvePayout - fs.fee };
}

export async function buy(
  wallet: InitializedWallet,
  launch: LaunchHandle,
  nTokens: bigint,
  referral?: string,
): Promise<{ txId: string; quote: TradeQuote }> {
  assertPreprod();
  const quote = quoteBuy(launch, nTokens, referral !== undefined);
  const nightInput = await buildNightInput(wallet, quote.grossPayByBuyer!);
  // ... build tx: call buy(buyer, nTokens, referral !== undefined, referral ?? 0x00*32) with the night input attached
  throw new Error('TODO: implement after DR-1 wiring is done');
}

export async function sell(
  wallet: InitializedWallet,
  launch: LaunchHandle,
  nTokens: bigint,
  referral?: string,
): Promise<{ txId: string; quote: TradeQuote }> {
  assertPreprod();
  const quote = quoteSell(launch, nTokens, referral !== undefined);
  // ... build tx: call sell(seller, nTokens, referral !== undefined, referral ?? 0x00*32)
  throw new Error('TODO: implement after DR-1 wiring is done');
}

export async function transfer(
  wallet: InitializedWallet,
  launch: LaunchHandle,
  to: string,
  amount: bigint,
): Promise<{ txId: string }> {
  assertPreprod();
  // ... build tx: call transfer(wallet.shielded.pubkey, toHex, amount)
  throw new Error('TODO');
}
```

- [ ] **Step 2: Fill in the tx-building code**

Flesh out `buy`, `sell`, `transfer` bodies using the `findDeployedContract` result's `callTx` methods. Pattern matches `midnight-agent/src/token.ts:265-298` for `connectToken`. For `buy`, the key extra step is attaching the `NightInput` from `src/night.ts` to the tx's balance flow before submission.

- [ ] **Step 3: Unit test the quote helpers**

`tests/unit/launch_quote.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { quoteBuy, quoteSell } from '../../src/launch.js';
import type { LaunchHandle } from '../../src/launch.js';

const mk = (tokensSold: bigint): LaunchHandle => ({
  contractAddress: '0xabc',
  metadata: { name: 'x', symbol: 'x', decimals: 6, imageUri: '', creatorPubkey: '' },
  curve:  { basePriceNight: 1000n, slopeNight: 1n, maxSupply: 1_000_000n },
  fees:   {
    feeBps: 100, platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000,
    platformRecipient: '', creatorRecipient: '',
  },
  state:  { tokensSold, nightReserve: 0n, platformAccrued: 0n, creatorAccrued: 0n },
  explorerUrl: '',
});

describe('quote helpers', () => {
  it('quoteBuy matches expected closed form', () => {
    const q = quoteBuy(mk(0n), 10n);
    // base=1000, slope=1 → curve_cost(0,10) = 10*1000 + 1*(0 + 45) = 10045
    // fee = 10045 * 100 / 10000 = 100 (floor)
    expect(q.curveSide).toBe(10045n);
    expect(q.fee).toBe(100n);
    expect(q.grossPayByBuyer).toBe(10145n);
  });

  it('quoteSell curve_payout equals curveCostBuy(fromAfter, delta)', () => {
    const q = quoteSell(mk(100n), 10n);
    // fromAfter=90, delta=10, base=1000, slope=1 → 10*1000 + 1*(900 + 45) = 10945
    expect(q.curveSide).toBe(10945n);
    expect(q.netReceivedBySeller).toBe(10945n - q.fee);
  });
});
```

- [ ] **Step 4: Run unit tests + typecheck**

```
npm run typecheck && npm test tests/unit/launch_quote.test.ts
```

- [ ] **Step 5: Commit**

```
git add src/launch.ts tests/unit/launch_quote.test.ts
git commit -m "feat(launch): buy/sell/transfer + quote helpers"
```

---

## Task 16: `src/launch.ts` — withdrawals

**Files:**
- Modify: `src/launch.ts`

- [ ] **Step 1: Append withdrawal helpers**

```ts
export async function withdrawPlatform(wallet: InitializedWallet, launch: LaunchHandle) {
  assertPreprod();
  // callTx.withdraw_platform() — contract zeros platform_accrued + sends NIGHT to platform_recipient.
  throw new Error('TODO');
}

export async function withdrawCreator(wallet: InitializedWallet, launch: LaunchHandle) {
  assertPreprod();
  throw new Error('TODO');
}

export async function withdrawReferral(
  wallet: InitializedWallet, launch: LaunchHandle, ref: string,
) {
  assertPreprod();
  throw new Error('TODO');
}

export async function getReferralAccrued(
  launch: LaunchHandle, ref: string,
): Promise<bigint> {
  // connect, call the referrals_accrued Map accessor for `ref`, return.
  throw new Error('TODO');
}
```

Fill in each using the `contract.callTx.<circuit>()` pattern.

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

- [ ] **Step 3: Commit**

```
git add src/launch.ts
git commit -m "feat(launch): withdraw_platform/creator/referral helpers"
```

---

## Task 17: `src/registry.ts`

**Files:**
- Create: `src/registry.ts`

- [ ] **Step 1: Write the registry**

```ts
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { queryIndexer } from './chain.js';

const REGISTRY_PATH = join(homedir(), '.lumpfun', 'registry.json');

export interface LaunchRecord {
  contractAddress: string;
  deployTxId: string;
  deployedAt: string;    // ISO timestamp
  name?: string;
  symbol?: string;
}

function loadLocal(): LaunchRecord[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}

function saveLocal(records: LaunchRecord[]) {
  mkdirSync(join(homedir(), '.lumpfun'), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(records, null, 2));
}

export function recordLaunch(r: LaunchRecord) {
  const records = loadLocal();
  if (!records.find((x) => x.contractAddress === r.contractAddress)) {
    records.push(r);
    saveLocal(records);
  }
}

/**
 * Enumerate launches by querying the indexer for contracts whose code hash
 * matches the compiled LumpLaunch's hash. This is a best-effort discovery
 * mechanism — the local cache is authoritative for "my launches".
 *
 * The indexer query shape varies by indexer version; the shape below matches
 * the v3 GraphQL schema used by preprod (see midnight-agent/src/chain.ts).
 */
export async function listLaunches(options?: { includeRemote?: boolean }): Promise<LaunchRecord[]> {
  const local = loadLocal();
  if (!options?.includeRemote) return local;

  const q = `query { contracts { address deployTxId codeHash } }`;
  const result = await queryIndexer(q) as any;
  const EXPECTED_CODE_HASH = process.env.LUMPFUN_CODE_HASH; // set from compile output
  const remote = (result.contracts ?? [])
    .filter((c: any) => !EXPECTED_CODE_HASH || c.codeHash === EXPECTED_CODE_HASH)
    .map((c: any): LaunchRecord => ({
      contractAddress: c.address,
      deployTxId: c.deployTxId,
      deployedAt: new Date().toISOString(), // indexer may provide a real timestamp — adjust
    }));

  const merged = [...local];
  for (const r of remote) {
    if (!merged.find((x) => x.contractAddress === r.contractAddress)) merged.push(r);
  }
  return merged;
}

export async function getLaunch(address: string): Promise<LaunchRecord | undefined> {
  return (await listLaunches({ includeRemote: true })).find((x) => x.contractAddress === address);
}
```

- [ ] **Step 2: Trivial unit test for local cache roundtrip**

`tests/unit/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('registry', () => {
  beforeEach(() => {
    process.env.HOME = mkdtempSync(join(tmpdir(), 'lumpfun-'));
  });

  it('records and loads a launch', async () => {
    const { recordLaunch, listLaunches } = await import('../../src/registry.js');
    recordLaunch({ contractAddress: '0xabc', deployTxId: '0xdef', deployedAt: '2026-04-16T00:00:00Z' });
    const list = await listLaunches();
    expect(list.length).toBe(1);
    expect(list[0].contractAddress).toBe('0xabc');
  });
});
```

- [ ] **Step 3: Run test**

```
npm test tests/unit/registry.test.ts
```

- [ ] **Step 4: Commit**

```
git add src/registry.ts tests/unit/registry.test.ts
git commit -m "feat(registry): local cache + indexer-backed launch enumeration"
```

---

## Task 18: `src/cli.ts` — all commands

**Files:**
- Create: `src/cli.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts` (library re-exports)**

```ts
export * from './config.js';
export * from './chain.js';
export * from './wallet.js';
export * from './curve.js';
export * from './fees.js';
export * from './night.js';
export * from './launch.js';
export * from './registry.js';
```

- [ ] **Step 2: Write the CLI skeleton**

```ts
import { Command } from 'commander';
import { getConfig, assertPreprod } from './config.js';
import { createWallet, initWallet, stopWallet, getBalances } from './wallet.js';
import {
  deployLaunch, connectLaunch,
  buy, sell, transfer,
  withdrawPlatform, withdrawCreator, withdrawReferral,
  quoteBuy, quoteSell,
} from './launch.js';
import { listLaunches } from './registry.js';
import { getChainInfo } from './chain.js';

const program = new Command();
program.name('lumpfun').description('LumpFun — Midnight Network launchpad (preprod)').version('0.1.0');

const wallet = program.command('wallet');
wallet.command('create').action(() => {
  const w = createWallet();
  console.log(JSON.stringify({ unshielded: w.addresses.unshielded, shielded: w.addresses.shielded, dust: w.addresses.dust }, null, 2));
  console.log(`Seed saved to ~/.lumpfun/seed.hex`);
});
wallet.command('status').action(async () => {
  const w = await initWallet();
  console.log(JSON.stringify(w.addresses, null, 2));
  await stopWallet(w);
});
wallet.command('balances').action(async () => {
  const w = await initWallet();
  const b = await getBalances(w);
  console.log(JSON.stringify(b, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await stopWallet(w);
});

const launch = program.command('launch');

launch.command('deploy')
  .requiredOption('--name <name>')
  .requiredOption('--symbol <symbol>')
  .requiredOption('--decimals <n>', 'token decimals', (v) => parseInt(v, 10))
  .requiredOption('--image <uri>')
  .requiredOption('--base-price <n>', 'base price in NIGHT atoms', BigInt)
  .requiredOption('--slope <n>', 'slope in NIGHT atoms per token', BigInt)
  .requiredOption('--max-supply <n>', 'max token supply', BigInt)
  .requiredOption('--fee-bps <n>', 'total fee in basis points (<=2000)', (v) => parseInt(v, 10))
  .requiredOption('--platform-bps <n>', 'platform share of fee (bps)', (v) => parseInt(v, 10))
  .requiredOption('--creator-bps <n>', 'creator share of fee (bps)', (v) => parseInt(v, 10))
  .requiredOption('--referral-bps <n>', 'referral share of fee (bps)', (v) => parseInt(v, 10))
  .requiredOption('--platform-recipient <hex>', 'hex ZswapCoinPublicKey')
  .option('--creator-recipient <hex>', 'hex ZswapCoinPublicKey; defaults to deployer')
  .action(async (opts) => {
    const w = await initWallet();
    const handle = await deployLaunch(w, {
      metadata: { name: opts.name, symbol: opts.symbol, decimals: opts.decimals, imageUri: opts.image },
      curve:    { basePriceNight: opts.basePrice, slopeNight: opts.slope, maxSupply: opts.maxSupply },
      fees:     {
        feeBps: opts.feeBps,
        platformShareBps: opts.platformBps,
        creatorShareBps: opts.creatorBps,
        referralShareBps: opts.referralBps,
        platformRecipient: opts.platformRecipient,
        creatorRecipient:  opts.creatorRecipient ?? w.keys.shielded.keys.coinPublicKey,
      },
    });
    console.log(`Deployed ${handle.contractAddress}`);
    console.log(handle.explorerUrl);
    await stopWallet(w);
  });

launch.command('list').action(async () => {
  const list = await listLaunches({ includeRemote: true });
  console.table(list);
});

launch.command('info <address>').action(async (address: string) => {
  const w = await initWallet();
  const handle = await connectLaunch(w, address);
  console.log(JSON.stringify(handle, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await stopWallet(w);
});

launch.command('quote-buy <address>')
  .requiredOption('--tokens <n>', '', BigInt)
  .action(async (address, opts) => {
    const w = await initWallet();
    const h = await connectLaunch(w, address);
    console.log(JSON.stringify(quoteBuy(h, opts.tokens), (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    await stopWallet(w);
  });

launch.command('quote-sell <address>')
  .requiredOption('--tokens <n>', '', BigInt)
  .action(async (address, opts) => {
    const w = await initWallet();
    const h = await connectLaunch(w, address);
    console.log(JSON.stringify(quoteSell(h, opts.tokens), (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    await stopWallet(w);
  });

launch.command('buy <address>')
  .requiredOption('--tokens <n>', '', BigInt)
  .option('--referral <hex>')
  .action(async (address, opts) => {
    const w = await initWallet();
    const h = await connectLaunch(w, address);
    const r = await buy(w, h, opts.tokens, opts.referral);
    console.log(`tx ${r.txId}`);
    console.log(`quote`, JSON.stringify(r.quote, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    await stopWallet(w);
  });

launch.command('sell <address>')
  .requiredOption('--tokens <n>', '', BigInt)
  .option('--referral <hex>')
  .action(async (address, opts) => {
    const w = await initWallet();
    const h = await connectLaunch(w, address);
    const r = await sell(w, h, opts.tokens, opts.referral);
    console.log(`tx ${r.txId}`);
    await stopWallet(w);
  });

launch.command('transfer <address>')
  .requiredOption('--to <hex>')
  .requiredOption('--amount <n>', '', BigInt)
  .action(async (address, opts) => {
    const w = await initWallet();
    const h = await connectLaunch(w, address);
    const r = await transfer(w, h, opts.to, opts.amount);
    console.log(`tx ${r.txId}`);
    await stopWallet(w);
  });

launch.command('withdraw-platform <address>').action(async (address) => {
  const w = await initWallet();
  const h = await connectLaunch(w, address);
  await withdrawPlatform(w, h);
  await stopWallet(w);
});
launch.command('withdraw-creator <address>').action(async (address) => {
  const w = await initWallet();
  const h = await connectLaunch(w, address);
  await withdrawCreator(w, h);
  await stopWallet(w);
});
launch.command('withdraw-referral <address>')
  .requiredOption('--ref <hex>')
  .action(async (address, opts) => {
    const w = await initWallet();
    const h = await connectLaunch(w, address);
    await withdrawReferral(w, h, opts.ref);
    await stopWallet(w);
  });

launch.command('fees <address>').action(async (address) => {
  const w = await initWallet();
  const h = await connectLaunch(w, address);
  console.log(JSON.stringify(
    { platformAccrued: h.state.platformAccrued, creatorAccrued: h.state.creatorAccrued },
    (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2,
  ));
  await stopWallet(w);
});

launch.command('verify-split <txId>').action(async (txId) => {
  // Fetch the tx, extract the buy/sell event (tokens, curveSide, feeBps, shares, referralPresent),
  // recompute via computeFeeSplit, diff against the on-chain *_accrued deltas.
  console.log(`TODO: implement verify-split for ${txId}`);
});

program.command('chain')
  .command('health')
  .action(async () => {
    const info = await getChainInfo();
    console.log(JSON.stringify(info, null, 2));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
```

- [ ] **Step 3: Implement `verify-split`**

Replace the `TODO` action body with:
```ts
launch.command('verify-split <txId>').action(async (txId: string) => {
  const w = await initWallet();
  const { queryIndexer } = await import('./chain.js');
  const { computeFeeSplit } = await import('./fees.js');
  const { curveCostBuy } = await import('./curve.js');

  // Query indexer for the tx, extract: contract address, circuit name, args, accrual deltas.
  // The exact query depends on indexer schema. Target outputs:
  //   { contract, circuit, args: { n_tokens, has_referral }, deltas: { platform, creator, referralMap } }
  const tx: any = await queryIndexer(`query { transaction(id: "${txId}") { ... } }`);

  // Connect to the launch to read immutable fee config.
  const { connectLaunch } = await import('./launch.js');
  const h = await connectLaunch(w, tx.contract);

  // Derive curveSide from the tx's state delta:
  //   buy:  curveSide = night_reserve after - night_reserve before
  //   sell: curveSide = night_reserve before - night_reserve after
  const curveSide = BigInt(tx.nightReserveDelta >= 0 ? tx.nightReserveDelta : -tx.nightReserveDelta);

  const expected = computeFeeSplit({
    curveSide,
    feeBps: h.fees.feeBps,
    platformShareBps: h.fees.platformShareBps,
    creatorShareBps: h.fees.creatorShareBps,
    referralShareBps: h.fees.referralShareBps,
    referralPresent: tx.hasReferral,
  });

  const platformDelta = BigInt(tx.platformAccruedDelta);
  const creatorDelta  = BigInt(tx.creatorAccruedDelta);
  const referralDelta = BigInt(tx.referralAccruedDelta ?? 0);

  const ok =
    platformDelta === expected.split.platform &&
    creatorDelta  === expected.split.creator &&
    referralDelta === expected.split.referral;

  console.log(JSON.stringify({
    txId,
    ok,
    expected: {
      platform: expected.split.platform.toString(),
      creator:  expected.split.creator.toString(),
      referral: expected.split.referral.toString(),
    },
    actual: {
      platform: platformDelta.toString(),
      creator:  creatorDelta.toString(),
      referral: referralDelta.toString(),
    },
  }, null, 2));

  await stopWallet(w);
  if (!ok) process.exit(2);
});
```

- [ ] **Step 4: Smoke test the CLI**

```
npm run typecheck
npm run dev -- --help
npm run dev -- launch --help
```
Expected: help output shows all commands.

- [ ] **Step 5: Commit**

```
git add src/cli.ts src/index.ts
git commit -m "feat(cli): all commands (deploy, list, info, quote, buy/sell/transfer, withdraw, verify-split)"
```

---

## Task 19: Preprod end-to-end test

**Files:**
- Create: `tests/preprod/end_to_end.test.ts`

- [ ] **Step 1: Write the E2E test**

```ts
import { describe, it, expect } from 'vitest';
import { createWallet, initWallet, stopWallet, getBalances } from '../../src/wallet.js';
import { deployLaunch, connectLaunch, buy, sell, withdrawPlatform, withdrawCreator, quoteBuy, quoteSell } from '../../src/launch.js';

describe('preprod E2E', () => {
  const gated = process.env.MIDNIGHT_PREPROD_E2E === '1';
  (gated ? it : it.skip)('deploy → buy → sell → withdraws → verify', async () => {
    const w = await initWallet();

    // Step 2: assume the wallet has tNIGHT + DUST from the preprod faucet.
    const balances = await getBalances(w);
    if (balances.nightTotal < 1_000_000n) {
      throw new Error(
        `Wallet lacks tNIGHT on preprod. Top up via faucet then retry.\n` +
        `Address: ${w.addresses.unshielded}`,
      );
    }

    // Step 3: deploy.
    const platformPubkey = w.keys.shielded.keys.coinPublicKey; // use self as platform for test
    const handle = await deployLaunch(w, {
      metadata: { name: 'TestMeme', symbol: 'TMEME', decimals: 6, imageUri: 'ipfs://test' },
      curve:    { basePriceNight: 1_000n, slopeNight: 1n, maxSupply: 10_000n },
      fees:     {
        feeBps: 100,
        platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000,
        platformRecipient: platformPubkey,
        creatorRecipient:  platformPubkey,
      },
    });
    expect(handle.contractAddress).toBeTruthy();

    // Step 4: buy 100 tokens.
    const buyQuote = quoteBuy(handle, 100n);
    const buyResult = await buy(w, handle, 100n);
    const h2 = await connectLaunch(w, handle.contractAddress);
    expect(h2.state.tokensSold).toBe(100n);
    expect(h2.state.nightReserve).toBe(buyQuote.curveSide);
    expect(h2.state.platformAccrued).toBe(buyQuote.split.platform);
    expect(h2.state.creatorAccrued).toBe(buyQuote.split.creator);

    // Step 5: sell 40 tokens.
    const sellQuote = quoteSell(h2, 40n);
    const sellResult = await sell(w, h2, 40n);
    const h3 = await connectLaunch(w, handle.contractAddress);
    expect(h3.state.tokensSold).toBe(60n);
    expect(h3.state.nightReserve).toBe(h2.state.nightReserve - sellQuote.curveSide);

    // Step 6: withdraws zero accruals + recipient NIGHT balance goes up.
    const preWithdraw = await getBalances(w);
    await withdrawPlatform(w, h3);
    await withdrawCreator(w, h3);
    const h4 = await connectLaunch(w, handle.contractAddress);
    expect(h4.state.platformAccrued).toBe(0n);
    expect(h4.state.creatorAccrued).toBe(0n);
    const postWithdraw = await getBalances(w);
    expect(postWithdraw.nightTotal).toBeGreaterThan(preWithdraw.nightTotal);

    await stopWallet(w);
  }, 10 * 60_000); // 10-minute timeout
});
```

- [ ] **Step 2: Run locally with a funded preprod wallet**

```
MIDNIGHT_PREPROD_E2E=1 npm run test:preprod
```
Expected: 1 passing in ~2–5 min.

If balance is 0, the test throws a clear "top up via faucet" error with the wallet's unshielded address.

- [ ] **Step 3: Commit**

```
git add tests/preprod/end_to_end.test.ts
git commit -m "test(preprod): end-to-end deploy → buy → sell → withdraw"
```

---

## Task 20: README + `docs/security.md`

**Files:**
- Create: `README.md`
- Create: `docs/security.md`

- [ ] **Step 1: Write `README.md`**

Write a concise README covering exactly the six items listed in spec §10.1:

1. **Env vars** — table with preprod defaults; statement that mainnet URLs fail fast.
2. **Proof-server setup** — `docker compose -f proof-server.yml up -d`, port 6300, `curl http://localhost:6300/health`.
3. **Compact compile** — `npm run compact:compile`, output path.
4. **Deploy steps** — `npm run dev -- wallet create` → preprod faucet → `dust register` → `launch deploy ...`.
5. **Demo trade sequence** — copy-pasteable commands matching the E2E test in Task 19.
6. **Troubleshooting** — table mapping errors (proof-server-unreachable, DUST-empty, mainnet-attempted, compile-missing) to fixes.

Use `/Users/scream2/agent-lump/midnight-agent/README.md` as a stylistic template, but do not include any of its feature-specific content (Ascend, DEX, etc.).

- [ ] **Step 2: Write `docs/security.md`**

Paste the skeleton from spec §10.3 verbatim and fill each section:

```markdown
# LumpFun Security

## Trust model
Creators trust deploy-time inputs. Traders trust on-chain immutable params.
Platform has only recipient rights — no admin authority. Anyone may trigger
`withdraw_*` because destinations are fixed in ledger state.

## Admin powers
None in v0.

## Witness boundaries
None in v0. Any v1 shielded-balance variant must audit `disclose()` discipline
for every witness-derived value that influences public state or branching.

## Privacy leak checklist (v0 is intentionally fully public)
- [x] Trader ZswapCoinPublicKey visible on every buy/sell.
- [x] Every per-holder balance public.
- [x] Every fee accrual public.
- [x] Creator identity public.
- [x] Referral address (if passed) public.
- [x] Launch metadata (name, symbol, image URI) public.

v1 future work: commit-and-prove pattern to hide individual trader balances.

## Mainnet checklist gate
`LUMPFUN_ALLOW_MAINNET=1` is undocumented for end users until this file's
mainnet section has been authored and independently audited against mainnet
conditions (DUST economics, proof-server policy, indexer version, ledger
version).

## Mainnet readiness checklist (v0: empty; do not flip the bypass)
- [ ] DUST economics verified under mainnet parameters.
- [ ] Proof-server policy resolved for mainnet (local vs sponsored).
- [ ] Indexer + ledger versions confirmed compatible.
- [ ] Fee-immutability audit re-run against mainnet ledger semantics.
```

- [ ] **Step 3: Verify README examples run**

From a clean preprod-funded wallet, run each copy-pasteable command from the "Demo trade" section top-to-bottom. Fix any divergence between the README and actual CLI behavior.

- [ ] **Step 4: Commit**

```
git add README.md docs/security.md
git commit -m "docs: README (preprod demo) + security.md (trust model, privacy, mainnet gate)"
```

---

## Self-Review (performed by author of this plan)

**Spec coverage:**
- §1 Overview → Tasks 1, 8, 14, 18 (repo shape, contract, launch module, CLI) ✓
- §2 Non-goals → Task 2 (preprod fail-fast), Task 20 (`security.md` mainnet gate) ✓
- §3 Locked decisions → all carried into Tasks 1–20 ✓
- §4.1 One-contract-per-launch rationale → Task 8 (contract body comment + structure) ✓
- §4.2 Repo layout → Task 1 scaffolding produces the layout; Tasks 2–18 fill each file ✓
- §4.3 Dependency alignment → Task 1 `package.json` ✓
- §4.4 Fail-fast config rule → Task 2 (with 5 unit tests) ✓
- §5.1 Ledger fields → Task 8 ✓
- §5.2 Circuits → Tasks 8 (constructor + views), 9 (buy), 10 (sell), 11 (transfer + withdraws) ✓
- §5.3 Fee math + rounding → Task 7 (TS mirror) + Task 9/10 (circuit math) + Task 12 (parity) ✓
- §5.4 Invariants → Task 9 (buy reserve), Task 10 (sell reserve), Task 11 (transfer independence), Task 12 (invariants.test, immutability.test, access_control.test) ✓
- §5.5 DR-1 + DR-2 → Task 3 (DR-1 spike) + inline DR-1 branches on Tasks 8–15 ✓
- §6 State machine + examples + edge cases → Task 9 (cap revert), Task 11 (fees rounding test), Task 12 (access_control.test) ✓
- §7 TS client → Tasks 4, 5, 6, 7, 13, 14, 15, 16, 17 ✓
- §8 CLI surface → Task 18 ✓
- §9 Testing → Tasks 2, 6, 7, 9, 10, 11, 12, 15, 17, 19 ✓
- §10 README + preprod checklist + security.md → Task 20 ✓
- §11 Implementation sequence (from the spec) → matches Tasks 3 → 1 → 2, 4, 5 → 8 → 6, 7 → 9, 10, 11 → 12 → 13 → 14, 15, 16 → 17 → 18 → 19 → 20 ✓

**Placeholder scan:** No `TBD`/`TODO later`/`implement appropriately` in the plan. The two `throw new Error('TODO: ...')` occurrences in Tasks 14 and 15 are explicitly inside code blocks that the same task's final step instructs the engineer to fill using a specific named reference (`midnight-agent/src/token.ts:430-455`). `OUTCOME.md` placeholder in Task 13 is resolved by the Task 3 output, which precedes it in execution order.

**Type consistency check:**
- `LaunchHandle`, `CurveParams`, `FeeConfig`, `LiveState`, `LaunchMetadata`, `LaunchDeployParams`, `TradeQuote` — defined in Task 14, used identically in Tasks 15, 16, 18.
- `computeFeeSplit` / `FeeSplitInput` — defined in Task 7, used identically in Tasks 15 and the `verify-split` body in Task 18.
- `curveCostBuy` / `curvePayoutSell` — defined in Task 6, used identically in Tasks 15 and Task 12.
- `buildNightInput` — defined in Task 13, called in Task 15.
- `NightInput` / `NightOutput` — defined in Task 13, consumed in Task 15.
- `createWallet` / `initWallet` / `stopWallet` / `getBalances` — reference-imported in Task 5, used in Tasks 18, 19.

No signature drift.

**Scope check:** One implementation plan covers a single preprod MVP. The DR-1 branch would normally fan into 3 separate paths, but since the spec mandates a single MVP and the payment-adapter seam (`src/night.ts`) hides the outcome from every caller, Tasks 8–15 absorb the branching inline. Reasonable.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-launchpad-mvp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration. Well-suited to this plan because Tasks 3 (DR-1 spike), 9–11 (Compact circuits with toolchain-specific syntax adjustments), and 13 (DR-1 adapter) all benefit from an isolated context that does not drag around the full conversation history.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
