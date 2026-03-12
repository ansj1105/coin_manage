import type {
  Account,
  ApprovalDecisionResult,
  AuditLog,
  DepositApplyResult,
  LedgerSummary,
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
    blockNumber: number;
    nowIso?: string;
  }): Promise<DepositApplyResult>;
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
  markWithdrawalReviewRequired(withdrawalId: string, note: string, nowIso?: string): Promise<Withdrawal>;
  approveWithdrawal(
    withdrawalId: string,
    input: { adminId: string; actorType: 'admin' | 'system'; note?: string },
    nowIso?: string
  ): Promise<ApprovalDecisionResult>;
  broadcastWithdrawal(withdrawalId: string, txHash: string, nowIso?: string): Promise<Withdrawal>;
  confirmWithdrawal(withdrawalId: string, nowIso?: string): Promise<Withdrawal>;
  failWithdrawal(withdrawalId: string, reason: string, nowIso?: string): Promise<Withdrawal>;
  getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined>;
  listWithdrawalsByStatuses(statuses: WithdrawalStatus[]): Promise<Withdrawal[]>;
  listPendingApprovalWithdrawals(): Promise<Withdrawal[]>;
  listWithdrawalApprovals(withdrawalId: string): Promise<WithdrawalApproval[]>;
  listStuckWithdrawals(timeoutSec: number, nowIso?: string): Promise<Withdrawal[]>;
  enqueueJob(type: TxJob['type'], payload: Record<string, string>, nowIso?: string): Promise<TxJob>;
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
  confirmSweep(sweepId: string, note?: string, nowIso?: string): Promise<SweepRecord>;
  failSweep(sweepId: string, reason: string, nowIso?: string): Promise<SweepRecord>;
  getLedgerSummary(): Promise<LedgerSummary>;
}
