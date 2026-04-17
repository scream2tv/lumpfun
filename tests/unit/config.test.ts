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
