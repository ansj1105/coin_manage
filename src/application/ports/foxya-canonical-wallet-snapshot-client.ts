export interface FoxyaCanonicalWalletSnapshot {
  userId: string;
  currencyCode: string;
  totalBalance: string;
  lockedBalance: string;
  walletCount: number;
  canonicalBasis: string;
  refreshedAt: string;
}

export interface FoxyaCanonicalWalletSnapshotClient {
  getCanonicalWalletSnapshot(input: {
    userId: string;
    currencyCode: string;
  }): Promise<FoxyaCanonicalWalletSnapshot>;
}
