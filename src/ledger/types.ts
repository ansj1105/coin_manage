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
  | 'approved'
  | 'broadcasted'
  | 'confirmed'
  | 'failed'
  | 'rejected';

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
}

export interface TxJob {
  jobId: string;
  type: 'withdraw_reconcile' | 'withdraw_manual_review';
  payload: Record<string, string>;
  status: 'pending' | 'running' | 'done' | 'failed';
  retryCount: number;
  createdAt: string;
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
