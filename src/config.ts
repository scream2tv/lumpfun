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
      if (typeof v === 'string' && v.toLowerCase().includes('mainnet.')) {
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
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'string' && v.toLowerCase().includes('mainnet.')) {
      throw new Error(
        `assertPreprod() failed: ${k}=${v} points at mainnet despite networkId=preprod`,
      );
    }
  }
}

export function explorerLink(path: string): string {
  return `${getConfig().explorerUrl}${path}`;
}
