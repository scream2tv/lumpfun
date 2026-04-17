import { describe, it, expect } from 'vitest';

describe('launch withdraw module shape', () => {
  it('exports withdrawPlatform, withdrawCreator, withdrawReferral', async () => {
    const mod = await import('../../src/launch.js');
    expect(typeof mod.withdrawPlatform).toBe('function');
    expect(typeof mod.withdrawCreator).toBe('function');
    expect(typeof mod.withdrawReferral).toBe('function');
  });
});
