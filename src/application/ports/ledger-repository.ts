import type {
  Account,
  ApprovalDecisionResult,
  AuditLog,
  DepositApplyResult,
  Deposit,
  LedgerSummary,
  LedgerTransaction,
  NetworkFeeReceipt,
  NetworkFeeDailySnapshot,
  OutboxEvent,
  OutboxEventSummary,
  SweepRecord,
  TransferResult,
  TxJob,
  WalletBinding,
  WithdrawalApproval,
  Withdrawal,
  WithdrawalRequestResult,
  WithdrawalStatus
} from '../../domain/ledger/types.js';

export interface LedgerRepository {
  getAccount(userId: string): Promise<Account>;
  getAccountByWalletAddress(walletAddress: string): Promise<Account>;
  bindWalletAddress(input: { userId: string; walletAddress: string; nowIso?: string }): Promise<WalletBinding>;
  getWalletBinding(input: { userId?: string; walletAddress?: string }): Promise<WalletBinding | undefined>;
  resolveUserId(input: { userId?: string; walletAddress?: string }): Promise<string>;
  applyDeposit(input: {
    userId: string;
    amount: bigint;
    txHash: string;
    toAddress?: string;
    walletAddress?: string;
    blockNumber: number;
    nowIso?: string;
  }): Promise<DepositApplyResult>;
  completeDeposit(depositId: string, nowIso?: string): Promise<DepositApplyResult['deposit']>;
  transfer(input: {
    fromUserId: string;
    toUserId: string;
    amount: bigint;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<TransferResult>;
  requestWithdrawal(input: {
    userId: string;
    amount: bigint;
    toAddress: string;
    idempotencyKey: string;
    riskLevel?: Withdrawal['riskLevel'];
    riskScore?: number;
    riskFlags?: string[];
    requiredApprovals?: number;
    clientIp?: string;
    deviceId?: string;
    nowIso?: string;
  }): Promise<WithdrawalRequestResult>;
  confirmWithdrawalExternalAuth(
    withdrawalId: string,
    input: { provider: string; requestId: string },
    nowIso?: string
  ): Promise<Withdrawal>;
  markWithdrawalReviewRequired(withdrawalId: string, note: string, nowIso?: string): Promise<Withdrawal>;
  approveWithdrawal(
    withdrawalId: string,
    input: {
      adminId: string;
      actorType: 'admin' | 'system';
      reasonCode?: 'manual_review_passed' | 'high_value_verified' | 'trusted_destination_verified' | 'account_activity_verified' | 'ops_override';
      note?: string;
    },
    nowIso?: string
  ): Promise<ApprovalDecisionResult>;
  broadcastWithdrawal(withdrawalId: string, txHash: string, nowIso?: string): Promise<Withdrawal>;
  confirmWithdrawal(
    withdrawalId: string,
    input?: { networkFee?: { txHash: string; feeSun: bigint; energyUsed: number; bandwidthUsed: number } },
    nowIso?: string
  ): Promise<Withdrawal>;
  failWithdrawal(withdrawalId: string, reason: string, nowIso?: string): Promise<Withdrawal>;
  getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined>;
  listWithdrawalsByUser(userId: string, limit?: number): Promise<Withdrawal[]>;
  listWithdrawalsByStatuses(statuses: WithdrawalStatus[]): Promise<Withdrawal[]>;
  listPendingApprovalWithdrawals(): Promise<Withdrawal[]>;
  listWithdrawalApprovals(withdrawalId: string): Promise<WithdrawalApproval[]>;
  listStuckWithdrawals(timeoutSec: number, nowIso?: string): Promise<Withdrawal[]>;
  listDepositsByUser(userId: string, limit?: number): Promise<Deposit[]>;
  listTransactionsByUser(
    userId: string,
    input?: { types?: LedgerTransaction['type'][]; limit?: number }
  ): Promise<LedgerTransaction[]>;
  enqueueJob(type: TxJob['type'], payload: Record<string, string>, nowIso?: string): Promise<TxJob>;
  claimPendingJobs(types: TxJob['type'][], limit: number, nowIso?: string): Promise<TxJob[]>;
  markJobDone(jobId: string): Promise<void>;
  markJobFailed(jobId: string): Promise<void>;
  retryJob(jobId: string): Promise<TxJob | undefined>;
  appendAuditLog(input: {
    entityType: AuditLog['entityType'];
    entityId: string;
    action: string;
    actorType: AuditLog['actorType'];
    actorId: string;
    metadata: Record<string, string>;
    nowIso?: string;
  }): Promise<AuditLog>;
  listAuditLogs(input?: {
    entityType?: AuditLog['entityType'];
    entityId?: string;
    actorId?: string;
    action?: string;
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
  }): Promise<AuditLog[]>;
  createSweepRecord(input: {
    sourceWalletCode: string;
    sourceAddress: string;
    targetAddress: string;
    currencyId?: number;
    network?: 'mainnet' | 'testnet';
    amount: bigint;
    externalRef?: string;
    note?: string;
    nowIso?: string;
  }): Promise<SweepRecord>;
  listSweepRecords(limit?: number): Promise<SweepRecord[]>;
  listSweepRecordsByStatuses(statuses: SweepRecord['status'][], limit?: number): Promise<SweepRecord[]>;
  findSweepByExternalRef(externalRef: string): Promise<SweepRecord | undefined>;
  markSweepQueued(sweepId: string, note?: string, nowIso?: string): Promise<SweepRecord>;
  recordSweepAttempt(sweepId: string, note?: string, nowIso?: string): Promise<SweepRecord>;
  markSweepBroadcasted(sweepId: string, txHash: string, note?: string, nowIso?: string): Promise<SweepRecord>;
  confirmSweep(
    sweepId: string,
    input?: string | { note?: string; networkFee?: { txHash: string; feeSun: bigint; energyUsed: number; bandwidthUsed: number } },
    nowIso?: string
  ): Promise<SweepRecord>;
  failSweep(sweepId: string, reason: string, nowIso?: string): Promise<SweepRecord>;
  listNetworkFeeReceipts(input?: {
    referenceType?: NetworkFeeReceipt['referenceType'];
    referenceId?: string;
    limit?: number;
  }): Promise<NetworkFeeReceipt[]>;
  listNetworkFeeDailySnapshots(input?: { days?: number }): Promise<NetworkFeeDailySnapshot[]>;
  claimPendingOutboxEvents(limit: number, nowIso?: string): Promise<OutboxEvent[]>;
  markOutboxEventPublished(outboxEventId: string, nowIso?: string): Promise<void>;
  rescheduleOutboxEvent(outboxEventId: string, error: string, availableAt: string): Promise<void>;
  deadLetterOutboxEvent(outboxEventId: string, error: string, deadLetteredAt?: string): Promise<void>;
  listOutboxEvents(input?: { status?: OutboxEvent['status']; limit?: number }): Promise<OutboxEvent[]>;
  getOutboxEventSummary(): Promise<OutboxEventSummary>;
  replayOutboxEvents(input: { outboxEventIds?: string[]; status?: OutboxEvent['status']; limit?: number; nowIso?: string }): Promise<number>;
  recoverStaleProcessingOutboxEvents(timeoutSec: number, nowIso?: string): Promise<number>;
  acknowledgeDeadLetterOutboxEvents(input: {
    outboxEventIds?: string[];
    limit?: number;
    actorId: string;
    note?: string;
    category?: OutboxEvent['deadLetterCategory'];
    incidentRef?: string;
    nowIso?: string;
  }): Promise<number>;
  getLedgerSummary(): Promise<LedgerSummary>;
  rebuildAccountProjections(nowIso?: string): Promise<{ accountCount: number }>;
}
