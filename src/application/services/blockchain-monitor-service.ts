import type { BlockchainReader, WalletMonitoringSnapshot } from '../ports/blockchain-reader.js';

interface CacheEntry {
  expiresAt: number;
  snapshot: WalletMonitoringSnapshot;
}

export class BlockchainMonitorService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly reader: BlockchainReader,
    private readonly cacheMs = 10_000
  ) {}

  async getWalletMonitoring(addresses: string[]): Promise<WalletMonitoringSnapshot[]> {
    const uniqueAddresses = [...new Set(addresses)];
    const now = Date.now();
    const snapshots: WalletMonitoringSnapshot[] = [];

    for (const address of uniqueAddresses) {
      const cached = this.cache.get(address);
      if (cached && cached.expiresAt > now) {
        snapshots.push(cached.snapshot);
        continue;
      }

      const snapshot = await this.reader.getWalletMonitoringSnapshot(address);
      this.cache.set(address, {
        expiresAt: now + this.cacheMs,
        snapshot
      });
      snapshots.push(snapshot);
    }

    return snapshots;
  }
}
