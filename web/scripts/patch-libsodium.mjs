// libsodium-wrappers-sumo's ESM build (.mjs) has a broken relative import:
//   import e from "./libsodium-sumo.mjs"
// The referenced file isn't shipped — only `libsodium-wrappers.mjs` exists in
// modules-sumo-esm/. The actual sumo ESM module lives in the sibling package
// `libsodium-sumo`. Copy it into place so Lucid Evolution can load on Node.
//
// Runs automatically via `postinstall`. Idempotent — no-op if already patched.
import { existsSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const target = resolve('node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs');
const source = resolve('node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs');

if (!existsSync(source)) {
  console.warn('[patch-libsodium] source not found — skip:', source);
  process.exit(0);
}

if (existsSync(target)) {
  // Don't re-copy if already a real file with similar size.
  const tStat = statSync(target);
  const sStat = statSync(source);
  if (!tStat.isSymbolicLink() && Math.abs(tStat.size - sStat.size) < 1024) {
    process.exit(0);
  }
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log('[patch-libsodium] copied libsodium-sumo.mjs into libsodium-wrappers-sumo dist');
