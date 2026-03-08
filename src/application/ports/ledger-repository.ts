import type {
  Account,
  DepositApplyResult,
  TransferResult,
  TxJob,
  WalletBinding,
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
    nowIso?: string;
  }): Promise<WithdrawalRequestResult>;
  approveWithdrawal(withdrawalId: string, nowIso?: string): Promise<Withdrawal>;
  broadcastWithdrawal(withdrawalId: string, txHash: string, nowIso?: string): Promise<Withdrawal>;
  confirmWithdrawal(withdrawalId: string, nowIso?: string): Promise<Withdrawal>;
  failWithdrawal(withdrawalId: string, reason: string, nowIso?: string): Promise<Withdrawal>;
  getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined>;
  listWithdrawalsByStatuses(statuses: WithdrawalStatus[]): Promise<Withdrawal[]>;
  listStuckWithdrawals(timeoutSec: number, nowIso?: string): Promise<Withdrawal[]>;
  enqueueJob(type: TxJob['type'], payload: Record<string, string>, nowIso?: string): Promise<TxJob>;
}
