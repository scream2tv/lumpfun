import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('registry', () => {
  let tmpHome: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    tmpHome = mkdtempSync(join(tmpdir(), 'lumpfun-'));
    process.env.HOME = tmpHome;
    // On macOS, os.homedir() does not honor process.env.HOME — it reads passwd.
    // Mock the module so each freshly-imported registry sees tmpHome.
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return { ...actual, homedir: () => tmpHome };
    });
  });

  afterEach(() => {
    vi.doUnmock('os');
  });

  it('recordLaunch persists and listLaunches returns it', async () => {
    const { recordLaunch, listLaunches } = await import('../../src/registry.js');
    recordLaunch({
      contractAddress: '0xabc',
      deployTxId: '0xdef',
      deployedAt: '2026-04-17T00:00:00Z',
      name: 'TestMeme',
      symbol: 'TMEME',
    });
    const list = await listLaunches();  // local-only
    expect(list.length).toBe(1);
    expect(list[0].contractAddress).toBe('0xabc');
    expect(list[0].name).toBe('TestMeme');
  });

  it('recordLaunch is idempotent — same address not duplicated', async () => {
    const { recordLaunch, listLaunches } = await import('../../src/registry.js');
    recordLaunch({ contractAddress: '0xabc', deployTxId: '0x1', deployedAt: 'x' });
    recordLaunch({ contractAddress: '0xabc', deployTxId: '0x2', deployedAt: 'y' });
    const list = await listLaunches();
    expect(list.length).toBe(1);
    expect(list[0].deployTxId).toBe('0x1');  // first write wins
  });
});
