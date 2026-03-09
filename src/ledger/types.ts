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
  status: 'confirmed';
  blockNumber: number;
  createdAt: string;
}

export type WithdrawalStatus =
  | 'requested'
  | 'review_required'
  | 'approved'
  | 'broadcasted'
  | 'confirmed'
  | 'failed'
  | 'rejected';

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
}

export interface TxJob {
  jobId: string;
  type: 'withdraw_dispatch' | 'withdraw_reconcile' | 'withdraw_manual_review' | 'sweep_plan';
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

export type SweepStatus = 'planned' | 'broadcasted' | 'confirmed' | 'skipped';

export interface SweepRecord {
  sweepId: string;
  sourceWalletCode: string;
  sourceAddress: string;
  targetAddress: string;
  amount: bigint;
  status: SweepStatus;
  txHash?: string;
  note?: string;
  createdAt: string;
  broadcastedAt?: string;
  confirmedAt?: string;
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
