export type ExternalDepositEventStatus = 'discovered' | 'registered' | 'completed';

export interface DepositMonitorCursor {
  scannerKey: string;
  network: 'mainnet' | 'testnet';
  contractAddress: string;
  cursorTimestampMs: number;
  lastScannedBlockNumber?: number;
  lastSeenEventBlockNumber?: number;
  lastSeenTxHash?: string;
  lastError?: string;
  updatedAt: string;
}

export interface ExternalDepositEvent {
  eventKey: string;
  depositId: string;
  userId: string;
  currencyId: number;
  network: string;
  fromAddress?: string;
  toAddress: string;
  txHash: string;
  eventIndex: number;
  blockNumber: number;
  blockTimestampMs: number;
  amountRaw: string;
  amountDecimal: string;
  status: ExternalDepositEventStatus;
  foxyaRegisteredAt?: string;
  foxyaCompletedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DepositMonitorStatus {
  enabled: boolean;
  network: 'mainnet' | 'testnet';
  contractAddress?: string;
  foxyaIntegrationEnabled: boolean;
  pollIntervalSec: number;
  requiredConfirmations: number;
  startTimestampMs?: number;
  currencyFilterIds: number[];
  cursor?: DepositMonitorCursor;
  recentEvents: ExternalDepositEvent[];
  counts: {
    discovered: number;
    registered: number;
    completed: number;
  };
}

export interface DepositWatchAddress {
  userId: string;
  currencyId: number;
  address: string;
  network: string;
}

export interface ExternalDepositRecord {
  depositId: string;
  status?: string;
  txHash?: string;
}

export interface DepositMonitorCycleResult {
  scannedEvents: number;
  watchedAddresses: number;
  matchedEvents: number;
  registeredCount: number;
  completedCount: number;
  skippedCount: number;
  currentBlockNumber: number;
  cursorTimestampMs: number;
}
