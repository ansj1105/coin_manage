import { randomUUID } from 'node:crypto';
import { DomainError } from '../core/domain-error.js';
import { sumBigInt } from '../core/money.js';
import type {
  Account,
  ApprovalDecisionResult,
  AuditLog,
  Deposit,
  DepositApplyResult,
  LedgerSummary,
  LedgerTransaction,
  SweepRecord,
  TransferResult,
  TxJob,
  WalletBinding,
  Withdrawal,
  WithdrawalApproval,
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

const ACTIVE_WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  'requested',
  'review_required',
  'approved',
  'broadcasted',
  'confirmed'
];

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
  private readonly approvalsByWithdrawalId = new Map<string, WithdrawalApproval[]>();
  private readonly auditLogs = new Map<string, AuditLog>();
  private readonly sweepRecords = new Map<string, SweepRecord>();

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
    riskLevel?: Withdrawal['riskLevel'];
    riskScore?: number;
    riskFlags?: string[];
    requiredApprovals?: number;
    clientIp?: string;
    deviceId?: string;
    nowIso?: string;
  }): Promise<WithdrawalRequestResult> {
    return this.withLock(() => {
      const existingId = this.withdrawalByIdempotencyKey.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.withdrawals.get(existingId);
        if (!existing) {
          throw new DomainError(500, 'STATE_CORRUPTED', 'withdraw idempotency state is invalid');
        }
        return { withdrawal: this.cloneWithdrawal(existing), duplicated: true };
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
        createdAt: nowIso,
        riskLevel: input.riskLevel ?? 'low',
        riskScore: input.riskScore ?? 0,
        riskFlags: [...(input.riskFlags ?? [])],
        requiredApprovals: input.requiredApprovals ?? 1,
        approvalCount: 0,
        clientIp: input.clientIp,
        deviceId: input.deviceId
      };

      this.withdrawals.set(withdrawal.withdrawalId, withdrawal);
      this.withdrawalByIdempotencyKey.set(input.idempotencyKey, withdrawal.withdrawalId);
      this.approvalsByWithdrawalId.set(withdrawal.withdrawalId, []);

      return { withdrawal: this.cloneWithdrawal(withdrawal), duplicated: false };
    });
  }

  async markWithdrawalReviewRequired(withdrawalId: string, _note: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status !== 'requested') {
        return this.cloneWithdrawal(withdrawal);
      }
      withdrawal.status = 'review_required';
      withdrawal.reviewRequiredAt = nowIso;
      return this.cloneWithdrawal(withdrawal);
    });
  }

  async approveWithdrawal(
    withdrawalId: string,
    input: { adminId: string; actorType: 'admin' | 'system'; note?: string },
    nowIso = new Date().toISOString()
  ): Promise<ApprovalDecisionResult> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (!['requested', 'review_required'].includes(withdrawal.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be requested or review_required');
      }

      const approvals = this.approvalsByWithdrawalId.get(withdrawalId) ?? [];
      if (approvals.some((approval) => approval.adminId === input.adminId)) {
        throw new DomainError(409, 'ALREADY_APPROVED', 'admin already approved this withdrawal');
      }

      const approval: WithdrawalApproval = {
        approvalId: randomUUID(),
        withdrawalId,
        adminId: input.adminId,
        actorType: input.actorType,
        note: input.note,
        createdAt: nowIso
      };

      approvals.push(approval);
      this.approvalsByWithdrawalId.set(withdrawalId, approvals);

      withdrawal.approvalCount = approvals.length;
      const finalized = approvals.length >= withdrawal.requiredApprovals;
      if (finalized) {
        withdrawal.status = 'approved';
        withdrawal.approvedAt = nowIso;
      }

      return {
        withdrawal: this.cloneWithdrawal(withdrawal),
        approval: { ...approval },
        finalized
      };
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
      return this.cloneWithdrawal(withdrawal);
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
      return this.cloneWithdrawal(withdrawal);
    });
  }

  async failWithdrawal(withdrawalId: string, reason: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (!['requested', 'review_required', 'approved', 'broadcasted'].includes(withdrawal.status)) {
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
      return this.cloneWithdrawal(withdrawal);
    });
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined> {
    const withdrawal = this.withdrawals.get(withdrawalId);
    return withdrawal ? this.cloneWithdrawal(withdrawal) : undefined;
  }

  async listWithdrawalsByStatuses(statuses: WithdrawalStatus[]): Promise<Withdrawal[]> {
    const statusSet = new Set(statuses);
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => statusSet.has(withdrawal.status))
      .map((withdrawal) => this.cloneWithdrawal(withdrawal));
  }

  async listPendingApprovalWithdrawals(): Promise<Withdrawal[]> {
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => ['requested', 'review_required'].includes(withdrawal.status))
      .filter((withdrawal) => withdrawal.approvalCount < withdrawal.requiredApprovals)
      .map((withdrawal) => this.cloneWithdrawal(withdrawal));
  }

  async listWithdrawalApprovals(withdrawalId: string): Promise<WithdrawalApproval[]> {
    return (this.approvalsByWithdrawalId.get(withdrawalId) ?? []).map((approval) => ({ ...approval }));
  }

  async listStuckWithdrawals(timeoutSec: number, nowIso = new Date().toISOString()): Promise<Withdrawal[]> {
    const threshold = new Date(nowIso).getTime() - timeoutSec * 1000;
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => ['requested', 'review_required', 'approved', 'broadcasted'].includes(withdrawal.status))
      .filter((withdrawal) => new Date(withdrawal.createdAt).getTime() <= threshold)
      .map((withdrawal) => this.cloneWithdrawal(withdrawal));
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
      return { ...job, payload: { ...job.payload } };
    });
  }

  async appendAuditLog(input: {
    entityType: AuditLog['entityType'];
    entityId: string;
    action: string;
    actorType: AuditLog['actorType'];
    actorId: string;
    metadata: Record<string, string>;
    nowIso?: string;
  }): Promise<AuditLog> {
    return this.withLock(() => {
      const log: AuditLog = {
        auditId: randomUUID(),
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        actorType: input.actorType,
        actorId: input.actorId,
        metadata: { ...input.metadata },
        createdAt: input.nowIso ?? new Date().toISOString()
      };
      this.auditLogs.set(log.auditId, log);
      return {
        ...log,
        metadata: { ...log.metadata }
      };
    });
  }

  async listAuditLogs(input?: {
    entityType?: AuditLog['entityType'];
    entityId?: string;
    limit?: number;
  }): Promise<AuditLog[]> {
    const limit = input?.limit ?? 100;
    return Array.from(this.auditLogs.values())
      .filter((log) => (input?.entityType ? log.entityType === input.entityType : true))
      .filter((log) => (input?.entityId ? log.entityId === input.entityId : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((log) => ({ ...log, metadata: { ...log.metadata } }));
  }

  async createSweepRecord(input: {
    sourceWalletCode: string;
    sourceAddress: string;
    targetAddress: string;
    amount: bigint;
    externalRef?: string;
    note?: string;
    nowIso?: string;
  }): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep: SweepRecord = {
        sweepId: randomUUID(),
        sourceWalletCode: input.sourceWalletCode,
        sourceAddress: input.sourceAddress,
        targetAddress: input.targetAddress,
        amount: input.amount,
        status: 'planned',
        externalRef: input.externalRef,
        note: input.note,
        createdAt: input.nowIso ?? new Date().toISOString()
      };
      this.sweepRecords.set(sweep.sweepId, sweep);
      return this.cloneSweep(sweep);
    });
  }

  async listSweepRecords(limit = 100): Promise<SweepRecord[]> {
    return Array.from(this.sweepRecords.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((sweep) => this.cloneSweep(sweep));
  }

  async findSweepByExternalRef(externalRef: string): Promise<SweepRecord | undefined> {
    const found = Array.from(this.sweepRecords.values()).find((sweep) => sweep.externalRef === externalRef);
    return found ? this.cloneSweep(found) : undefined;
  }

  async markSweepBroadcasted(sweepId: string, txHash: string, note?: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep = this.getMutableSweep(sweepId);
      if (sweep.status !== 'planned') {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned');
      }
      sweep.status = 'broadcasted';
      sweep.txHash = txHash;
      sweep.note = note ?? sweep.note;
      sweep.broadcastedAt = nowIso;
      return this.cloneSweep(sweep);
    });
  }

  async confirmSweep(sweepId: string, note?: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep = this.getMutableSweep(sweepId);
      if (!['planned', 'broadcasted'].includes(sweep.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned or broadcasted');
      }
      sweep.status = 'confirmed';
      sweep.note = note ?? sweep.note;
      sweep.confirmedAt = nowIso;
      return this.cloneSweep(sweep);
    });
  }

  async failSweep(sweepId: string, reason: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep = this.getMutableSweep(sweepId);
      if (!['planned', 'broadcasted'].includes(sweep.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned or broadcasted');
      }
      sweep.status = 'failed';
      sweep.note = reason;
      sweep.confirmedAt = nowIso;
      return this.cloneSweep(sweep);
    });
  }

  async getLedgerSummary(): Promise<LedgerSummary> {
    const accounts = Array.from(this.accounts.values());
    const availableBalance = sumBigInt(accounts.map((account) => account.balance));
    const lockedBalance = sumBigInt(accounts.map((account) => account.lockedBalance));

    return {
      accountCount: accounts.length,
      availableBalance,
      lockedBalance,
      liabilityBalance: availableBalance + lockedBalance,
      confirmedDepositCount: this.depositsByTxHash.size,
      activeWithdrawalCount: Array.from(this.withdrawals.values()).filter((withdrawal) =>
        ACTIVE_WITHDRAWAL_STATUSES.includes(withdrawal.status)
      ).length
    };
  }

  private getMutableWithdrawal(withdrawalId: string): Withdrawal {
    const withdrawal = this.withdrawals.get(withdrawalId);
    if (!withdrawal) {
      throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
    }
    return withdrawal;
  }

  private getMutableSweep(sweepId: string): SweepRecord {
    const sweep = this.sweepRecords.get(sweepId);
    if (!sweep) {
      throw new DomainError(404, 'NOT_FOUND', 'sweep not found');
    }
    return sweep;
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
      .filter((withdrawal) => ACTIVE_WITHDRAWAL_STATUSES.includes(withdrawal.status))
      .map((withdrawal) => withdrawal.amount);

    return sumBigInt(amounts);
  }

  private cloneWithdrawal(withdrawal: Withdrawal): Withdrawal {
    return {
      ...withdrawal,
      riskFlags: [...withdrawal.riskFlags]
    };
  }

  private cloneSweep(sweep: SweepRecord): SweepRecord {
    return { ...sweep };
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
