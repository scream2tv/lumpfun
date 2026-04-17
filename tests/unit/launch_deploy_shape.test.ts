import { describe, it, expect } from 'vitest';
import type {
  LaunchDeployParams,
  LaunchHandle,
  LaunchMetadata,
  CurveParams,
  FeeConfig,
  LiveState,
} from '../../src/launch.js';

describe('launch module shape', () => {
  it('exports deployLaunch, connectLaunch, getLaunchState, getReferralAccrued', async () => {
    const mod = await import('../../src/launch.js');
    expect(typeof mod.deployLaunch).toBe('function');
    expect(typeof mod.connectLaunch).toBe('function');
    expect(typeof mod.getLaunchState).toBe('function');
    expect(typeof mod.getReferralAccrued).toBe('function');
  });

  it('domain types compile (LaunchDeployParams, LaunchHandle, ...)', () => {
    // Purely a compile-time check; the runtime assertion is a no-op.
    const _params: LaunchDeployParams | undefined = undefined;
    const _handle: LaunchHandle | undefined = undefined;
    const _meta: LaunchMetadata | undefined = undefined;
    const _curve: CurveParams | undefined = undefined;
    const _fees: FeeConfig | undefined = undefined;
    const _state: LiveState | undefined = undefined;
    expect(_params ?? _handle ?? _meta ?? _curve ?? _fees ?? _state).toBe(
      undefined,
    );
  });
});
