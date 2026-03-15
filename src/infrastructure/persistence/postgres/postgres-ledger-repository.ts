import { randomUUID } from 'node:crypto';
import { Kysely, sql, type Transaction } from 'kysely';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { formatKoriAmount, parseStoredKoriAmount } from '../../../domain/value-objects/money.js';
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
} from '../../../domain/ledger/types.js';
import type { LedgerRepository } from '../../../application/ports/ledger-repository.js';
import type { WithdrawalLimitConfig } from '../../../ledger/in-memory-ledger.js';
import type { KorionDatabase } from './db-schema.js';

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

type DbExecutor = Kysely<KorionDatabase> | Transaction<KorionDatabase>;

type LedgerPostingInput = {
  ledgerAccountCode: string;
  accountType: KorionDatabase['ledger_accounts']['account_type'];
  entrySide: KorionDatabase['ledger_postings']['entry_side'];
  amount: string;
};

export class PostgresLedgerRepository implements LedgerRepository {
  constructor(
    private readonly db: Kysely<KorionDatabase>,
    private readonly limits: WithdrawalLimitConfig
  ) {}

  async getAccount(userId: string): Promise<Account> {
    await this.ensureAccount(this.db, userId);
    const [row, binding, projected] = await Promise.all([
      this.db.selectFrom('accounts').selectAll().where('user_id', '=', userId).executeTakeFirst(),
      this.findWalletBindingByUserId(this.db, userId),
      this.getProjectedUserBalances(this.db, userId)
    ]);
    if (!row) {
      throw new DomainError(500, 'STATE_CORRUPTED', 'account not found');
    }
    return this.mapAccount(row, binding, projected);
  }

  async getAccountByWalletAddress(walletAddress: string): Promise<Account> {
    const binding = await this.findWalletBindingByWalletAddress(this.db, walletAddress);
    if (!binding) {
      throw new DomainError(404, 'WALLET_ADDRESS_NOT_FOUND', 'wallet address is not bound to any user');
    }
    return this.getAccount(binding.user_id);
  }

  async bindWalletAddress(input: { userId: string; walletAddress: string; nowIso?: string }): Promise<WalletBinding> {
    return this.withTransaction(async (trx) => {
      const nowIso = input.nowIso ?? new Date().toISOString();

      await this.ensureAccount(trx, input.userId, nowIso);
      await this.lockUsers(trx, [input.userId]);
      await this.lockKey(trx, `wallet-address:${input.walletAddress}`);

      const existingBinding = await this.findWalletBindingByWalletAddress(trx, input.walletAddress);
      if (existingBinding && existingBinding.user_id !== input.userId) {
        throw new DomainError(409, 'WALLET_ADDRESS_IN_USE', 'wallet address is already bound to another user');
      }

      await trx
        .insertInto('wallet_address_bindings')
        .values({
          user_id: input.userId,
          wallet_address: input.walletAddress,
          created_at: nowIso
        })
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet({
            wallet_address: input.walletAddress
          })
        )
        .execute();

      const bound = await this.findWalletBindingByUserId(trx, input.userId);
      if (!bound) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'wallet binding not found after upsert');
      }

      return this.mapWalletBinding(bound);
    });
  }

  async getWalletBinding(input: { userId?: string; walletAddress?: string }): Promise<WalletBinding | undefined> {
    if (input.userId) {
      const row = await this.findWalletBindingByUserId(this.db, input.userId);
      return row ? this.mapWalletBinding(row) : undefined;
    }

    if (input.walletAddress) {
      const row = await this.findWalletBindingByWalletAddress(this.db, input.walletAddress);
      return row ? this.mapWalletBinding(row) : undefined;
    }

    throw new DomainError(400, 'VALIDATION_ERROR', 'userId or walletAddress is required');
  }

  async resolveUserId(input: { userId?: string; walletAddress?: string }): Promise<string> {
    if (input.userId && input.walletAddress) {
      const binding = await this.findWalletBindingByWalletAddress(this.db, input.walletAddress);
      if (binding && binding.user_id !== input.userId) {
        throw new DomainError(409, 'ACCOUNT_REFERENCE_CONFLICT', 'userId and walletAddress point to different accounts');
      }
      return input.userId;
    }

    if (input.userId) {
      return input.userId;
    }

    if (input.walletAddress) {
      const binding = await this.findWalletBindingByWalletAddress(this.db, input.walletAddress);
      if (!binding) {
        throw new DomainError(404, 'WALLET_ADDRESS_NOT_FOUND', 'wallet address is not bound to any user');
      }
      return binding.user_id;
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
    return this.withTransaction(async (trx) => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      const amountValue = formatKoriAmount(input.amount);

      await this.lockKey(trx, `deposit:${input.txHash}`);

      const existingDeposit = await trx
        .selectFrom('deposits')
        .selectAll()
        .where('tx_hash', '=', input.txHash)
        .executeTakeFirst();

      if (existingDeposit) {
        return { deposit: this.mapDeposit(existingDeposit), duplicated: true };
      }

      await this.ensureAccount(trx, input.userId, nowIso);
      await this.getAccountForUpdate(trx, input.userId);

      const txId = randomUUID();
      const depositId = randomUUID();

      await trx
        .insertInto('transactions')
        .values({
          tx_id: txId,
          user_id: input.userId,
          type: 'deposit',
          amount: amountValue,
          status: 'confirmed',
          block_tx: input.txHash,
          idempotency_key: null,
          related_user_id: null,
          created_at: nowIso
        })
        .execute();

      await trx
        .insertInto('deposits')
        .values({
          deposit_id: depositId,
          user_id: input.userId,
          tx_hash: input.txHash,
          amount: amountValue,
          status: 'CREDITED',
          block_number: input.blockNumber,
          created_at: nowIso
        })
        .execute();

      await this.appendJournal(trx, {
        journalType: 'deposit_confirmed',
        referenceType: 'deposit',
        referenceId: depositId,
        description: `deposit ${input.txHash}`,
        nowIso,
        postings: [
          {
            ledgerAccountCode: 'system:asset:deposit_clearing',
            accountType: 'asset',
            entrySide: 'debit',
            amount: amountValue
          },
          {
            ledgerAccountCode: `user:${input.userId}:available`,
            accountType: 'liability',
            entrySide: 'credit',
            amount: amountValue
          }
        ]
      });

      await this.syncUserAccountProjection(trx, [input.userId], nowIso);

      return {
        deposit: {
          depositId,
          userId: input.userId,
          txHash: input.txHash,
          amount: input.amount,
          status: 'CREDITED',
          blockNumber: input.blockNumber,
          createdAt: nowIso
        },
        duplicated: false
      };
    });
  }

  async completeDeposit(depositId: string, nowIso = new Date().toISOString()): Promise<Deposit> {
    const existing = await this.db
      .selectFrom('deposits')
      .selectAll()
      .where('deposit_id', '=', depositId)
      .executeTakeFirst();

    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'deposit not found');
    }

    if (existing.status === 'COMPLETED') {
      return this.mapDeposit(existing);
    }

    const row = await this.db
      .updateTable('deposits')
      .set({
        status: 'COMPLETED'
      })
      .where('deposit_id', '=', depositId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapDeposit(row);
  }

  async transfer(input: {
    fromUserId: string;
    toUserId: string;
    amount: bigint;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<TransferResult> {
    if (input.fromUserId === input.toUserId) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'fromUserId and toUserId must be different');
    }

    return this.withTransaction(async (trx) => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      const amountValue = formatKoriAmount(input.amount);

      await this.lockKey(trx, `transfer:${input.idempotencyKey}`);
      await this.lockUsers(trx, [input.fromUserId, input.toUserId]);

      const existingRows = await trx
        .selectFrom('transactions')
        .selectAll()
        .where('idempotency_key', '=', input.idempotencyKey)
        .where('type', 'in', ['internal_transfer_out', 'internal_transfer_in'])
        .execute();

      if (existingRows.length >= 2) {
        const fromTx = existingRows.find((row) => row.type === 'internal_transfer_out');
        const toTx = existingRows.find((row) => row.type === 'internal_transfer_in');
        if (!fromTx || !toTx) {
          throw new DomainError(500, 'STATE_CORRUPTED', 'transfer idempotency state is invalid');
        }
        return {
          fromTx: this.mapTransaction(fromTx),
          toTx: this.mapTransaction(toTx),
          duplicated: true
        };
      }

      await this.ensureAccount(trx, input.fromUserId, nowIso);
      await this.ensureAccount(trx, input.toUserId, nowIso);
      const fromAccount = await this.getAccountForUpdate(trx, input.fromUserId);
      await this.getAccountForUpdate(trx, input.toUserId);

      const fromProjected = await this.getProjectedUserBalances(trx, input.fromUserId);
      const fromAvailable = fromProjected.hasPostings ? fromProjected.balance : parseStoredKoriAmount(fromAccount.balance);
      if (fromAvailable < input.amount) {
        throw new DomainError(400, 'INSUFFICIENT_BALANCE', 'insufficient balance for transfer');
      }

      const fromTxId = randomUUID();
      const toTxId = randomUUID();

      await trx
        .insertInto('transactions')
        .values([
          {
            tx_id: fromTxId,
            user_id: input.fromUserId,
            type: 'internal_transfer_out',
            amount: amountValue,
            status: 'confirmed',
            block_tx: null,
            related_user_id: input.toUserId,
            idempotency_key: input.idempotencyKey,
            created_at: nowIso
          },
          {
            tx_id: toTxId,
            user_id: input.toUserId,
            type: 'internal_transfer_in',
            amount: amountValue,
            status: 'confirmed',
            block_tx: null,
            related_user_id: input.fromUserId,
            idempotency_key: input.idempotencyKey,
            created_at: nowIso
          }
        ])
        .execute();

      await this.appendJournal(trx, {
        journalType: 'internal_transfer',
        referenceType: 'transfer',
        referenceId: input.idempotencyKey,
        description: `internal transfer ${input.fromUserId} -> ${input.toUserId}`,
        nowIso,
        postings: [
          {
            ledgerAccountCode: `user:${input.fromUserId}:available`,
            accountType: 'liability',
            entrySide: 'debit',
            amount: amountValue
          },
          {
            ledgerAccountCode: `user:${input.toUserId}:available`,
            accountType: 'liability',
            entrySide: 'credit',
            amount: amountValue
          }
        ]
      });

      await this.syncUserAccountProjection(trx, [input.fromUserId, input.toUserId], nowIso);

      return {
        fromTx: {
          txId: fromTxId,
          userId: input.fromUserId,
          type: 'internal_transfer_out',
          amount: input.amount,
          status: 'confirmed',
          relatedUserId: input.toUserId,
          idempotencyKey: input.idempotencyKey,
          createdAt: nowIso
        },
        toTx: {
          txId: toTxId,
          userId: input.toUserId,
          type: 'internal_transfer_in',
          amount: input.amount,
          status: 'confirmed',
          relatedUserId: input.fromUserId,
          idempotencyKey: input.idempotencyKey,
          createdAt: nowIso
        },
        duplicated: false
      };
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
    if (input.amount > this.limits.singleLimit) {
      throw new DomainError(400, 'LIMIT_EXCEEDED', 'single withdrawal limit exceeded');
    }

    return this.withTransaction(async (trx) => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      const amountValue = formatKoriAmount(input.amount);

      await this.lockKey(trx, `withdraw:${input.idempotencyKey}`);
      await this.lockUsers(trx, [input.userId]);

      const existing = await trx
        .selectFrom('withdrawals')
        .selectAll()
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst();

      if (existing) {
        return {
          withdrawal: await this.hydrateWithdrawal(trx, existing),
          duplicated: true
        };
      }

      await this.ensureAccount(trx, input.userId, nowIso);
      const account = await this.getAccountForUpdate(trx, input.userId);
      const projected = await this.getProjectedUserBalances(trx, input.userId);
      const availableBalance = projected.hasPostings ? projected.balance : parseStoredKoriAmount(account.balance);
      if (availableBalance < input.amount) {
        throw new DomainError(400, 'INSUFFICIENT_BALANCE', 'insufficient balance for withdrawal');
      }

      const dailyRequested = await this.getDailyRequestedWithdrawalAmount(trx, input.userId, nowIso);
      if (dailyRequested + input.amount > this.limits.dailyLimit) {
        throw new DomainError(400, 'LIMIT_EXCEEDED', 'daily withdrawal limit exceeded');
      }

      const ledgerTxId = randomUUID();
      const withdrawalId = randomUUID();

      await trx
        .insertInto('transactions')
        .values({
          tx_id: ledgerTxId,
          user_id: input.userId,
          type: 'withdraw',
          amount: amountValue,
          status: 'pending',
          block_tx: null,
          related_user_id: null,
          idempotency_key: input.idempotencyKey,
          created_at: nowIso
        })
        .execute();

      await trx
        .insertInto('withdrawals')
        .values({
          withdraw_id: withdrawalId,
          user_id: input.userId,
          amount: amountValue,
          to_address: input.toAddress,
          status: 'LEDGER_RESERVED',
          tx_hash: null,
          idempotency_key: input.idempotencyKey,
          ledger_tx_id: ledgerTxId,
          created_at: nowIso,
          approved_at: null,
          broadcasted_at: null,
          confirmed_at: null,
          failed_at: null,
          fail_reason: null,
          risk_level: input.riskLevel ?? 'low',
          risk_score: input.riskScore ?? 0,
          risk_flags: input.riskFlags ?? [],
          required_approvals: input.requiredApprovals ?? 1,
          client_ip: input.clientIp ?? null,
          device_id: input.deviceId ?? null,
          review_required_at: null,
          external_auth_provider: null,
          external_auth_request_id: null,
          external_auth_confirmed_at: null
        })
        .execute();

      await this.appendJournal(trx, {
        journalType: 'withdraw_reserved',
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        description: `withdraw reserve ${input.userId}`,
        nowIso,
        postings: [
          {
            ledgerAccountCode: `user:${input.userId}:available`,
            accountType: 'liability',
            entrySide: 'debit',
            amount: amountValue
          },
          {
            ledgerAccountCode: `user:${input.userId}:withdraw_pending`,
            accountType: 'liability',
            entrySide: 'credit',
            amount: amountValue
          }
        ]
      });

      await this.syncUserAccountProjection(trx, [input.userId], nowIso);

      const inserted = await trx
        .selectFrom('withdrawals')
        .selectAll()
        .where('withdraw_id', '=', withdrawalId)
        .executeTakeFirstOrThrow();

      return {
        withdrawal: await this.hydrateWithdrawal(trx, inserted),
        duplicated: false
      };
    });
  }

  async confirmWithdrawalExternalAuth(
    withdrawalId: string,
    input: { provider: string; requestId: string },
    nowIso = new Date().toISOString()
  ): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status === 'LEDGER_RESERVED') {
        await trx
          .updateTable('withdrawals')
          .set({
            status: 'PENDING_ADMIN',
            external_auth_provider: input.provider,
            external_auth_request_id: input.requestId,
            external_auth_confirmed_at: nowIso
          })
          .where('withdraw_id', '=', withdrawalId)
          .execute();

        const updated = await this.getWithdrawalForUpdate(trx, withdrawalId);
        return this.hydrateWithdrawal(trx, updated);
      }

      if (
        withdrawal.external_auth_provider === input.provider &&
        withdrawal.external_auth_request_id === input.requestId &&
        withdrawal.external_auth_confirmed_at
      ) {
        return this.hydrateWithdrawal(trx, withdrawal);
      }

      throw new DomainError(409, 'INVALID_STATE', 'withdrawal external auth cannot be confirmed in current state');
    });
  }

  async markWithdrawalReviewRequired(withdrawalId: string, _note: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status !== 'PENDING_ADMIN') {
        return this.hydrateWithdrawal(trx, withdrawal);
      }

      await trx
        .updateTable('withdrawals')
        .set({
          review_required_at: nowIso
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      const updated = await this.getWithdrawalForUpdate(trx, withdrawalId);
      return this.hydrateWithdrawal(trx, updated);
    });
  }

  async approveWithdrawal(
    withdrawalId: string,
    input: { adminId: string; actorType: 'admin' | 'system'; note?: string },
    nowIso = new Date().toISOString()
  ): Promise<ApprovalDecisionResult> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status !== 'PENDING_ADMIN') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be pending admin approval');
      }

      const existingApproval = await trx
        .selectFrom('withdrawal_approvals')
        .selectAll()
        .where('withdraw_id', '=', withdrawalId)
        .where('admin_id', '=', input.adminId)
        .executeTakeFirst();

      if (existingApproval) {
        throw new DomainError(409, 'ALREADY_APPROVED', 'admin already approved this withdrawal');
      }

      const approvalId = randomUUID();
      await trx
        .insertInto('withdrawal_approvals')
        .values({
          approval_id: approvalId,
          withdraw_id: withdrawalId,
          admin_id: input.adminId,
          actor_type: input.actorType,
          note: input.note ?? null,
          created_at: nowIso
        })
        .execute();

      const approvalCount = await this.getApprovalCount(trx, withdrawalId);
      const finalized = approvalCount >= withdrawal.required_approvals;
      if (finalized) {
        await trx
          .updateTable('withdrawals')
          .set({
            status: 'ADMIN_APPROVED',
            approved_at: nowIso
          })
          .where('withdraw_id', '=', withdrawalId)
          .execute();
      }

      const updated = await this.getWithdrawalForUpdate(trx, withdrawalId);
      return {
        withdrawal: await this.hydrateWithdrawal(trx, updated),
        approval: {
          approvalId,
          withdrawalId,
          adminId: input.adminId,
          actorType: input.actorType,
          note: input.note,
          createdAt: nowIso
        },
        finalized
      };
    });
  }

  async broadcastWithdrawal(withdrawalId: string, txHash: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status !== 'ADMIN_APPROVED') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be admin approved');
      }

      await trx
        .updateTable('withdrawals')
        .set({
          status: 'TX_BROADCASTED',
          tx_hash: txHash,
          broadcasted_at: nowIso
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      const updated = await this.getWithdrawalForUpdate(trx, withdrawalId);
      return this.hydrateWithdrawal(trx, updated);
    });
  }

  async confirmWithdrawal(withdrawalId: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status !== 'TX_BROADCASTED') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be tx broadcasted');
      }

      const mapped = await this.hydrateWithdrawal(trx, withdrawal);
      await this.lockUsers(trx, [mapped.userId]);
      const account = await this.getAccountForUpdate(trx, mapped.userId);
      const projected = await this.getProjectedUserBalances(trx, mapped.userId);
      const lockedBalance = projected.hasPostings ? projected.lockedBalance : parseStoredKoriAmount(account.locked_balance);
      if (lockedBalance < mapped.amount) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'locked balance underflow');
      }

      const amountValue = formatKoriAmount(mapped.amount);

      await trx
        .updateTable('transactions')
        .set({
          status: 'confirmed',
          block_tx: mapped.txHash ?? null
        })
        .where('tx_id', '=', mapped.ledgerTxId)
        .execute();

      await trx
        .updateTable('withdrawals')
        .set({
          status: 'COMPLETED',
          confirmed_at: nowIso
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      await this.appendJournal(trx, {
        journalType: 'withdraw_completed',
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        description: `withdraw complete ${mapped.txHash ?? ''}`.trim(),
        nowIso,
        postings: [
          {
            ledgerAccountCode: `user:${mapped.userId}:withdraw_pending`,
            accountType: 'liability',
            entrySide: 'debit',
            amount: amountValue
          },
          {
            ledgerAccountCode: 'system:asset:hot_wallet',
            accountType: 'asset',
            entrySide: 'credit',
            amount: amountValue
          }
        ]
      });

      await this.syncUserAccountProjection(trx, [mapped.userId], nowIso);

      const updated = await this.getWithdrawalForUpdate(trx, withdrawalId);
      return this.hydrateWithdrawal(trx, updated);
    });
  }

  async failWithdrawal(withdrawalId: string, reason: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (!['LEDGER_RESERVED', 'PENDING_ADMIN', 'ADMIN_APPROVED', 'TX_BROADCASTED'].includes(withdrawal.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal cannot be failed in current state');
      }

      const mapped = await this.hydrateWithdrawal(trx, withdrawal);
      await this.lockUsers(trx, [mapped.userId]);
      const account = await this.getAccountForUpdate(trx, mapped.userId);
      const projected = await this.getProjectedUserBalances(trx, mapped.userId);
      const lockedBalance = projected.hasPostings ? projected.lockedBalance : parseStoredKoriAmount(account.locked_balance);
      if (lockedBalance < mapped.amount) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'locked balance underflow');
      }

      const amountValue = formatKoriAmount(mapped.amount);

      await trx
        .updateTable('transactions')
        .set({ status: 'failed' })
        .where('tx_id', '=', mapped.ledgerTxId)
        .execute();

      await trx
        .updateTable('withdrawals')
        .set({
          status: 'FAILED',
          failed_at: nowIso,
          fail_reason: reason
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      await this.appendJournal(trx, {
        journalType: 'withdraw_released',
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        description: reason,
        nowIso,
        postings: [
          {
            ledgerAccountCode: `user:${mapped.userId}:withdraw_pending`,
            accountType: 'liability',
            entrySide: 'debit',
            amount: amountValue
          },
          {
            ledgerAccountCode: `user:${mapped.userId}:available`,
            accountType: 'liability',
            entrySide: 'credit',
            amount: amountValue
          }
        ]
      });

      await this.syncUserAccountProjection(trx, [mapped.userId], nowIso);

      const updated = await this.getWithdrawalForUpdate(trx, withdrawalId);
      return this.hydrateWithdrawal(trx, updated);
    });
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined> {
    const row = await this.db
      .selectFrom('withdrawals')
      .selectAll()
      .where('withdraw_id', '=', withdrawalId)
      .executeTakeFirst();

    return row ? this.hydrateWithdrawal(this.db, row) : undefined;
  }

  async listWithdrawalsByStatuses(statuses: WithdrawalStatus[]): Promise<Withdrawal[]> {
    if (!statuses.length) {
      return [];
    }

    const rows = await this.db
      .selectFrom('withdrawals')
      .selectAll()
      .where('status', 'in', statuses)
      .orderBy('created_at asc')
      .execute();

    return this.hydrateWithdrawals(this.db, rows);
  }

  async listPendingApprovalWithdrawals(): Promise<Withdrawal[]> {
    const rows = await this.db
      .selectFrom('withdrawals')
      .selectAll()
      .where('status', '=', 'PENDING_ADMIN')
      .orderBy('created_at asc')
      .execute();

    const hydrated = await this.hydrateWithdrawals(this.db, rows);
    return hydrated.filter((withdrawal) => withdrawal.approvalCount < withdrawal.requiredApprovals);
  }

  async listWithdrawalApprovals(withdrawalId: string): Promise<WithdrawalApproval[]> {
    const rows = await this.db
      .selectFrom('withdrawal_approvals')
      .selectAll()
      .where('withdraw_id', '=', withdrawalId)
      .orderBy('created_at asc')
      .execute();

    return rows.map((row) => this.mapApproval(row));
  }

  async listStuckWithdrawals(timeoutSec: number, nowIso = new Date().toISOString()): Promise<Withdrawal[]> {
    const thresholdIso = new Date(new Date(nowIso).getTime() - timeoutSec * 1000).toISOString();
    const rows = await this.db
      .selectFrom('withdrawals')
      .selectAll()
      .where('status', 'in', ['LEDGER_RESERVED', 'PENDING_ADMIN', 'ADMIN_APPROVED', 'TX_BROADCASTED'])
      .where('created_at', '<=', thresholdIso)
      .orderBy('created_at asc')
      .execute();

    return this.hydrateWithdrawals(this.db, rows);
  }

  async enqueueJob(type: TxJob['type'], payload: Record<string, string>, nowIso = new Date().toISOString()): Promise<TxJob> {
    const jobId = randomUUID();
    const row = await this.db
      .insertInto('tx_jobs')
      .values({
        job_id: jobId,
        type,
        payload,
        status: 'pending',
        retry_count: 0,
        created_at: nowIso
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapJob(row);
  }

  async claimPendingJobs(types: TxJob['type'][], limit: number): Promise<TxJob[]> {
    if (!types.length || limit <= 0) {
      return [];
    }

    return this.withTransaction(async (trx) => {
      const rows = await trx
        .selectFrom('tx_jobs')
        .selectAll()
        .where('status', '=', 'pending')
        .where('type', 'in', types)
        .orderBy('created_at asc')
        .limit(limit)
        .forUpdate()
        .execute();

      const claimed: TxJob[] = [];
      for (const row of rows) {
        const updated = await trx
          .updateTable('tx_jobs')
          .set({ status: 'running' })
          .where('job_id', '=', row.job_id)
          .where('status', '=', 'pending')
          .returningAll()
          .executeTakeFirst();
        if (updated) {
          claimed.push(this.mapJob(updated));
        }
      }

      return claimed;
    });
  }

  async markJobDone(jobId: string): Promise<void> {
    await this.db.updateTable('tx_jobs').set({ status: 'done' }).where('job_id', '=', jobId).execute();
  }

  async markJobFailed(jobId: string): Promise<void> {
    await this.db.updateTable('tx_jobs').set({ status: 'failed' }).where('job_id', '=', jobId).execute();
  }

  async retryJob(jobId: string): Promise<TxJob | undefined> {
    const row = await this.db
      .updateTable('tx_jobs')
      .set({
        status: 'pending',
        retry_count: sql<number>`retry_count + 1`
      })
      .where('job_id', '=', jobId)
      .returningAll()
      .executeTakeFirst();

    return row ? this.mapJob(row) : undefined;
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
    const row = await this.db
      .insertInto('audit_logs')
      .values({
        audit_id: randomUUID(),
        entity_type: input.entityType,
        entity_id: input.entityId,
        action: input.action,
        actor_type: input.actorType,
        actor_id: input.actorId,
        metadata: input.metadata,
        created_at: input.nowIso ?? new Date().toISOString()
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapAuditLog(row);
  }

  async listAuditLogs(input?: {
    entityType?: AuditLog['entityType'];
    entityId?: string;
    limit?: number;
  }): Promise<AuditLog[]> {
    let query = this.db.selectFrom('audit_logs').selectAll();

    if (input?.entityType) {
      query = query.where('entity_type', '=', input.entityType);
    }
    if (input?.entityId) {
      query = query.where('entity_id', '=', input.entityId);
    }

    const rows = await query.orderBy('created_at desc').limit(input?.limit ?? 100).execute();
    return rows.map((row) => this.mapAuditLog(row));
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
    return this.withTransaction(async (trx) => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      await this.lockKey(trx, `sweep-source:${input.sourceAddress}`);
      if (input.externalRef) {
        await this.lockKey(trx, `sweep-external-ref:${input.externalRef}`);
        const duplicated = await trx
          .selectFrom('sweep_records')
          .selectAll()
          .where('external_ref', '=', input.externalRef)
          .executeTakeFirst();
        if (duplicated) {
          return this.mapSweep(duplicated);
        }
      }

      const row = await trx
        .insertInto('sweep_records')
        .values({
          sweep_id: randomUUID(),
          source_wallet_code: input.sourceWalletCode,
          source_address: input.sourceAddress,
          target_address: input.targetAddress,
          currency_id: input.currencyId ?? null,
          network: input.network ?? null,
          amount: formatKoriAmount(input.amount),
          status: 'planned',
          external_ref: input.externalRef ?? null,
          tx_hash: null,
          note: input.note ?? null,
          attempt_count: 0,
          created_at: nowIso,
          queued_at: null,
          last_attempt_at: null,
          broadcasted_at: null,
          confirmed_at: null
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return this.mapSweep(row);
    });
  }

  async listSweepRecords(limit = 100): Promise<SweepRecord[]> {
    const rows = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .orderBy('created_at desc')
      .limit(limit)
      .execute();

    return rows.map((row) => this.mapSweep(row));
  }

  async listSweepRecordsByStatuses(statuses: SweepRecord['status'][], limit = 100): Promise<SweepRecord[]> {
    const rows = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .where('status', 'in', statuses)
      .orderBy('created_at desc')
      .limit(limit)
      .execute();

    return rows.map((row) => this.mapSweep(row));
  }

  async findSweepByExternalRef(externalRef: string): Promise<SweepRecord | undefined> {
    const row = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .where('external_ref', '=', externalRef)
      .executeTakeFirst();

    return row ? this.mapSweep(row) : undefined;
  }

  async markSweepQueued(sweepId: string, note?: string): Promise<SweepRecord> {
    const existing = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .where('sweep_id', '=', sweepId)
      .executeTakeFirst();

    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'sweep not found');
    }
    if (existing.status !== 'planned') {
      throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned');
    }

    const row = await this.db
      .updateTable('sweep_records')
      .set({
        status: 'queued',
        note: note ?? existing.note,
        queued_at: existing.queued_at ?? new Date().toISOString()
      })
      .where('sweep_id', '=', sweepId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapSweep(row);
  }

  async recordSweepAttempt(sweepId: string, note?: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    const existing = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .where('sweep_id', '=', sweepId)
      .executeTakeFirst();

    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'sweep not found');
    }
    if (existing.status !== 'queued') {
      throw new DomainError(409, 'INVALID_STATE', 'sweep must be queued');
    }

    const row = await this.db
      .updateTable('sweep_records')
      .set({
        attempt_count: existing.attempt_count + 1,
        last_attempt_at: nowIso,
        note: note ?? existing.note
      })
      .where('sweep_id', '=', sweepId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapSweep(row);
  }

  async markSweepBroadcasted(sweepId: string, txHash: string, note?: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    const existing = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .where('sweep_id', '=', sweepId)
      .executeTakeFirst();

    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'sweep not found');
    }
    if (!['planned', 'queued'].includes(existing.status)) {
      throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned or queued');
    }

    const row = await this.db
      .updateTable('sweep_records')
      .set({
        status: 'broadcasted',
        tx_hash: txHash,
        note: note ?? existing.note,
        broadcasted_at: nowIso
      })
      .where('sweep_id', '=', sweepId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapSweep(row);
  }

  async confirmSweep(sweepId: string, note?: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    const existing = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .where('sweep_id', '=', sweepId)
      .executeTakeFirst();

    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'sweep not found');
    }
    if (!['planned', 'broadcasted'].includes(existing.status)) {
      throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned or broadcasted');
    }

    const row = await this.db
      .updateTable('sweep_records')
      .set({
        status: 'confirmed',
        note: note ?? existing.note,
        confirmed_at: nowIso
      })
      .where('sweep_id', '=', sweepId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapSweep(row);
  }

  async failSweep(sweepId: string, reason: string, nowIso = new Date().toISOString()): Promise<SweepRecord> {
    const existing = await this.db
      .selectFrom('sweep_records')
      .selectAll()
      .where('sweep_id', '=', sweepId)
      .executeTakeFirst();

    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'sweep not found');
    }
    if (!['planned', 'queued', 'broadcasted'].includes(existing.status)) {
      throw new DomainError(409, 'INVALID_STATE', 'sweep must be planned, queued or broadcasted');
    }

    const row = await this.db
      .updateTable('sweep_records')
      .set({
        status: 'failed',
        note: reason,
        confirmed_at: nowIso
      })
      .where('sweep_id', '=', sweepId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapSweep(row);
  }

  async getLedgerSummary(): Promise<LedgerSummary> {
    const [accountSummary, projectedSummary] = await Promise.all([
      this.db
        .selectFrom('accounts')
        .select((eb) => [
          sql<string>`count(*)::text`.as('account_count'),
          sql<string>`coalesce(sum(balance)::text, '0')`.as('available_balance'),
          sql<string>`coalesce(sum(locked_balance)::text, '0')`.as('locked_balance')
        ])
        .executeTakeFirstOrThrow(),
      this.getProjectedLedgerSummary(this.db)
    ]);

    const depositSummary = await this.db
      .selectFrom('deposits')
      .select(sql<string>`count(*)::text`.as('deposit_count'))
      .where('status', 'in', ['CREDITED', 'COMPLETED'])
      .executeTakeFirstOrThrow();

    const activeSummary = await this.db
      .selectFrom('withdrawals')
      .select(sql<string>`count(*)::text`.as('active_count'))
      .where('status', 'in', ACTIVE_WITHDRAWAL_STATUSES)
      .executeTakeFirstOrThrow();

    const availableBalance = projectedSummary.hasPostings
      ? projectedSummary.availableBalance
      : parseStoredKoriAmount(accountSummary.available_balance);
    const lockedBalance = projectedSummary.hasPostings
      ? projectedSummary.lockedBalance
      : parseStoredKoriAmount(accountSummary.locked_balance);

    return {
      accountCount: Number(accountSummary.account_count),
      availableBalance,
      lockedBalance,
      liabilityBalance: availableBalance + lockedBalance,
      confirmedDepositCount: Number(depositSummary.deposit_count),
      activeWithdrawalCount: Number(activeSummary.active_count)
    };
  }

  async rebuildAccountProjections(nowIso = new Date().toISOString()): Promise<{ accountCount: number }> {
    const rows = await this.db.selectFrom('accounts').select(['user_id']).execute();
    await this.withTransaction(async (trx) => {
      for (const row of rows) {
        await this.syncUserAccountProjection(trx, [row.user_id], nowIso);
      }
    });

    return {
      accountCount: rows.length
    };
  }

  private async withTransaction<T>(work: (trx: Transaction<KorionDatabase>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => work(trx));
  }

  private async lockKey(db: DbExecutor, key: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext(${key}))`.execute(db);
  }

  private async lockUsers(db: DbExecutor, userIds: string[]): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await this.lockKey(db, `account:${userId}`);
    }
  }

  private async ensureAccount(db: DbExecutor, userId: string, nowIso = new Date().toISOString()): Promise<void> {
    await db
      .insertInto('accounts')
      .values({
        user_id: userId,
        balance: '0',
        locked_balance: '0',
        updated_at: nowIso
      })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();
  }

  private async getAccountForUpdate(trx: Transaction<KorionDatabase>, userId: string): Promise<KorionDatabase['accounts']> {
    const row = await trx
      .selectFrom('accounts')
      .selectAll()
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();

    if (!row) {
      throw new DomainError(500, 'STATE_CORRUPTED', 'account not found');
    }

    return row;
  }

  private async getWithdrawalForUpdate(
    trx: Transaction<KorionDatabase>,
    withdrawalId: string
  ): Promise<KorionDatabase['withdrawals']> {
    const row = await trx
      .selectFrom('withdrawals')
      .selectAll()
      .where('withdraw_id', '=', withdrawalId)
      .forUpdate()
      .executeTakeFirst();

    if (!row) {
      throw new DomainError(404, 'NOT_FOUND', 'withdrawal not found');
    }

    return row;
  }

  private async getDailyRequestedWithdrawalAmount(
    trx: Transaction<KorionDatabase>,
    userId: string,
    nowIso: string
  ): Promise<bigint> {
    const row = await trx
      .selectFrom('withdrawals')
      .select(sql<string>`coalesce(sum(amount)::text, '0')`.as('amount'))
      .where('user_id', '=', userId)
      .where(sql<boolean>`created_at >= date_trunc('day', ${nowIso}::timestamptz)`)
      .where(sql<boolean>`created_at < date_trunc('day', ${nowIso}::timestamptz) + interval '1 day'`)
      .where('status', 'in', DAILY_LIMIT_WITHDRAWAL_STATUSES)
      .executeTakeFirst();

    return parseStoredKoriAmount(row?.amount ?? '0');
  }

  private async getApprovalCount(db: DbExecutor, withdrawalId: string): Promise<number> {
    const row = await db
      .selectFrom('withdrawal_approvals')
      .select(sql<string>`count(*)::text`.as('count'))
      .where('withdraw_id', '=', withdrawalId)
      .executeTakeFirst();

    return Number(row?.count ?? '0');
  }

  private async appendJournal(
    db: DbExecutor,
    input: {
      journalType: string;
      referenceType: string;
      referenceId: string;
      description?: string;
      nowIso: string;
      postings: LedgerPostingInput[];
    }
  ): Promise<void> {
    const journalId = randomUUID();
    await db
      .insertInto('ledger_journals')
      .values({
        journal_id: journalId,
        journal_type: input.journalType,
        reference_type: input.referenceType,
        reference_id: input.referenceId,
        description: input.description ?? null,
        created_at: input.nowIso
      })
      .execute();

    for (const posting of input.postings) {
      await this.ensureLedgerAccount(db, posting.ledgerAccountCode, posting.accountType, input.nowIso);
    }

    await db
      .insertInto('ledger_postings')
      .values(
        input.postings.map((posting) => ({
          posting_id: randomUUID(),
          journal_id: journalId,
          ledger_account_code: posting.ledgerAccountCode,
          entry_side: posting.entrySide,
          amount: posting.amount,
          created_at: input.nowIso
        }))
      )
      .execute();
  }

  private async ensureLedgerAccount(
    db: DbExecutor,
    ledgerAccountCode: string,
    accountType: KorionDatabase['ledger_accounts']['account_type'],
    nowIso = new Date().toISOString()
  ): Promise<void> {
    await db
      .insertInto('ledger_accounts')
      .values({
        ledger_account_code: ledgerAccountCode,
        account_type: accountType,
        currency_code: 'KORI',
        created_at: nowIso
      })
      .onConflict((oc) => oc.column('ledger_account_code').doNothing())
      .execute();
  }

  private async getProjectedUserBalances(
    db: DbExecutor,
    userId: string
  ): Promise<{ balance: bigint; lockedBalance: bigint; updatedAt?: string; hasPostings: boolean }> {
    const availableCode = `user:${userId}:available`;
    const pendingCode = `user:${userId}:withdraw_pending`;
    const row = await db
      .selectFrom('ledger_postings')
      .select((eb) => [
        sql<string>`count(*)::text`.as('posting_count'),
        sql<string>`
          coalesce(sum(
            case
              when ledger_account_code = ${availableCode} and entry_side = 'credit' then amount
              when ledger_account_code = ${availableCode} and entry_side = 'debit' then -amount
              else 0
            end
          )::text, '0')
        `.as('available_balance'),
        sql<string>`
          coalesce(sum(
            case
              when ledger_account_code = ${pendingCode} and entry_side = 'credit' then amount
              when ledger_account_code = ${pendingCode} and entry_side = 'debit' then -amount
              else 0
            end
          )::text, '0')
        `.as('locked_balance'),
        sql<string | null>`max(created_at)::text`.as('updated_at')
      ])
      .where('ledger_account_code', 'in', [availableCode, pendingCode])
      .executeTakeFirstOrThrow();

    return {
      balance: parseStoredKoriAmount(row.available_balance),
      lockedBalance: parseStoredKoriAmount(row.locked_balance),
      updatedAt: row.updated_at ?? undefined,
      hasPostings: Number(row.posting_count) > 0
    };
  }

  private async getProjectedLedgerSummary(
    db: DbExecutor
  ): Promise<{ availableBalance: bigint; lockedBalance: bigint; hasPostings: boolean }> {
    const row = await db
      .selectFrom('ledger_postings')
      .select((eb) => [
        sql<string>`count(*)::text`.as('posting_count'),
        sql<string>`
          coalesce(sum(
            case
              when ledger_account_code like 'user:%:available' and entry_side = 'credit' then amount
              when ledger_account_code like 'user:%:available' and entry_side = 'debit' then -amount
              else 0
            end
          )::text, '0')
        `.as('available_balance'),
        sql<string>`
          coalesce(sum(
            case
              when ledger_account_code like 'user:%:withdraw_pending' and entry_side = 'credit' then amount
              when ledger_account_code like 'user:%:withdraw_pending' and entry_side = 'debit' then -amount
              else 0
            end
          )::text, '0')
        `.as('locked_balance')
      ])
      .executeTakeFirstOrThrow();

    return {
      availableBalance: parseStoredKoriAmount(row.available_balance),
      lockedBalance: parseStoredKoriAmount(row.locked_balance),
      hasPostings: Number(row.posting_count) > 0
    };
  }

  private async syncUserAccountProjection(db: DbExecutor, userIds: string[], nowIso: string): Promise<void> {
    for (const userId of [...new Set(userIds)]) {
      const projected = await this.getProjectedUserBalances(db, userId);
      if (!projected.hasPostings) {
        continue;
      }

      await db
        .updateTable('accounts')
        .set({
          balance: formatKoriAmount(projected.balance),
          locked_balance: formatKoriAmount(projected.lockedBalance),
          updated_at: projected.updatedAt ?? nowIso
        })
        .where('user_id', '=', userId)
        .execute();
    }
  }

  private async hydrateWithdrawal(db: DbExecutor, row: KorionDatabase['withdrawals']): Promise<Withdrawal> {
    const count = await this.getApprovalCount(db, row.withdraw_id);
    return this.mapWithdrawal(row, count);
  }

  private async hydrateWithdrawals(db: DbExecutor, rows: KorionDatabase['withdrawals'][]): Promise<Withdrawal[]> {
    if (!rows.length) {
      return [];
    }

    const counts = await this.getApprovalCounts(db, rows.map((row) => row.withdraw_id));
    return rows.map((row) => this.mapWithdrawal(row, counts.get(row.withdraw_id) ?? 0));
  }

  private async getApprovalCounts(db: DbExecutor, withdrawalIds: string[]): Promise<Map<string, number>> {
    const ids = [...new Set(withdrawalIds)];
    if (!ids.length) {
      return new Map();
    }

    const rows = await db
      .selectFrom('withdrawal_approvals')
      .select([
        'withdraw_id',
        sql<string>`count(*)::text`.as('approval_count')
      ])
      .where('withdraw_id', 'in', ids)
      .groupBy('withdraw_id')
      .execute();

    return new Map(rows.map((row) => [row.withdraw_id, Number(row.approval_count)]));
  }

  private async findWalletBindingByUserId(
    db: DbExecutor,
    userId: string
  ): Promise<KorionDatabase['wallet_address_bindings'] | undefined> {
    return db
      .selectFrom('wallet_address_bindings')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  private async findWalletBindingByWalletAddress(
    db: DbExecutor,
    walletAddress: string
  ): Promise<KorionDatabase['wallet_address_bindings'] | undefined> {
    return db
      .selectFrom('wallet_address_bindings')
      .selectAll()
      .where('wallet_address', '=', walletAddress)
      .executeTakeFirst();
  }

  private mapAccount(
    row: KorionDatabase['accounts'],
    binding?: KorionDatabase['wallet_address_bindings'],
    projected?: { balance: bigint; lockedBalance: bigint; updatedAt?: string; hasPostings: boolean }
  ): Account {
    return {
      userId: row.user_id,
      walletAddress: binding?.wallet_address,
      balance: projected?.hasPostings ? projected.balance : parseStoredKoriAmount(row.balance),
      lockedBalance: projected?.hasPostings ? projected.lockedBalance : parseStoredKoriAmount(row.locked_balance),
      updatedAt: projected?.hasPostings ? projected.updatedAt ?? row.updated_at : row.updated_at
    };
  }

  private mapWalletBinding(row: KorionDatabase['wallet_address_bindings']): WalletBinding {
    return {
      userId: row.user_id,
      walletAddress: row.wallet_address,
      createdAt: row.created_at
    };
  }

  private mapTransaction(row: KorionDatabase['transactions']): LedgerTransaction {
    return {
      txId: row.tx_id,
      userId: row.user_id,
      type: row.type,
      amount: parseStoredKoriAmount(row.amount),
      status: row.status,
      blockTx: row.block_tx ?? undefined,
      relatedUserId: row.related_user_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      createdAt: row.created_at
    };
  }

  private mapDeposit(row: KorionDatabase['deposits']): Deposit {
    return {
      depositId: row.deposit_id,
      userId: row.user_id,
      txHash: row.tx_hash,
      amount: parseStoredKoriAmount(row.amount),
      status: row.status,
      blockNumber: row.block_number,
      createdAt: row.created_at
    };
  }

  private mapWithdrawal(row: KorionDatabase['withdrawals'], approvalCount: number): Withdrawal {
    return {
      withdrawalId: row.withdraw_id,
      userId: row.user_id,
      amount: parseStoredKoriAmount(row.amount),
      toAddress: row.to_address,
      status: row.status,
      txHash: row.tx_hash ?? undefined,
      idempotencyKey: row.idempotency_key,
      ledgerTxId: row.ledger_tx_id,
      createdAt: row.created_at,
      approvedAt: row.approved_at ?? undefined,
      broadcastedAt: row.broadcasted_at ?? undefined,
      confirmedAt: row.confirmed_at ?? undefined,
      failedAt: row.failed_at ?? undefined,
      failReason: row.fail_reason ?? undefined,
      riskLevel: row.risk_level,
      riskScore: row.risk_score,
      riskFlags: row.risk_flags ?? [],
      requiredApprovals: row.required_approvals,
      approvalCount,
      clientIp: row.client_ip ?? undefined,
      deviceId: row.device_id ?? undefined,
      reviewRequiredAt: row.review_required_at ?? undefined,
      externalAuthProvider: row.external_auth_provider ?? undefined,
      externalAuthRequestId: row.external_auth_request_id ?? undefined,
      externalAuthConfirmedAt: row.external_auth_confirmed_at ?? undefined
    };
  }

  private mapApproval(row: KorionDatabase['withdrawal_approvals']): WithdrawalApproval {
    return {
      approvalId: row.approval_id,
      withdrawalId: row.withdraw_id,
      adminId: row.admin_id,
      actorType: row.actor_type,
      note: row.note ?? undefined,
      createdAt: row.created_at
    };
  }

  private mapAuditLog(row: KorionDatabase['audit_logs']): AuditLog {
    return {
      auditId: row.audit_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      actorType: row.actor_type,
      actorId: row.actor_id,
      metadata: row.metadata ?? {},
      createdAt: row.created_at
    };
  }

  private mapSweep(row: KorionDatabase['sweep_records']): SweepRecord {
    return {
      sweepId: row.sweep_id,
      sourceWalletCode: row.source_wallet_code,
      sourceAddress: row.source_address,
      targetAddress: row.target_address,
      currencyId: row.currency_id ?? undefined,
      network: row.network ?? undefined,
      amount: parseStoredKoriAmount(row.amount),
      status: row.status,
      externalRef: row.external_ref ?? undefined,
      txHash: row.tx_hash ?? undefined,
      note: row.note ?? undefined,
      attemptCount: row.attempt_count,
      createdAt: row.created_at,
      queuedAt: row.queued_at ?? undefined,
      lastAttemptAt: row.last_attempt_at ?? undefined,
      broadcastedAt: row.broadcasted_at ?? undefined,
      confirmedAt: row.confirmed_at ?? undefined
    };
  }

  private mapJob(row: KorionDatabase['tx_jobs']): TxJob {
    return {
      jobId: row.job_id,
      type: row.type,
      payload: row.payload,
      status: row.status,
      retryCount: row.retry_count,
      createdAt: row.created_at
    };
  }
}
