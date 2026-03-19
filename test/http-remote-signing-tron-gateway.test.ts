import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpRemoteSigningTronGateway } from '../src/infrastructure/integration/http-remote-signing-tron-gateway.js';

describe('http remote signing tron gateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes hot-wallet transfer broadcasts through the signer service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: '2026-03-19.tron-signer.v1',
        txHash: 'tx-hot-1',
        signerBackend: 'remote',
        broadcastedAt: '2026-03-19T13:00:00.000Z'
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new HttpRemoteSigningTronGateway('http://signer/api/internal/signer', 'signer-secret', {
      getTransactionReceipt: vi.fn(),
      getTransactionReceiptDetails: vi.fn(),
      getAccountResources: vi.fn(),
      getCanDelegatedMaxSize: vi.fn(),
      getDelegatedResource: vi.fn()
    } as any);

    const result = await gateway.broadcastTransfer({
      toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      amount: 120_000_000n,
      network: 'mainnet'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://signer/api/internal/signer/tron/broadcast-transfer',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-internal-api-key': 'signer-secret'
        })
      })
    );
    expect(result).toEqual({ txHash: 'tx-hot-1' });
  });
});
