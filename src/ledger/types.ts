export type TransactionType =
  | 'deposit'
  | 'withdraw'
  | 'payment'
  | 'internal_transfer_in'
  | 'internal_transfer_out';

export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface Account {
  userId: string;
  walletAddress?: string;
  balance: bigint;
  lockedBalance: bigint;
  updatedAt: string;
}

export interface WalletBinding {
  userId: string;
  walletAddress: string;
  createdAt: string;
}

export interface LedgerTransaction {
  txId: string;
  userId: string;
  type: TransactionType;
  amount: bigint;
  status: TransactionStatus;
  blockTx?: string;
  relatedUserId?: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface Deposit {
  depositId: string;
  userId: string;
  txHash: string;
  amount: bigint;
  status: 'DETECTED' | 'CONFIRMED' | 'CREDITED' | 'COMPLETED';
  blockNumber: number;
  createdAt: string;
}

export type WithdrawalStatus =
  | 'LEDGER_RESERVED'
  | 'PENDING_ADMIN'
  | 'ADMIN_APPROVED'
  | 'TX_BROADCASTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Withdrawal {
  withdrawalId: string;
  userId: string;
  amount: bigint;
  toAddress: string;
  status: WithdrawalStatus;
  txHash?: string;
  idempotencyKey: string;
  ledgerTxId: string;
  createdAt: string;
  approvedAt?: string;
  broadcastedAt?: string;
  confirmedAt?: string;
  failedAt?: string;
  failReason?: string;
  riskLevel: RiskLevel;
  riskScore: number;
  riskFlags: string[];
  requiredApprovals: number;
  approvalCount: number;
  clientIp?: string;
  deviceId?: string;
  reviewRequiredAt?: string;
  externalAuthProvider?: string;
  externalAuthRequestId?: string;
  externalAuthConfirmedAt?: string;
}

export interface TxJob {
  jobId: string;
  type: 'withdraw_dispatch' | 'withdraw_reconcile' | 'withdraw_external_sync' | 'withdraw_manual_review' | 'sweep_plan';
  payload: Record<string, string>;
  status: 'pending' | 'running' | 'done' | 'failed';
  retryCount: number;
  createdAt: string;
}

export interface WithdrawalApproval {
  approvalId: string;
  withdrawalId: string;
  adminId: string;
  actorType: 'admin' | 'system';
  reasonCode:
    | 'manual_review_passed'
    | 'high_value_verified'
    | 'trusted_destination_verified'
    | 'account_activity_verified'
    | 'ops_override';
  note?: string;
  createdAt: string;
}

export interface ApprovalDecisionResult {
  withdrawal: Withdrawal;
  approval: WithdrawalApproval;
  finalized: boolean;
}

export interface AuditLog {
  auditId: string;
  entityType: 'withdrawal' | 'sweep' | 'system';
  entityId: string;
  action: string;
  actorType: 'admin' | 'system' | 'user';
  actorId: string;
  metadata: Record<string, string>;
  createdAt: string;
}

export type SweepStatus = 'planned' | 'queued' | 'broadcasted' | 'confirmed' | 'failed' | 'skipped';

export interface SweepRecord {
  sweepId: string;
  sourceWalletCode: string;
  sourceAddress: string;
  targetAddress: string;
  currencyId?: number;
  network?: 'mainnet' | 'testnet';
  amount: bigint;
  status: SweepStatus;
  externalRef?: string;
  txHash?: string;
  note?: string;
  attemptCount: number;
  createdAt: string;
  queuedAt?: string;
  lastAttemptAt?: string;
  broadcastedAt?: string;
  confirmedAt?: string;
}

export interface NetworkFeeReceipt {
  feeReceiptId: string;
  referenceType: 'withdrawal' | 'sweep';
  referenceId: string;
  txHash: string;
  currencyCode: 'TRX';
  feeSun: bigint;
  energyUsed: number;
  bandwidthUsed: number;
  confirmedAt: string;
  createdAt: string;
}

export interface NetworkFeeDailySnapshot {
  snapshotDate: string;
  currencyCode: 'TRX';
  ledgerFeeSun: bigint;
  actualFeeSun: bigint;
  gapFeeSun: bigint;
  ledgerFeeCount: number;
  actualFeeCount: number;
  byReferenceType: {
    withdrawal: {
      ledgerFeeSun: bigint;
      actualFeeSun: bigint;
      ledgerFeeCount: number;
      actualFeeCount: number;
    };
    sweep: {
      ledgerFeeSun: bigint;
      actualFeeSun: bigint;
      ledgerFeeCount: number;
      actualFeeCount: number;
    };
  };
}

export interface OutboxEvent {
  outboxEventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'published' | 'dead_lettered';
  attempts: number;
  availableAt: string;
  createdAt: string;
  processingStartedAt?: string;
  publishedAt?: string;
  deadLetteredAt?: string;
  deadLetterAcknowledgedAt?: string;
  deadLetterAcknowledgedBy?: string;
  deadLetterNote?: string;
  deadLetterCategory?: 'external_dependency' | 'validation' | 'state_conflict' | 'network' | 'unknown';
  incidentRef?: string;
  lastError?: string;
}

export interface OutboxEventSummary {
  pendingCount: number;
  processingCount: number;
  publishedCount: number;
  deadLetteredCount: number;
  deadLetterAcknowledgedCount: number;
  deadLetterUnacknowledgedCount: number;
  oldestPendingCreatedAt?: string;
  oldestDeadLetteredAt?: string;
}

export type OfflinePaySettlementModel = 'SENDER_LEDGER_PLUS_RECEIVER_HISTORY';

export interface EventConsumerAttempt {
  attemptId: string;
  eventKey: string;
  eventType: string;
  consumerName: string;
  status: 'succeeded' | 'failed';
  attemptNumber: number;
  aggregateId?: string;
  errorMessage?: string;
  durationMs: number;
  createdAt: string;
}

export interface EventConsumerDeadLetter {
  deadLetterId: string;
  eventKey: string;
  eventType: string;
  consumerName: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  failedAt: string;
}

export interface EventConsumerCheckpoint {
  consumerName: string;
  eventKey: string;
  eventType: string;
  aggregateId?: string;
  lastStatus: 'succeeded' | 'dead_lettered';
  firstProcessedAt: string;
  lastProcessedAt: string;
}

export interface LedgerSummary {
  accountCount: number;
  availableBalance: bigint;
  lockedBalance: bigint;
  liabilityBalance: bigint;
  confirmedDepositCount: number;
  activeWithdrawalCount: number;
}

export interface DepositApplyResult {
  deposit: Deposit;
  duplicated: boolean;
}

export interface TransferResult {
  fromTx: LedgerTransaction;
  toTx: LedgerTransaction;
  duplicated: boolean;
}

export interface WithdrawalRequestResult {
  withdrawal: Withdrawal;
  duplicated: boolean;
}

export interface OfflinePayLockResult {
  lockId: string;
  status: 'LOCKED';
  duplicated: boolean;
}

export interface OfflinePayReleaseResult {
  releaseId: string;
  status: 'RELEASED';
  duplicated: boolean;
}

export interface OfflinePaySettlementFinalizeResult {
  settlementId: string;
  status: 'FINALIZED';
  ledgerOutcome: 'FINALIZED' | 'COMPENSATED';
  releaseAction: 'RELEASE' | 'ADJUST';
  duplicated: boolean;
  accountingSide: 'SENDER';
  receiverSettlementMode: 'EXTERNAL_HISTORY_SYNC';
  settlementModel: 'SENDER_LEDGER_PLUS_RECEIVER_HISTORY';
  postAvailableBalance: bigint;
  postLockedBalance: bigint;
  postOfflinePayPendingBalance: bigint;
}
