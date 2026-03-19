import { randomUUID } from 'node:crypto';
import { DomainError } from '../core/domain-error.js';
import { sumBigInt } from '../core/money.js';
import { buildDepositStateChangedContract, buildWithdrawalStateChangedContract } from '../contracts/ledger-contracts.js';
import type {
  Account,
  ApprovalDecisionResult,
  AuditLog,
  Deposit,
  DepositApplyResult,
  EventConsumerAttempt,
  EventConsumerCheckpoint,
  EventConsumerDeadLetter,
  LedgerSummary,
  LedgerTransaction,
  NetworkFeeDailySnapshot,
  NetworkFeeReceipt,
  OutboxEvent,
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
  'LEDGER_RESERVED',
  'PENDING_ADMIN',
  'ADMIN_APPROVED',
  'TX_BROADCASTED'
];

const DAILY_LIMIT_WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  ...ACTIVE_WITHDRAWAL_STATUSES,
  'COMPLETED'
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
  private readonly networkFeeReceipts = new Map<string, NetworkFeeReceipt>();
  private readonly networkFeeJournals = new Map<
    string,
    {
      snapshotDate: string;
      referenceType: 'withdrawal' | 'sweep';
      feeSun: bigint;
      createdAt: string;
    }
  >();
  private readonly outboxEvents = new Map<string, OutboxEvent>();
  private readonly eventConsumerAttempts = new Map<string, EventConsumerAttempt>();
  private readonly eventConsumerDeadLetters = new Map<string, EventConsumerDeadLetter>();
  private readonly eventConsumerCheckpoints = new Map<string, EventConsumerCheckpoint>();

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
    toAddress?: string;
    walletAddress?: string;
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
        status: 'CREDITED',
        blockNumber: input.blockNumber,
        createdAt: nowIso
      };

      this.depositsByTxHash.set(input.txHash, deposit);
      this.enqueueOutboxEvent({
        eventType: 'deposit.state.changed',
        aggregateType: 'deposit',
        aggregateId: deposit.depositId,
        payload: buildDepositStateChangedContract({
          depositId: deposit.depositId,
          userId: deposit.userId,
          walletAddress: input.walletAddress ?? input.toAddress ?? '',
          txHash: deposit.txHash,
          toAddress: input.toAddress ?? '',
          status: deposit.status,
          amount: deposit.amount,
          blockNumber: deposit.blockNumber,
          occurredAt: deposit.createdAt
        }),
        occurredAt: deposit.createdAt
      });
      return { deposit: { ...deposit }, duplicated: false };
    });
  }

  async completeDeposit(depositId: string, _nowIso = new Date().toISOString()): Promise<Deposit> {
    return this.withLock(() => {
      const deposit = Array.from(this.depositsByTxHash.values()).find((item) => item.depositId === depositId);
      if (!deposit) {
        throw new DomainError(404, 'NOT_FOUND', 'deposit not found');
      }
      if (deposit.status === 'COMPLETED') {
        return { ...deposit };
      }
      deposit.status = 'COMPLETED';
      return { ...deposit };
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
        status: 'LEDGER_RESERVED',
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
      this.enqueueOutboxEvent({
        eventType: 'withdrawal.state.changed',
        aggregateType: 'withdrawal',
        aggregateId: withdrawal.withdrawalId,
        payload: buildWithdrawalStateChangedContract(this.cloneWithdrawal(withdrawal), withdrawal.createdAt),
        occurredAt: withdrawal.createdAt
      });

      return { withdrawal: this.cloneWithdrawal(withdrawal), duplicated: false };
    });
  }

  async confirmWithdrawalExternalAuth(
    withdrawalId: string,
    input: { provider: string; requestId: string },
    nowIso = new Date().toISOString()
  ): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status === 'LEDGER_RESERVED') {
        withdrawal.status = 'PENDING_ADMIN';
        withdrawal.externalAuthProvider = input.provider;
        withdrawal.externalAuthRequestId = input.requestId;
        withdrawal.externalAuthConfirmedAt = nowIso;
        this.enqueueOutboxEvent({
          eventType: 'withdrawal.state.changed',
          aggregateType: 'withdrawal',
          aggregateId: withdrawalId,
          payload: buildWithdrawalStateChangedContract(this.cloneWithdrawal(withdrawal), nowIso),
          occurredAt: nowIso
        });
        return this.cloneWithdrawal(withdrawal);
      }

      if (withdrawal.externalAuthRequestId === input.requestId && withdrawal.externalAuthProvider === input.provider) {
        return this.cloneWithdrawal(withdrawal);
      }

      throw new DomainError(409, 'INVALID_STATE', 'withdrawal external auth cannot be confirmed in current state');
    });
  }

  async markWithdrawalReviewRequired(withdrawalId: string, _note: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status !== 'PENDING_ADMIN') {
        return this.cloneWithdrawal(withdrawal);
      }
      withdrawal.reviewRequiredAt = nowIso;
      return this.cloneWithdrawal(withdrawal);
    });
  }

  async approveWithdrawal(
    withdrawalId: string,
    input: {
      adminId: string;
      actorType: 'admin' | 'system';
      reasonCode?: 'manual_review_passed' | 'high_value_verified' | 'trusted_destination_verified' | 'account_activity_verified' | 'ops_override';
      note?: string;
    },
    nowIso = new Date().toISOString()
  ): Promise<ApprovalDecisionResult> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status !== 'PENDING_ADMIN') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be pending admin approval');
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
        reasonCode: input.reasonCode ?? 'manual_review_passed',
        note: input.note,
        createdAt: nowIso
      };

      approvals.push(approval);
      this.approvalsByWithdrawalId.set(withdrawalId, approvals);

      withdrawal.approvalCount = approvals.length;
      const finalized = approvals.length >= withdrawal.requiredApprovals;
      if (finalized) {
        withdrawal.status = 'ADMIN_APPROVED';
        withdrawal.approvedAt = nowIso;
      }
      this.enqueueOutboxEvent({
        eventType: 'withdrawal.state.changed',
        aggregateType: 'withdrawal',
        aggregateId: withdrawalId,
        payload: buildWithdrawalStateChangedContract(this.cloneWithdrawal(withdrawal), approval.createdAt),
        occurredAt: approval.createdAt
      });

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
      if (withdrawal.status !== 'ADMIN_APPROVED') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be admin approved');
      }
      withdrawal.status = 'TX_BROADCASTED';
      withdrawal.txHash = txHash;
      withdrawal.broadcastedAt = nowIso;
      this.enqueueOutboxEvent({
        eventType: 'withdrawal.state.changed',
        aggregateType: 'withdrawal',
        aggregateId: withdrawalId,
        payload: buildWithdrawalStateChangedContract(this.cloneWithdrawal(withdrawal), nowIso),
        occurredAt: nowIso
      });
      return this.cloneWithdrawal(withdrawal);
    });
  }

  async confirmWithdrawal(
    withdrawalId: string,
    input?: { networkFee?: { txHash: string; feeSun: bigint; energyUsed: number; bandwidthUsed: number } },
    nowIso = new Date().toISOString()
  ): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (withdrawal.status !== 'TX_BROADCASTED') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be tx broadcasted');
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

      withdrawal.status = 'COMPLETED';
      withdrawal.confirmedAt = nowIso;
      if (input?.networkFee && withdrawal.txHash) {
        const feeReceiptId = `${withdrawalId}:${withdrawal.txHash}`;
        this.networkFeeReceipts.set(feeReceiptId, {
          feeReceiptId,
          referenceType: 'withdrawal',
          referenceId: withdrawalId,
          txHash: input.networkFee.txHash,
          currencyCode: 'TRX',
          feeSun: input.networkFee.feeSun,
          energyUsed: input.networkFee.energyUsed,
          bandwidthUsed: input.networkFee.bandwidthUsed,
          confirmedAt: nowIso,
          createdAt: nowIso
        });
        this.networkFeeJournals.set(feeReceiptId, {
          snapshotDate: nowIso.slice(0, 10),
          referenceType: 'withdrawal',
          feeSun: input.networkFee.feeSun,
          createdAt: nowIso
        });
      }
      this.enqueueOutboxEvent({
        eventType: 'withdrawal.state.changed',
        aggregateType: 'withdrawal',
        aggregateId: withdrawalId,
        payload: buildWithdrawalStateChangedContract(this.cloneWithdrawal(withdrawal), nowIso),
        occurredAt: nowIso
      });
      return this.cloneWithdrawal(withdrawal);
    });
  }

  async failWithdrawal(withdrawalId: string, reason: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withLock(() => {
      const withdrawal = this.getMutableWithdrawal(withdrawalId);
      if (!['LEDGER_RESERVED', 'PENDING_ADMIN', 'ADMIN_APPROVED', 'TX_BROADCASTED'].includes(withdrawal.status)) {
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

      withdrawal.status = 'FAILED';
      withdrawal.failedAt = nowIso;
      withdrawal.failReason = reason;
      this.enqueueOutboxEvent({
        eventType: 'withdrawal.state.changed',
        aggregateType: 'withdrawal',
        aggregateId: withdrawalId,
        payload: buildWithdrawalStateChangedContract(this.cloneWithdrawal(withdrawal), nowIso),
        occurredAt: nowIso
      });
      return this.cloneWithdrawal(withdrawal);
    });
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined> {
    const withdrawal = this.withdrawals.get(withdrawalId);
    return withdrawal ? this.cloneWithdrawal(withdrawal) : undefined;
  }

  async listWithdrawalsByUser(userId: string, limit = 50): Promise<Withdrawal[]> {
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => withdrawal.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((withdrawal) => this.cloneWithdrawal(withdrawal));
  }

  async listWithdrawalsByStatuses(statuses: WithdrawalStatus[]): Promise<Withdrawal[]> {
    const statusSet = new Set(statuses);
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => statusSet.has(withdrawal.status))
      .map((withdrawal) => this.cloneWithdrawal(withdrawal));
  }

  async listPendingApprovalWithdrawals(): Promise<Withdrawal[]> {
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) => withdrawal.status === 'PENDING_ADMIN')
      .filter((withdrawal) => withdrawal.approvalCount < withdrawal.requiredApprovals)
      .map((withdrawal) => this.cloneWithdrawal(withdrawal));
  }

  async listWithdrawalApprovals(withdrawalId: string): Promise<WithdrawalApproval[]> {
    return (this.approvalsByWithdrawalId.get(withdrawalId) ?? []).map((approval) => ({ ...approval }));
  }

  async listStuckWithdrawals(timeoutSec: number, nowIso = new Date().toISOString()): Promise<Withdrawal[]> {
    const threshold = new Date(nowIso).getTime() - timeoutSec * 1000;
    return Array.from(this.withdrawals.values())
      .filter((withdrawal) =>
        ['LEDGER_RESERVED', 'PENDING_ADMIN', 'ADMIN_APPROVED', 'TX_BROADCASTED'].includes(withdrawal.status)
      )
      .filter((withdrawal) => new Date(withdrawal.createdAt).getTime() <= threshold)
      .map((withdrawal) => this.cloneWithdrawal(withdrawal));
  }

  async listDepositsByUser(userId: string, limit = 50): Promise<Deposit[]> {
    return Array.from(this.depositsByTxHash.values())
      .filter((deposit) => deposit.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((deposit) => ({ ...deposit }));
  }

  async listTransactionsByUser(
    userId: string,
    input: { types?: LedgerTransaction['type'][]; limit?: number } = {}
  ): Promise<LedgerTransaction[]> {
    const typeSet = input.types ? new Set(input.types) : undefined;
    return Array.from(this.transactions.values())
      .filter((transaction) => transaction.userId === userId)
      .filter((transaction) => (typeSet ? typeSet.has(transaction.type) : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 50)
      .map((transaction) => ({ ...transaction }));
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

  async claimPendingJobs(types: TxJob['type'][], limit: number): Promise<TxJob[]> {
    return this.withLock(() => {
      if (!types.length || limit <= 0) {
        return [];
      }

      const claimed = Array.from(this.jobs.values())
        .filter((job) => job.status === 'pending' && types.includes(job.type))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit);

      for (const job of claimed) {
        job.status = 'running';
      }

      return claimed.map((job) => ({ ...job, payload: { ...job.payload } }));
    });
  }

  async markJobDone(jobId: string): Promise<void> {
    this.withLock(() => {
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = 'done';
      }
    });
  }

  async markJobFailed(jobId: string): Promise<void> {
    this.withLock(() => {
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = 'failed';
      }
    });
  }

  async retryJob(jobId: string): Promise<TxJob | undefined> {
    return this.withLock(() => {
      const job = this.jobs.get(jobId);
      if (!job) {
        return undefined;
      }
      job.retryCount += 1;
      job.status = 'pending';
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
    actorId?: string;
    action?: string;
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
  }): Promise<AuditLog[]> {
    const limit = input?.limit ?? 100;
    return Array.from(this.auditLogs.values())
      .filter((log) => (input?.entityType ? log.entityType === input.entityType : true))
      .filter((log) => (input?.entityId ? log.entityId === input.entityId : true))
      .filter((log) => (input?.actorId ? log.actorId === input.actorId : true))
      .filter((log) => (input?.action ? log.action === input.action : true))
      .filter((log) => (input?.createdFrom ? log.createdAt >= input.createdFrom : true))
      .filter((log) => (input?.createdTo ? log.createdAt <= input.createdTo : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((log) => ({ ...log, metadata: { ...log.metadata } }));
  }

  async createSweepRecord(input: {
    sourceWalletCode: string;
    sourceAddress: string;
    targetAddress: string;
    currencyId?: number;
    network?: 'mainnet' | 'testnet';
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
        currencyId: input.currencyId,
        network: input.network,
        amount: input.amount,
        status: 'planned',
        externalRef: input.externalRef,
        note: input.note,
        attemptCount: 0,
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

  async listSweepRecordsByStatuses(statuses: SweepRecord['status'][], limit = 100): Promise<SweepRecord[]> {
    const statusSet = new Set(statuses);
    return Array.from(this.sweepRecords.values())
      .filter((sweep) => statusSet.has(sweep.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((sweep) => this.cloneSweep(sweep));
  }

  async findSweepByExternalRef(externalRef: string): Promise<SweepRecord | undefined> {
    const found = Array.from(this.sweepRecords.values()).find((sweep) => sweep.externalRef === externalRef);
    return found ? this.cloneSweep(found) : undefined;
  }

  async markSweepQueued(sweepId: string, note?: string, _nowIso = new Date().toISOString()): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep = this.getMutableSweep(sweepId);
      if (sweep.status !== 'planned') {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned');
      }
      sweep.status = 'queued';
      sweep.note = note ?? sweep.note;
      sweep.queuedAt = sweep.queuedAt ?? _nowIso;
      return this.cloneSweep(sweep);
    });
  }

  async recordSweepAttempt(sweepId: string, note?: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep = this.getMutableSweep(sweepId);
      if (sweep.status !== 'queued') {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be queued');
      }
      sweep.attemptCount += 1;
      sweep.lastAttemptAt = nowIso;
      sweep.note = note ?? sweep.note;
      return this.cloneSweep(sweep);
    });
  }

  async markSweepBroadcasted(sweepId: string, txHash: string, note?: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep = this.getMutableSweep(sweepId);
      if (!['planned', 'queued'].includes(sweep.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned or queued');
      }
      sweep.status = 'broadcasted';
      sweep.txHash = txHash;
      sweep.note = note ?? sweep.note;
      sweep.broadcastedAt = nowIso;
      return this.cloneSweep(sweep);
    });
  }

  async confirmSweep(
    sweepId: string,
    input?: string | { note?: string; networkFee?: { txHash: string; feeSun: bigint; energyUsed: number; bandwidthUsed: number } },
    nowIso = new Date().toISOString()
  ): Promise<SweepRecord> {
    return this.withLock(() => {
      const payload = typeof input === 'string' ? { note: input } : input;
      const sweep = this.getMutableSweep(sweepId);
      if (!['planned', 'broadcasted'].includes(sweep.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned or broadcasted');
      }
      sweep.status = 'confirmed';
      sweep.note = payload?.note ?? sweep.note;
      sweep.confirmedAt = nowIso;
      if (payload?.networkFee && sweep.txHash) {
        const feeReceiptId = `${sweepId}:${sweep.txHash}`;
        this.networkFeeReceipts.set(feeReceiptId, {
          feeReceiptId,
          referenceType: 'sweep',
          referenceId: sweepId,
          txHash: payload.networkFee.txHash,
          currencyCode: 'TRX',
          feeSun: payload.networkFee.feeSun,
          energyUsed: payload.networkFee.energyUsed,
          bandwidthUsed: payload.networkFee.bandwidthUsed,
          confirmedAt: nowIso,
          createdAt: nowIso
        });
        this.networkFeeJournals.set(feeReceiptId, {
          snapshotDate: nowIso.slice(0, 10),
          referenceType: 'sweep',
          feeSun: payload.networkFee.feeSun,
          createdAt: nowIso
        });
      }
      return this.cloneSweep(sweep);
    });
  }

  async failSweep(sweepId: string, reason: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    return this.withLock(() => {
      const sweep = this.getMutableSweep(sweepId);
      if (!['planned', 'queued', 'broadcasted'].includes(sweep.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned, queued or broadcasted');
      }
      sweep.status = 'failed';
      sweep.note = reason;
      sweep.confirmedAt = nowIso;
      return this.cloneSweep(sweep);
    });
  }

  async listNetworkFeeReceipts(input: {
    referenceType?: NetworkFeeReceipt['referenceType'];
    referenceId?: string;
    limit?: number;
  } = {}): Promise<NetworkFeeReceipt[]> {
    return Array.from(this.networkFeeReceipts.values())
      .filter((item) => (input.referenceType ? item.referenceType === input.referenceType : true))
      .filter((item) => (input.referenceId ? item.referenceId === input.referenceId : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100)
      .map((item) => ({ ...item }));
  }

  async listNetworkFeeDailySnapshots(input: { days?: number } = {}): Promise<NetworkFeeDailySnapshot[]> {
    const dayLimit = input.days ?? 7;
    const actualByDate = new Map<string, NetworkFeeDailySnapshot>();

    const ensureSnapshot = (snapshotDate: string) => {
      const existing = actualByDate.get(snapshotDate);
      if (existing) {
        return existing;
      }
      const created: NetworkFeeDailySnapshot = {
        snapshotDate,
        currencyCode: 'TRX',
        ledgerFeeSun: 0n,
        actualFeeSun: 0n,
        gapFeeSun: 0n,
        ledgerFeeCount: 0,
        actualFeeCount: 0,
        byReferenceType: {
          withdrawal: {
            ledgerFeeSun: 0n,
            actualFeeSun: 0n,
            ledgerFeeCount: 0,
            actualFeeCount: 0
          },
          sweep: {
            ledgerFeeSun: 0n,
            actualFeeSun: 0n,
            ledgerFeeCount: 0,
            actualFeeCount: 0
          }
        }
      };
      actualByDate.set(snapshotDate, created);
      return created;
    };

    for (const receipt of this.networkFeeReceipts.values()) {
      const snapshot = ensureSnapshot(receipt.confirmedAt.slice(0, 10));
      snapshot.actualFeeSun += receipt.feeSun;
      snapshot.actualFeeCount += 1;
      snapshot.byReferenceType[receipt.referenceType].actualFeeSun += receipt.feeSun;
      snapshot.byReferenceType[receipt.referenceType].actualFeeCount += 1;
    }

    for (const journal of this.networkFeeJournals.values()) {
      const snapshot = ensureSnapshot(journal.snapshotDate);
      snapshot.ledgerFeeSun += journal.feeSun;
      snapshot.ledgerFeeCount += 1;
      snapshot.byReferenceType[journal.referenceType].ledgerFeeSun += journal.feeSun;
      snapshot.byReferenceType[journal.referenceType].ledgerFeeCount += 1;
    }

    return Array.from(actualByDate.values())
      .map((item) => ({
        ...item,
        gapFeeSun: item.actualFeeSun - item.ledgerFeeSun
      }))
      .sort((left, right) => right.snapshotDate.localeCompare(left.snapshotDate))
      .slice(0, dayLimit);
  }

  async claimPendingOutboxEvents(limit: number, nowIso = new Date().toISOString()): Promise<OutboxEvent[]> {
    return this.withLock(() => {
      const claimed = Array.from(this.outboxEvents.values())
        .filter((event) => event.status === 'pending' && event.availableAt <= nowIso)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit);

      for (const event of claimed) {
        event.status = 'processing';
        event.attempts += 1;
        event.processingStartedAt = nowIso;
      }

      return claimed.map((event) => ({ ...event, payload: { ...event.payload } }));
    });
  }

  async markOutboxEventPublished(outboxEventId: string, nowIso = new Date().toISOString()): Promise<void> {
    await this.withLock(() => {
      const event = this.outboxEvents.get(outboxEventId);
      if (!event) {
        return;
      }
      event.status = 'published';
      event.processingStartedAt = undefined;
      event.publishedAt = nowIso;
      event.deadLetteredAt = undefined;
      event.lastError = undefined;
    });
  }

  async rescheduleOutboxEvent(outboxEventId: string, error: string, availableAt: string): Promise<void> {
    await this.withLock(() => {
      const event = this.outboxEvents.get(outboxEventId);
      if (!event) {
        return;
      }
      event.status = 'pending';
      event.availableAt = availableAt;
      event.processingStartedAt = undefined;
      event.lastError = error;
    });
  }

  async deadLetterOutboxEvent(outboxEventId: string, error: string, deadLetteredAt = new Date().toISOString()): Promise<void> {
    await this.withLock(() => {
      const event = this.outboxEvents.get(outboxEventId);
      if (!event) {
        return;
      }
      event.status = 'dead_lettered';
      event.processingStartedAt = undefined;
      event.deadLetteredAt = deadLetteredAt;
      event.deadLetterAcknowledgedAt = undefined;
      event.deadLetterAcknowledgedBy = undefined;
      event.deadLetterNote = undefined;
      event.deadLetterCategory = undefined;
      event.incidentRef = undefined;
      event.lastError = error;
    });
  }

  async listOutboxEvents(input: { status?: OutboxEvent['status']; limit?: number } = {}): Promise<OutboxEvent[]> {
    return Array.from(this.outboxEvents.values())
      .filter((event) => (input.status ? event.status === input.status : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100)
      .map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async getOutboxEventSummary() {
    const events = Array.from(this.outboxEvents.values());
    return {
      pendingCount: events.filter((event) => event.status === 'pending').length,
      processingCount: events.filter((event) => event.status === 'processing').length,
      publishedCount: events.filter((event) => event.status === 'published').length,
      deadLetteredCount: events.filter((event) => event.status === 'dead_lettered').length,
      deadLetterAcknowledgedCount: events.filter((event) => event.status === 'dead_lettered' && event.deadLetterAcknowledgedAt).length,
      deadLetterUnacknowledgedCount: events.filter((event) => event.status === 'dead_lettered' && !event.deadLetterAcknowledgedAt).length,
      oldestPendingCreatedAt: events
        .filter((event) => event.status === 'pending')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]?.createdAt,
      oldestDeadLetteredAt: events
        .filter((event) => event.status === 'dead_lettered')
        .sort((left, right) => (left.deadLetteredAt ?? '').localeCompare(right.deadLetteredAt ?? ''))[0]?.deadLetteredAt
    };
  }

  async replayOutboxEvents(input: {
    outboxEventIds?: string[];
    status?: OutboxEvent['status'];
    limit?: number;
    nowIso?: string;
  }): Promise<number> {
    const nowIso = input.nowIso ?? new Date().toISOString();
    return this.withLock(() => {
      const idSet = input.outboxEventIds ? new Set(input.outboxEventIds) : undefined;
      const candidates = Array.from(this.outboxEvents.values())
        .filter((event) => (input.status ? event.status === input.status : true))
        .filter((event) => (idSet ? idSet.has(event.outboxEventId) : true))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, input.limit ?? (idSet?.size ?? 100));

      for (const event of candidates) {
        event.status = 'pending';
        event.availableAt = nowIso;
        event.processingStartedAt = undefined;
        event.deadLetteredAt = undefined;
        event.deadLetterAcknowledgedAt = undefined;
        event.deadLetterAcknowledgedBy = undefined;
        event.deadLetterNote = undefined;
        event.deadLetterCategory = undefined;
        event.incidentRef = undefined;
      }

      return candidates.length;
    });
  }

  async recoverStaleProcessingOutboxEvents(timeoutSec: number, nowIso = new Date().toISOString()): Promise<number> {
    const threshold = new Date(Date.parse(nowIso) - timeoutSec * 1000).toISOString();
    return this.withLock(() => {
      const candidates = Array.from(this.outboxEvents.values()).filter(
        (event) => event.status === 'processing' && event.processingStartedAt && event.processingStartedAt <= threshold
      );

      for (const event of candidates) {
        event.status = 'pending';
        event.availableAt = nowIso;
        event.processingStartedAt = undefined;
        event.lastError = event.lastError ?? 'processing timeout recovered';
      }

      return candidates.length;
    });
  }

  async acknowledgeDeadLetterOutboxEvents(input: {
    outboxEventIds?: string[];
    limit?: number;
    actorId: string;
    note?: string;
    category?: OutboxEvent['deadLetterCategory'];
    incidentRef?: string;
    nowIso?: string;
  }): Promise<number> {
    const nowIso = input.nowIso ?? new Date().toISOString();
    return this.withLock(() => {
      const idSet = input.outboxEventIds ? new Set(input.outboxEventIds) : undefined;
      const candidates = Array.from(this.outboxEvents.values())
        .filter((event) => event.status === 'dead_lettered')
        .filter((event) => !event.deadLetterAcknowledgedAt)
        .filter((event) => (idSet ? idSet.has(event.outboxEventId) : true))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, input.limit ?? (idSet?.size ?? 100));

      for (const event of candidates) {
        event.deadLetterAcknowledgedAt = nowIso;
        event.deadLetterAcknowledgedBy = input.actorId;
        event.deadLetterNote = input.note;
        event.deadLetterCategory = input.category;
        event.incidentRef = input.incidentRef;
      }

      return candidates.length;
    });
  }

  async appendEventConsumerAttempt(input: {
    eventKey: string;
    eventType: string;
    consumerName: string;
    status: EventConsumerAttempt['status'];
    attemptNumber: number;
    aggregateId?: string;
    errorMessage?: string;
    durationMs: number;
    nowIso?: string;
  }): Promise<EventConsumerAttempt> {
    return this.withLock(() => {
      const attempt: EventConsumerAttempt = {
        attemptId: randomUUID(),
        eventKey: input.eventKey,
        eventType: input.eventType,
        consumerName: input.consumerName,
        status: input.status,
        attemptNumber: input.attemptNumber,
        aggregateId: input.aggregateId,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
        createdAt: input.nowIso ?? new Date().toISOString()
      };
      this.eventConsumerAttempts.set(attempt.attemptId, attempt);
      return { ...attempt };
    });
  }

  async appendEventConsumerDeadLetter(input: {
    eventKey: string;
    eventType: string;
    consumerName: string;
    aggregateId?: string;
    payload: Record<string, unknown>;
    errorMessage: string;
    nowIso?: string;
  }): Promise<EventConsumerDeadLetter> {
    return this.withLock(() => {
      const deadLetter: EventConsumerDeadLetter = {
        deadLetterId: randomUUID(),
        eventKey: input.eventKey,
        eventType: input.eventType,
        consumerName: input.consumerName,
        aggregateId: input.aggregateId,
        payload: { ...input.payload },
        errorMessage: input.errorMessage,
        failedAt: input.nowIso ?? new Date().toISOString()
      };
      this.eventConsumerDeadLetters.set(deadLetter.deadLetterId, deadLetter);
      return { ...deadLetter, payload: { ...deadLetter.payload } };
    });
  }

  async listEventConsumerAttempts(input: {
    consumerName?: string;
    eventType?: string;
    status?: EventConsumerAttempt['status'];
    limit?: number;
  } = {}): Promise<EventConsumerAttempt[]> {
    return Array.from(this.eventConsumerAttempts.values())
      .filter((item) => (input.consumerName ? item.consumerName === input.consumerName : true))
      .filter((item) => (input.eventType ? item.eventType === input.eventType : true))
      .filter((item) => (input.status ? item.status === input.status : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100)
      .map((item) => ({ ...item }));
  }

  async listEventConsumerDeadLetters(input: {
    consumerName?: string;
    eventType?: string;
    limit?: number;
  } = {}): Promise<EventConsumerDeadLetter[]> {
    return Array.from(this.eventConsumerDeadLetters.values())
      .filter((item) => (input.consumerName ? item.consumerName === input.consumerName : true))
      .filter((item) => (input.eventType ? item.eventType === input.eventType : true))
      .sort((left, right) => right.failedAt.localeCompare(left.failedAt))
      .slice(0, input.limit ?? 100)
      .map((item) => ({ ...item, payload: { ...item.payload } }));
  }

  async hasSucceededEventConsumerCheckpoint(input: { consumerName: string; eventKey: string }): Promise<boolean> {
    const checkpoint = this.eventConsumerCheckpoints.get(`${input.consumerName}:${input.eventKey}`);
    return checkpoint?.lastStatus === 'succeeded';
  }

  async upsertEventConsumerCheckpoint(input: {
    consumerName: string;
    eventKey: string;
    eventType: string;
    aggregateId?: string;
    lastStatus: EventConsumerCheckpoint['lastStatus'];
    nowIso?: string;
  }): Promise<void> {
    await this.withLock(() => {
      const key = `${input.consumerName}:${input.eventKey}`;
      const nowIso = input.nowIso ?? new Date().toISOString();
      const existing = this.eventConsumerCheckpoints.get(key);
      this.eventConsumerCheckpoints.set(key, {
        consumerName: input.consumerName,
        eventKey: input.eventKey,
        eventType: input.eventType,
        aggregateId: input.aggregateId,
        lastStatus: input.lastStatus,
        firstProcessedAt: existing?.firstProcessedAt ?? nowIso,
        lastProcessedAt: nowIso
      });
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

  async rebuildAccountProjections(): Promise<{ accountCount: number }> {
    return {
      accountCount: this.accounts.size
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
      .filter((withdrawal) => DAILY_LIMIT_WITHDRAWAL_STATUSES.includes(withdrawal.status))
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

  private enqueueOutboxEvent(input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }) {
    const outboxEventId = randomUUID();
    this.outboxEvents.set(outboxEventId, {
      outboxEventId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: { ...input.payload },
      status: 'pending',
      attempts: 0,
      availableAt: input.occurredAt,
      createdAt: input.occurredAt,
      processingStartedAt: undefined,
      deadLetterAcknowledgedAt: undefined,
      deadLetterAcknowledgedBy: undefined,
      deadLetterNote: undefined,
      deadLetterCategory: undefined,
      incidentRef: undefined
    });
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
