/**
 * Midnight wallet — server-side address derivation only.
 *
 * Mirrors the derivation slice of /src/wallet.ts in the CLI. Loads the seed
 * once per process and derives the three preprod addresses (unshielded /
 * shielded / dust) using BIP-32/CIP-1852. No indexer sync, no WebSocket, no
 * proof server — those layers live in later phases.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { type AccountKey, HDWallet, type Role, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import {
  MidnightBech32m,
  UnshieldedAddress,
  ShieldedAddress,
  DustAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

export type NetworkId = 'mainnet' | 'preprod' | 'preview';

export interface WalletAddresses {
  unshielded: string;
  shielded: string;
  dust: string;
}

export interface WalletInfo {
  networkId: NetworkId;
  addresses: WalletAddresses;
  seedPath: string;
}

function deriveRoleKey(accountKey: AccountKey, role: Role, addressIndex = 0): Buffer {
  const result = accountKey.selectRole(role).deriveKeyAt(addressIndex);
  if (result.type === 'keyDerived') return Buffer.from(result.key);
  return deriveRoleKey(accountKey, role, addressIndex + 1);
}

function deriveAddresses(seed: Uint8Array, networkId: NetworkId): WalletAddresses {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error(`HD derivation failed: ${hd.type}`);
  const account = hd.hdWallet.selectAccount(0);

  const shieldedSeed = deriveRoleKey(account, Roles.Zswap);
  const dustSeed = deriveRoleKey(account, Roles.Dust);
  const unshieldedKey = deriveRoleKey(account, Roles.NightExternal);

  hd.hdWallet.clear();

  const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(shieldedSeed);
  const dustKey = ledger.DustSecretKey.fromSeed(dustSeed);

  const verifyingKey = ledger.signatureVerifyingKey(unshieldedKey.toString('hex'));
  const unshieldedAddr = new UnshieldedAddress(
    Buffer.from(ledger.addressFromKey(verifyingKey), 'hex'),
  );

  const shieldedAddr = new ShieldedAddress(
    new ShieldedCoinPublicKey(Buffer.from(shieldedKeys.coinPublicKey, 'hex')),
    new ShieldedEncryptionPublicKey(Buffer.from(shieldedKeys.encryptionPublicKey, 'hex')),
  );

  const dustAddr = new DustAddress(dustKey.publicKey);

  return {
    unshielded: MidnightBech32m.encode(networkId, unshieldedAddr).toString(),
    shielded: MidnightBech32m.encode(networkId, shieldedAddr).toString(),
    dust: MidnightBech32m.encode(networkId, dustAddr).toString(),
  };
}

function loadSeed(walletDir: string): Buffer {
  const envSeed = process.env.MIDNIGHT_WALLET_SEED;
  if (envSeed) return Buffer.from(envSeed, 'hex');

  const seedPath = join(walletDir, 'seed.hex');
  if (!existsSync(seedPath)) {
    throw new Error(
      `No wallet seed found at ${seedPath}. Set MIDNIGHT_WALLET_SEED or MIDNIGHT_WALLET_DIR.`,
    );
  }
  return Buffer.from(readFileSync(seedPath, 'utf-8').trim(), 'hex');
}

function resolveNetworkId(): NetworkId {
  const raw = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  if (raw !== 'mainnet' && raw !== 'preprod' && raw !== 'preview') {
    throw new Error(`Unknown MIDNIGHT_NETWORK '${raw}'`);
  }
  if (raw === 'mainnet' && process.env.LUMPFUN_ALLOW_MAINNET !== '1') {
    throw new Error('Mainnet is disabled. Set LUMPFUN_ALLOW_MAINNET=1 to override.');
  }
  return raw;
}

function resolveWalletDir(): string {
  return process.env.MIDNIGHT_WALLET_DIR ?? join(homedir(), '.lumpfun');
}

// ─── Singleton cache ─────────────────────────────────────────────────
// Avoid re-reading seed / re-deriving on every request (and across HMR).

interface CacheSlot { info?: WalletInfo; err?: Error }
const G = globalThis as unknown as { __lumpfunMidnightWallet?: CacheSlot };

export function getWalletInfo(): WalletInfo {
  if (!G.__lumpfunMidnightWallet) G.__lumpfunMidnightWallet = {};
  const slot = G.__lumpfunMidnightWallet;
  if (slot.info) return slot.info;
  if (slot.err) throw slot.err;

  try {
    const networkId = resolveNetworkId();
    const walletDir = resolveWalletDir();
    const seed = loadSeed(walletDir);
    const addresses = deriveAddresses(seed, networkId);
    seed.fill(0);
    slot.info = {
      networkId,
      addresses,
      seedPath: join(walletDir, 'seed.hex'),
    };
    return slot.info;
  } catch (err) {
    slot.err = err instanceof Error ? err : new Error(String(err));
    throw slot.err;
  }
}
