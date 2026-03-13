import { DomainError } from '../../domain/errors/domain-error.js';
import type { VirtualWalletSyncClient } from '../../application/ports/virtual-wallet-sync-client.js';

type SyncVirtualWalletInput = Parameters<VirtualWalletSyncClient['syncVirtualWallet']>[0];

export class FoxyaInternalWalletClient implements VirtualWalletSyncClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async syncVirtualWallet(input: SyncVirtualWalletInput): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sync-virtual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': this.apiKey
      },
      body: JSON.stringify({
        userId: Number(input.userId),
        currencyId: input.currencyId,
        address: input.address,
        ...(input.privateKey ? { privateKey: input.privateKey } : {}),
        ...(input.verified !== undefined ? { verified: input.verified } : {}),
        network: input.network
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const message = await response.text();
      throw new DomainError(response.status, 'FOXYA_INTERNAL_WALLET_API_ERROR', message || 'foxya internal wallet sync failed');
    }
  }
}
