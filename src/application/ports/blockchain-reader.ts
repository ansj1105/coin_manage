export interface WalletMonitoringSnapshot {
  address: string;
  tokenSymbol: string;
  tokenContractAddress: string | null;
  tokenBalance: string | null;
  tokenRawBalance: string | null;
  tokenDecimals: number | null;
  trxBalance: string | null;
  trxRawBalance: string | null;
  fetchedAt: string;
  status: 'ok' | 'error';
  error?: string;
}

export interface BlockchainReader {
  getWalletMonitoringSnapshot(address: string): Promise<WalletMonitoringSnapshot>;
}
