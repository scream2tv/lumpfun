import { Lucid, Blockfrost } from '@lucid-evolution/lucid';

export type Network = 'Mainnet' | 'Preprod';

export interface ChainConfig {
  network: Network;
  blockfrostProjectId: string;
  blockfrostUrl?: string;
}

const BLOCKFROST_URLS: Record<Network, string> = {
  Mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
  Preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
};

export async function makeLucid(config: ChainConfig): Promise<typeof Lucid.prototype> {
  const url = config.blockfrostUrl ?? BLOCKFROST_URLS[config.network];
  const provider = new Blockfrost(url, config.blockfrostProjectId);
  return Lucid(provider, config.network);
}

export function networkFromEnv(): Network {
  const raw = process.env.CARDANO_NETWORK ?? 'Preprod';
  if (raw !== 'Mainnet' && raw !== 'Preprod') {
    throw new Error(`CARDANO_NETWORK must be "Mainnet" or "Preprod", got "${raw}"`);
  }
  return raw;
}

export function blockfrostIdFromEnv(): string {
  const id = process.env.BLOCKFROST_PROJECT_ID;
  if (!id) throw new Error('BLOCKFROST_PROJECT_ID env var is required');
  return id;
}

export async function makeLucidFromEnv(): Promise<typeof Lucid.prototype> {
  return makeLucid({
    network: networkFromEnv(),
    blockfrostProjectId: blockfrostIdFromEnv(),
  });
}
