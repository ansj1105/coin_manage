import { randomUUID } from 'node:crypto';
import { DomainError } from '../core/domain-error.js';
import { sumBigInt } from '../core/money.js';
import type {
  Account,
  Deposit,
  DepositApplyResult,
  LedgerTransaction,
  TransferResult,
  TxJob,
  WalletBinding,
  Withdrawal,
  WithdrawalRequestResult,
  WithdrawalStatus
} from './types.js';

export interface WithdrawalLimitConfig {
  singleLimit: bigint;
  dailyLimit: bigint;
}

interface TransferIdempotencyRecord {
  fromTxId: string;
  toTxId: string;
}

export class InMemoryLedger {
  private readonly accounts = new Map<string, Account>();
  private readonly walletBindingsByUserId = new Map<string, WalletBinding>();
  private readonly userIdByWalletAddress = new Map<string, string>();
  private readonly transactions = new Map<string, LedgerTransaction>();
  private readonly depositsByTxHash = new Map<string, Deposit>();
  private readonly withdrawals = new Map<string, Withdrawal>();
  private readonly withdrawalByIdempotencyKey = new Map<string, string>();
  private readonly transferByIdempotencyKey = new Map<string, TransferIdempotencyRecord>();
  private readonly jobs = new Map<string, TxJob>();

  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly limits: WithdrawalLimitConfig) {}

  async getAccount(userId: string): Promise<Account> {
    const account = this.accounts.get(userId) ?? this.createEmptyAccount(userId);
    this.accounts.set(userId, account);
    return this.enrichAccount(account);
  }

  async getAccountByWalletAddress(walletAddress: string): Promise<Account> {
    const userId = await this.resolveUserId({ walletAddress });
    return this.getAccount(userId);
  }

  async bindWalletAddress(input: { userId: string; walletAddress: string; nowIso?: string }): Promise<WalletBinding> {
    return this.withLock(() => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      const existingUserId = this.userIdByWalletAddress.get(input.walletAddress);
      if (existingUserId && existingUserId !== input.userId) {
        throw new DomainError(409, 'WALLET_ADDRESS_IN_USE', 'wallet address is already bound to another user');
      }

      const previousBinding = this.walletBindingsByUserId.get(input.userId);
      if (previousBinding && previousBinding.walletAddress !== input.walletAddress) {
        this.userIdByWalletAddress.delete(previousBinding.walletAddress);
      }

      const binding: WalletBinding = {
        userId: input.userId,
        walletAddress: input.walletAddress,
        createdAt: previousBinding?.createdAt ?? nowIso
      };

      this.walletBindingsByUserId.set(input.userId, binding);
      this.userIdByWalletAddress.set(input.walletAddress, input.userId);

      const account = this.accounts.get(input.userId);
      if (account) {
        account.walletAddress = input.walletAddress;
      }

      return { ...binding };
    });
  }

  async getWalletBinding(input: { userId?: string; walletAddress?: string }): Promise<WalletBinding | undefined> {
    if (input.userId) {
      const binding = this.walletBindingsByUserId.get(input.userId);
      return binding ? { ...binding } : undefined;
    }

    if (input.walletAddress) {
      const userId = this.userIdByWalletAddress.get(input.walletAddress);
      if (!userId) {
        return undefined;
      }
      const binding = this.walletBindingsByUserId.get(userId);
      return binding ? { ...binding } : undefined;
    }

    throw new DomainError(400, 'VALIDATION_ERROR', 'userId or walletAddress is required');
  }

  async resolveUserId(input: { userId?: string; walletAddress?: string }): Promise<string> {
    if (input.userId && input.walletAddress) {
      const boundUserId = this.userIdByWalletAddress.get(input.walletAddress);
      if (boundUserId && boundUserId !== input.userId) {
        throw new DomainError(409, 'ACCOUNT_REFERENCE_CONFLICT', 'userId and walletAddress point to different accounts');
      }
      return input.userId;
    }

    if (input.userId) {
      return input.userId;
    }

    if (input.walletAddress) {
      const userId = this.userIdByWalletAddress.get(input.walletAddress);
      if (!userId) {
        throw new DomainError(404, 'WALLET_ADDRESS_NOT_FOUND', 'wallet address is not bound to any user');
      }
      return userId;
    }

    throw new DomainError(400, 'VALIDATION_ERROR', 'userId or walletAddress is required');
  }

  async applyDeposit(input: {
    userId: string;
    amount: bigint;
    txHash: string;
    blockNumber: number;
    nowIso?: string;
  }): Promise<DepositApplyResult> {
    return this.withLock(() => {
      const existing = this.depositsByTxHash.get(input.txHash);
      if (existing) {
        return { deposit: { ...existing }, duplicated: true };
      }

      const nowIso = input.nowIso ?? new Date().toISOString();
      const account = this.getMutableAccount(input.userId, nowIso);
      account.balance += input.amount;
      account.updatedAt = nowIso;

      const txId = randomUUID();
      this.transactions.set(txId, {
        txId,
        userId: input.userId,
        type: 'deposit',
        amount: input.amount,
        status: 'confirmed',
        blockTx: input.txHash,
        createdAt: nowIso
      });

      const deposit: Deposit = {
        depositId: randomUUID(),
        userId: input.userId,
        txHash: input.txHash,
        amount: input.amount,
        status: 'confirmed',
        blockNumber: input.blockNumber,
        createdAt: nowIso
      };

      this.depositsByTxHash.set(input.txHash, deposit);
      return { deposit: { ...deposit }, duplicated: false };
    });
  }

  async transfer(input: {
    fromUserId: string;
    toUserId: string;
    amount: bigint;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<TransferResult> {
    return this.withLock(() => {
      const existing = this.transferByIdempotencyKey.get(input.idempotencyKey);
      if (existing) {
        const fromTx = this.transactions.get(existing.fromTxId);
        const toTx = this.transactions.get(existing.toTxId);
        if (!fromTx || !toTx) {
          throw new DomainError(500, 'STATE_CORRUPTED', 'transfer idempotency state is invalid');
        }
        return { fromTx: { ...fromTx }, toTx: { ...toTx }, duplicated: true };
      }

      if (input.fromUserId === input.toUserId) {
        throw new DomainError(400, 'VALIDATION_ERROR', 'fromUserId and toUserId must be different');
      }

      const nowIso = input.nowIso ?? new Date().toISOString();
      const from = this.getMutableAccount(input.fromUserId, nowIso);
      const to = this.getMutableAccount(input.toUserId, nowIso);

      if (from.balance < input.amount) {
        throw new DomainError(400, 'INSUFFICIENT_BALANCE', 'insufficient balance for transfer');
      }

      from.balance -= input.amount;
      from.updatedAt = nowIso;
      to.balance += input.amount;
      to.updatedAt = nowIso;

      const fromTxId = randomUUID();
      const toTxId = randomUUID();
      const fromTx: LedgerTransaction = {
        txId: fromTxId,
        userId: input.fromUserId,
        type: 'internal_transfer_out',
        amount: input.amount,
        status: 'confirmed',
        relatedUserId: input.toUserId,
        idempotencyKey: input.idempotencyKey,
        createdAt: nowIso
      };
      const toTx: LedgerTransaction = {
        txId: toTxId,
        userId: input.toUserId,
        type: 'internal_transfer_in',
        amount: input.amount,
        status: 'confirmed',
        relatedUserId: input.fromUserId,
        idempotencyKey: input.idempotencyKey,
        createdAt: nowIso
      };

      this.transactions.set(fromTxId, fromTx);
      this.transactions.set(toTxId, toTx);
      this.transferByIdempotencyKey.set(input.idempotencyKey, { fromTxId, toTxId });

      return { fromTx: { ...fromTx }, toTx: { ...toTx }, duplicated: false };
    });
  }

  async requestWithdrawal(input: {
    userId: string;
    amount: bigint;
    toAddress: string;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<WithdrawalRequestResult> {
    return this.withLock(() => {
      const existingId = this.withdrawalByIdempotencyKey.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.withdrawals.get(existingId);
        if (!existing) {
          throw new DomainError(500, 'STATE_CORRUPTED', 'withdraw idempotency state is invalid');
        }
        return { withdrawal: { ...existing }, duplicated: true };
      }

      if (input.amount > this.limits.singleLimit) {
        throw new DomainError(400, 'LIMIT_EXCEEDED', 'single withdrawal limit exceeded');
      }

      const nowIso = input.nowIso ?? new Date().toISOString();
      const requestedToday = this.getDailyRequestedWithdrawalAmount(input.userId, nowIso);
      if (requestedToday + input.amount > this.limits.dailyLimit) {
        throw new DomainError(400, 'LIMIT_EXCEEDED', 'daily withdrawal limit exceeded');
      }

      const account = this.getMutableAccount(input.userId, nowIso);
      if (account.balance < input.amount) {
        throw new DomainError(400, 'INSUFFICIENT_BALANCE', 'insufficient balance for withdrawal');
      }

      account.balance -= input.amount;
      account.lockedBalance += input.amount;
      account.updatedAt = nowIso;

      const ledgerTxId = randomUUID();
      this.transactions.set(ledgerTxId, {
        txId: ledgerTxId,
        userId: input.userId,
        type: 'withdraw',
        amount: input.amount,
        status: 'pending',
        idempotencyKey: input.idempotencyKey,
        createdAt: nowIso
      });

      const withdrawal: Withdrawal = {
        withdrawalId: randomUUID(),
        userId: input.userId,
        amount: input.amount,
        toAddress: input.toAddress,
        status: 'requested',
        idempotencyKey: input.idempotencyKey,
        ledgerTxId,
        createdAt: nowIso
      };

      this.withdrawals.set(withdrawal.withdrawalId, withdrawal);
      this.withdrawalByIdempotencyKey.set(input.idempotencyKey, withdrawal.withdrawalId);

      return { withdrawal: { ...withdrawal }, duplicated: false };
    });
  }

  async approveWithdrawal(withdrawalId: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status !== 'requested') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be requested');
      }
      withdrawal.status = 'approved';
      withdrawal.approvedAt = nowIso;
      return { ...withdrawal };
    });
  }

  async broadcastWithdrawal(withdrawalId: string, txHash: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status !== 'approved') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be approved');
      }
      withdrawal.status = 'broadcasted';
      withdrawal.txHash = txHash;
      withdrawal.broadcastedAt = nowIso;
      return { ...withdrawal };
    });
  }

  async confirmWithdrawal(withdrawalId: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status !== 'broadcasted') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be broadcasted');
      }

      const account = this.getMutableAccount(withdrawal.userId, nowIso);
      if (account.lockedBalance < withdrawal.amount) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'locked balance underflow');
      }

      account.lockedBalance -= withdrawal.amount;
      account.updatedAt = nowIso;

      const tx = this.transactions.get(withdrawal.ledgerTxId);
      if (!tx) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'withdraw transaction missing');
      }
      tx.status = 'confirmed';
      tx.blockTx = withdrawal.txHash;

      withdrawal.status = 'confirmed';
      withdrawal.confirmedAt = nowIso;
      return { ...withdrawal };
    });
  }

  async failWithdrawal(withdrawalId: string, reason: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (!['requested', 'approved', 'broadcasted'].includes(withdrawal.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal cannot be failed in current state');
      }

      const account = this.getMutableAccount(withdrawal.userId, nowIso);
      if (account.lockedBalance < withdrawal.amount) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'locked balance underflow');
      }

      account.lockedBalance -= withdrawal.amount;
      account.balance += withdrawal.amount;
      account.updatedAt = nowIso;

      const tx = this.transactions.get(withdrawal.ledgerTxId);
      if (!tx) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'withdraw transaction missing');
      }
      tx.status = 'failed';

      withdrawal.status = 'failed';
      withdrawal.failedAt = nowIso;
      withdrawal.failReason = reason;
      return { ...withdrawal };
    });
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined> {
    const withdrawal = this.withdrawals.get(withdrawalId);
    return withdrawal ? { ...withdrawal } : undefined;
  }

  async listWithdrawalsByStatuses(statuses: WithdrawalStatus[]): Promise<Withdrawal[]> {
    const statusSet = new Set(statuses);
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => statusSet.has(withdrawal.status))
      .map((withdrawal) => ({ ...withdrawal }));
  }

  async listStuckWithdrawals(timeoutSec: number, nowIso = new Date().toISOString()): Promise<Withdrawal[]> {
    const threshold = new Date(nowIso).getTime() - timeoutSec * 1000;
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => ['requested', 'approved', 'broadcasted'].includes(withdrawal.status))
      .filter((withdrawal) => new Date(withdrawal.createdAt).getTime() <= threshold)
      .map((withdrawal) => ({ ...withdrawal }));
  }

  async enqueueJob(type: TxJob['type'], payload: Record<string, string>, nowIso = new Date().toISOString()): Promise<TxJob> {
    return this.withLock(() => {
      const job: TxJob = {
        jobId: randomUUID(),
        type,
        payload,
        status: 'pending',
        retryCount: 0,
        createdAt: nowIso
      };
      this.jobs.set(job.jobId, job);
      return { ...job };
    });
  }

  private getMutableWithdrawal(withdrawalId: string): Withdrawal {
    const withdrawal = this.withdrawals.get(withdrawalId);
    if (!withdrawal) {
      throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
    }
    return withdrawal;
  }

  private getMutableAccount(userId: string, nowIso: string): Account {
    const existing = this.accounts.get(userId);
    if (existing) {
      return existing;
    }
    const created = this.createEmptyAccount(userId, nowIso);
    this.accounts.set(userId, created);
    return created;
  }

  private createEmptyAccount(userId: string, nowIso = new Date().toISOString()): Account {
    const binding = this.walletBindingsByUserId.get(userId);
    return {
      userId,
      walletAddress: binding?.walletAddress,
      balance: 0n,
      lockedBalance: 0n,
      updatedAt: nowIso
    };
  }

  private enrichAccount(account: Account): Account {
    const binding = this.walletBindingsByUserId.get(account.userId);
    return {
      ...account,
      walletAddress: binding?.walletAddress
    };
  }

  private getDailyRequestedWithdrawalAmount(userId: string, nowIso: string): bigint {
    const day = nowIso.slice(0, 10);
    const amounts = Array.from(this.withdrawals.values())
      .filter((withdrawal) => withdrawal.userId === userId)
      .filter((withdrawal) => withdrawal.createdAt.slice(0, 10) === day)
      .filter((withdrawal) => ['requested', 'approved', 'broadcasted', 'confirmed'].includes(withdrawal.status))
      .map((withdrawal) => withdrawal.amount);

    return sumBigInt(amounts);
  }

  private async withLock<T>(work: () => T): Promise<T> {
    const run = this.lock.then(work, work);
    this.lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
