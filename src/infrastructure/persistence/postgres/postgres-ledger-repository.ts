import { randomUUID } from 'node:crypto';
import { Kysely, sql, type Transaction } from 'kysely';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { formatKoriAmount, parseStoredKoriAmount, sumBigInt } from '../../../domain/value-objects/money.js';
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
} from '../../../domain/ledger/types.js';
import type { LedgerRepository } from '../../../application/ports/ledger-repository.js';
import type { WithdrawalLimitConfig } from '../../../ledger/in-memory-ledger.js';
import type { KorionDatabase } from './db-schema.js';

const ACTIVE_WITHDRAWAL_STATUSES: WithdrawalStatus[] = ['requested', 'approved', 'broadcasted', 'confirmed'];

export class PostgresLedgerRepository implements LedgerRepository {
  constructor(
    private readonly db: Kysely<KorionDatabase>,
    private readonly limits: WithdrawalLimitConfig
  ) {}

  async getAccount(userId: string): Promise<Account> {
    await this.ensureAccount(this.db, userId);
    const row = await this.db.selectFrom('accounts').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if (!row) {
      throw new DomainError(500, 'STATE_CORRUPTED', 'account not found');
    }
    return this.mapAccount(row, await this.findWalletBindingByUserId(this.db, userId));
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
        .updateTable('accounts')
        .set({
          balance: sql<string>`balance + ${amountValue}::numeric`,
          updated_at: nowIso
        })
        .where('user_id', '=', input.userId)
        .execute();

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
          status: 'confirmed',
          block_number: input.blockNumber,
          created_at: nowIso
        })
        .execute();

      return {
        deposit: {
          depositId,
          userId: input.userId,
          txHash: input.txHash,
          amount: input.amount,
          status: 'confirmed',
          blockNumber: input.blockNumber,
          createdAt: nowIso
        },
        duplicated: false
      };
    });
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

      if (parseStoredKoriAmount(fromAccount.balance) < input.amount) {
        throw new DomainError(400, 'INSUFFICIENT_BALANCE', 'insufficient balance for transfer');
      }

      const fromTxId = randomUUID();
      const toTxId = randomUUID();

      await trx
        .updateTable('accounts')
        .set({
          balance: sql<string>`balance - ${amountValue}::numeric`,
          updated_at: nowIso
        })
        .where('user_id', '=', input.fromUserId)
        .execute();

      await trx
        .updateTable('accounts')
        .set({
          balance: sql<string>`balance + ${amountValue}::numeric`,
          updated_at: nowIso
        })
        .where('user_id', '=', input.toUserId)
        .execute();

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
        return { withdrawal: this.mapWithdrawal(existing), duplicated: true };
      }

      await this.ensureAccount(trx, input.userId, nowIso);
      const account = await this.getAccountForUpdate(trx, input.userId);
      if (parseStoredKoriAmount(account.balance) < input.amount) {
        throw new DomainError(400, 'INSUFFICIENT_BALANCE', 'insufficient balance for withdrawal');
      }

      const dailyRequested = await this.getDailyRequestedWithdrawalAmount(trx, input.userId, nowIso);
      if (dailyRequested + input.amount > this.limits.dailyLimit) {
        throw new DomainError(400, 'LIMIT_EXCEEDED', 'daily withdrawal limit exceeded');
      }

      const ledgerTxId = randomUUID();
      const withdrawalId = randomUUID();

      await trx
        .updateTable('accounts')
        .set({
          balance: sql<string>`balance - ${amountValue}::numeric`,
          locked_balance: sql<string>`locked_balance + ${amountValue}::numeric`,
          updated_at: nowIso
        })
        .where('user_id', '=', input.userId)
        .execute();

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
          status: 'requested',
          tx_hash: null,
          idempotency_key: input.idempotencyKey,
          ledger_tx_id: ledgerTxId,
          created_at: nowIso,
          approved_at: null,
          broadcasted_at: null,
          confirmed_at: null,
          failed_at: null,
          fail_reason: null
        })
        .execute();

      return {
        withdrawal: {
          withdrawalId,
          userId: input.userId,
          amount: input.amount,
          toAddress: input.toAddress,
          status: 'requested',
          idempotencyKey: input.idempotencyKey,
          ledgerTxId,
          createdAt: nowIso
        },
        duplicated: false
      };
    });
  }

  async approveWithdrawal(withdrawalId: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status !== 'requested') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be requested');
      }

      await trx
        .updateTable('withdrawals')
        .set({
          status: 'approved',
          approved_at: nowIso
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      return { ...this.mapWithdrawal(withdrawal), status: 'approved', approvedAt: nowIso };
    });
  }

  async broadcastWithdrawal(withdrawalId: string, txHash: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status !== 'approved') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be approved');
      }

      await trx
        .updateTable('withdrawals')
        .set({
          status: 'broadcasted',
          tx_hash: txHash,
          broadcasted_at: nowIso
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      return {
        ...this.mapWithdrawal(withdrawal),
        status: 'broadcasted',
        txHash,
        broadcastedAt: nowIso
      };
    });
  }

  async confirmWithdrawal(withdrawalId: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (withdrawal.status !== 'broadcasted') {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal must be broadcasted');
      }

      const mapped = this.mapWithdrawal(withdrawal);
      await this.lockUsers(trx, [mapped.userId]);
      const account = await this.getAccountForUpdate(trx, mapped.userId);
      if (parseStoredKoriAmount(account.locked_balance) < mapped.amount) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'locked balance underflow');
      }

      const amountValue = formatKoriAmount(mapped.amount);

      await trx
        .updateTable('accounts')
        .set({
          locked_balance: sql<string>`locked_balance - ${amountValue}::numeric`,
          updated_at: nowIso
        })
        .where('user_id', '=', mapped.userId)
        .execute();

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
          status: 'confirmed',
          confirmed_at: nowIso
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      return { ...mapped, status: 'confirmed', confirmedAt: nowIso };
    });
  }

  async failWithdrawal(withdrawalId: string, reason: string, nowIso = new Date().toISOString()): Promise<Withdrawal> {
    return this.withTransaction(async (trx) => {
      await this.lockKey(trx, `withdrawal-state:${withdrawalId}`);
      const withdrawal = await this.getWithdrawalForUpdate(trx, withdrawalId);
      if (!['requested', 'approved', 'broadcasted'].includes(withdrawal.status)) {
        throw new DomainError(409, 'INVALID_STATE', 'withdrawal cannot be failed in current state');
      }

      const mapped = this.mapWithdrawal(withdrawal);
      await this.lockUsers(trx, [mapped.userId]);
      const account = await this.getAccountForUpdate(trx, mapped.userId);
      if (parseStoredKoriAmount(account.locked_balance) < mapped.amount) {
        throw new DomainError(500, 'STATE_CORRUPTED', 'locked balance underflow');
      }

      const amountValue = formatKoriAmount(mapped.amount);

      await trx
        .updateTable('accounts')
        .set({
          locked_balance: sql<string>`locked_balance - ${amountValue}::numeric`,
          balance: sql<string>`balance + ${amountValue}::numeric`,
          updated_at: nowIso
        })
        .where('user_id', '=', mapped.userId)
        .execute();

      await trx
        .updateTable('transactions')
        .set({ status: 'failed' })
        .where('tx_id', '=', mapped.ledgerTxId)
        .execute();

      await trx
        .updateTable('withdrawals')
        .set({
          status: 'failed',
          failed_at: nowIso,
          fail_reason: reason
        })
        .where('withdraw_id', '=', withdrawalId)
        .execute();

      return {
        ...mapped,
        status: 'failed',
        failedAt: nowIso,
        failReason: reason
      };
    });
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined> {
    const row = await this.db
      .selectFrom('withdrawals')
      .selectAll()
      .where('withdraw_id', '=', withdrawalId)
      .executeTakeFirst();

    return row ? this.mapWithdrawal(row) : undefined;
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

    return rows.map((row) => this.mapWithdrawal(row));
  }

  async listStuckWithdrawals(timeoutSec: number, nowIso = new Date().toISOString()): Promise<Withdrawal[]> {
    const thresholdIso = new Date(new Date(nowIso).getTime() - timeoutSec * 1000).toISOString();
    const rows = await this.db
      .selectFrom('withdrawals')
      .selectAll()
      .where('status', 'in', ['requested', 'approved', 'broadcasted'])
      .where('created_at', '<=', thresholdIso)
      .orderBy('created_at asc')
      .execute();

    return rows.map((row) => this.mapWithdrawal(row));
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

  private async withTransaction<T>(work: (trx: Transaction<KorionDatabase>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => work(trx));
  }

  private async lockKey(db: Kysely<KorionDatabase> | Transaction<KorionDatabase>, key: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext(${key}))`.execute(db);
  }

  private async lockUsers(db: Kysely<KorionDatabase> | Transaction<KorionDatabase>, userIds: string[]): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await this.lockKey(db, `account:${userId}`);
    }
  }

  private async ensureAccount(db: Kysely<KorionDatabase> | Transaction<KorionDatabase>, userId: string, nowIso = new Date().toISOString()): Promise<void> {
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

  private async getWithdrawalForUpdate(trx: Transaction<KorionDatabase>, withdrawalId: string): Promise<KorionDatabase['withdrawals']> {
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
      .where('status', 'in', ACTIVE_WITHDRAWAL_STATUSES)
      .executeTakeFirst();

    return sumBigInt([parseStoredKoriAmount(row?.amount ?? '0')]);
  }

  private async findWalletBindingByUserId(
    db: Kysely<KorionDatabase> | Transaction<KorionDatabase>,
    userId: string
  ): Promise<KorionDatabase['wallet_address_bindings'] | undefined> {
    return db
      .selectFrom('wallet_address_bindings')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  private async findWalletBindingByWalletAddress(
    db: Kysely<KorionDatabase> | Transaction<KorionDatabase>,
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
    binding?: KorionDatabase['wallet_address_bindings']
  ): Account {
    return {
      userId: row.user_id,
      walletAddress: binding?.wallet_address,
      balance: parseStoredKoriAmount(row.balance),
      lockedBalance: parseStoredKoriAmount(row.locked_balance),
      updatedAt: row.updated_at
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

  private mapWithdrawal(row: KorionDatabase['withdrawals']): Withdrawal {
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
      failReason: row.fail_reason ?? undefined
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
