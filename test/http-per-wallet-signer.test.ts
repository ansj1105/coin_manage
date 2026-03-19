import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpPerWalletSigner } from '../src/infrastructure/integration/http-per-wallet-signer.js';

describe('http per-wallet signer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the virtual wallet activation reclaim signer route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: '2026-03-19.per-wallet-signer.v1',
        txHash: 'tx-per-wallet-1',
        signerBackend: 'remote',
        broadcastedAt: '2026-03-19T18:00:00.000Z'
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const signer = new HttpPerWalletSigner('http://ledger-signer/api/internal/signer', 'signer-secret');
    const result = await signer.broadcastActivationReclaim({
      virtualWalletId: 'vw-1',
      walletAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      currencyId: 3,
      network: 'mainnet',
      toAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amountSun: 1_000_000n
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ledger-signer/api/internal/signer/virtual-wallets/vw-1/activation-reclaim',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-internal-api-key': 'signer-secret'
        })
      })
    );
    expect(result).toEqual({ txHash: 'tx-per-wallet-1' });
  });
});
