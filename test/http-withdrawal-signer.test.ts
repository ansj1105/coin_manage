import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpWithdrawalSigner } from '../src/infrastructure/integration/http-withdrawal-signer.js';

describe('http withdrawal signer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the remote signer API and returns the tx hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: '2026-03-19.withdraw-signer.v1',
        withdrawalId: 'wd-1',
        txHash: 'tx-remote-1',
        signerBackend: 'remote',
        broadcastedAt: '2026-03-19T12:00:00.000Z'
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const signer = new HttpWithdrawalSigner('http://withdraw-signer/api/internal/signer/withdrawals', 'signer-secret');
    const result = await signer.broadcastWithdrawal({
      withdrawalId: 'wd-1',
      toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      amount: 150_000_000n
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://withdraw-signer/api/internal/signer/withdrawals/wd-1/broadcast',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-internal-api-key': 'signer-secret'
        })
      })
    );
    expect(result).toEqual({ txHash: 'tx-remote-1' });
  });
});
