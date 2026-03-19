import type {
  CollectorRunRecord,
  MonitoringRepository,
  StoredWalletMonitoringSnapshot,
  WalletMonitoringHistoryPoint
} from '../../application/ports/monitoring-repository.js';

export class InMemoryMonitoringRepository implements MonitoringRepository {
  private readonly walletSnapshots = new Map<string, StoredWalletMonitoringSnapshot>();
  private readonly collectorRuns = new Map<string, CollectorRunRecord>();
  private readonly walletHistory: WalletMonitoringHistoryPoint[] = [];

  async saveWalletSnapshots(input: {
    collectorName: string;
    startedAt: string;
    finishedAt: string;
    snapshots: StoredWalletMonitoringSnapshot[];
    status: CollectorRunRecord['status'];
    errorMessage?: string;
  }): Promise<void> {
    for (const snapshot of input.snapshots) {
      this.walletSnapshots.set(snapshot.walletCode, { ...snapshot });
      this.walletHistory.push({
        snapshotId: `${input.collectorName}:${snapshot.walletCode}:${input.finishedAt}`,
        collectorName: input.collectorName,
        createdAt: input.finishedAt,
        ...snapshot
      });
    }

    this.collectorRuns.set(input.collectorName, {
      collectorName: input.collectorName,
      status: input.status,
      successCount: input.snapshots.filter((snapshot) => snapshot.status === 'ok').length,
      errorCount: input.snapshots.filter((snapshot) => snapshot.status !== 'ok').length,
      totalCount: input.snapshots.length,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      errorMessage: input.errorMessage
    });
  }

  async getWalletSnapshots(codes: string[]): Promise<StoredWalletMonitoringSnapshot[]> {
    return codes
      .map((code) => this.walletSnapshots.get(code))
      .filter((snapshot): snapshot is StoredWalletMonitoringSnapshot => Boolean(snapshot))
      .map((snapshot) => ({ ...snapshot }));
  }

  async getLatestCollectorRuns(): Promise<CollectorRunRecord[]> {
    return [...this.collectorRuns.values()].map((run) => ({ ...run }));
  }

  async getWalletSnapshotHistory(input: {
    walletCodes?: string[];
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
  }): Promise<WalletMonitoringHistoryPoint[]> {
    const walletCodeSet = input.walletCodes ? new Set(input.walletCodes) : undefined;
    return this.walletHistory
      .filter((item) => (walletCodeSet ? walletCodeSet.has(item.walletCode) : true))
      .filter((item) => (input.createdFrom ? item.createdAt >= input.createdFrom : true))
      .filter((item) => (input.createdTo ? item.createdAt <= input.createdTo : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 500)
      .map((item) => ({ ...item }));
  }
}
