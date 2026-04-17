import { describe, it, expect } from 'vitest';

describe('night', () => {
  it('exports createContractProviders', async () => {
    const mod = await import('../../src/night.js');
    expect(typeof mod.createContractProviders).toBe('function');
    expect(mod.createContractProviders.length).toBeGreaterThanOrEqual(1);
  });
});
