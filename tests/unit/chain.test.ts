import { describe, it, expect } from 'vitest';
import { RpcError, IndexerError } from '../../src/chain.js';

describe('chain', () => {
  it('RpcError formats its message correctly', () => {
    const e = new RpcError(1, 'bad method');
    expect(e.message).toBe('RPC error 1: bad method');
    expect(e.name).toBe('RpcError');
    expect(e.code).toBe(1);
    expect(e.rpcMessage).toBe('bad method');
  });

  it('IndexerError joins error messages', () => {
    const e = new IndexerError(
      [{ message: 'bad query' }, { message: 'missing field' }],
      'query { x }',
    );
    expect(e.message).toBe('Indexer errors: bad query; missing field');
    expect(e.name).toBe('IndexerError');
    expect(e.query).toBe('query { x }');
  });
});
