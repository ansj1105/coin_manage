import { DomainError } from '../../domain/errors/domain-error.js';
import type {
  FoxyaCanonicalWalletSnapshot,
  FoxyaCanonicalWalletSnapshotClient
} from '../../application/ports/foxya-canonical-wallet-snapshot-client.js';

export class HttpFoxyaCanonicalWalletSnapshotClient implements FoxyaCanonicalWalletSnapshotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async getCanonicalWalletSnapshot(input: {
    userId: string;
    currencyCode: string;
  }): Promise<FoxyaCanonicalWalletSnapshot> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/snapshot`);
    url.searchParams.set('userId', input.userId);
    url.searchParams.set('currencyCode', input.currencyCode);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Internal-Api-Key': this.apiKey
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const message = await response.text();
      throw new DomainError(
        response.status,
        'FOXYA_CANONICAL_WALLET_SNAPSHOT_ERROR',
        message || 'foxya canonical wallet snapshot failed'
      );
    }

    const payload = await response.json() as Partial<FoxyaCanonicalWalletSnapshot>;
    if (!payload.userId || !payload.currencyCode || !payload.totalBalance || !payload.canonicalBasis || !payload.refreshedAt) {
      throw new DomainError(502, 'FOXYA_CANONICAL_WALLET_SNAPSHOT_INVALID', 'foxya canonical wallet snapshot invalid');
    }

    return {
      userId: payload.userId,
      currencyCode: payload.currencyCode,
      totalBalance: payload.totalBalance,
      lockedBalance: payload.lockedBalance ?? '0.000000',
      walletCount: Number(payload.walletCount ?? 0),
      canonicalBasis: payload.canonicalBasis,
      refreshedAt: payload.refreshedAt
    };
  }
}
