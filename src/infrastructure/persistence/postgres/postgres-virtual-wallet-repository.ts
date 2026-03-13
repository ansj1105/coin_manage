import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { DomainError } from '../../../domain/errors/domain-error.js';
import type { DepositWatchAddress } from '../../../domain/deposit-monitor/types.js';
import type { FoxyaWalletSigner } from '../../../application/ports/foxya-wallet-repository.js';
import type { VirtualWalletRepository } from '../../../application/ports/virtual-wallet-repository.js';
import type { VirtualWalletBinding, VirtualWalletIssueResult } from '../../../domain/virtual-wallet/types.js';
import type { KorionDatabase } from './db-schema.js';
import { AesGcmVirtualWalletKeyCipher } from '../../security/virtual-wallet-key-cipher.js';

export class PostgresVirtualWalletRepository implements VirtualWalletRepository {
  private readonly keyCipher: AesGcmVirtualWalletKeyCipher;

  constructor(
    private readonly db: Kysely<KorionDatabase>,
    encryptionKey: string
  ) {
    this.keyCipher = new AesGcmVirtualWalletKeyCipher(encryptionKey);
  }

  async issueVirtualWallet(input: {
    userId: string;
    currencyId: number;
    network: 'mainnet' | 'testnet';
    walletAddress: string;
    privateKey: string;
    encryptedPrivateKey: string;
    sweepTargetAddress: string;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<VirtualWalletIssueResult> {
    return this.db.transaction().execute(async (trx) => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      await this.lockKey(trx, `virtual-wallet-user:${input.userId}`);
      await this.lockKey(trx, `virtual-wallet-idempotency:${input.idempotencyKey}`);

      const duplicatedByIdempotency = await trx
        .selectFrom('virtual_wallet_bindings')
        .selectAll()
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst();
      if (duplicatedByIdempotency) {
        return {
          binding: this.mapBinding(duplicatedByIdempotency),
          duplicated: true
        };
      }

      const existing = await trx
        .selectFrom('virtual_wallet_bindings')
        .selectAll()
        .where('user_id', '=', input.userId)
        .where('currency_id', '=', input.currencyId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (existing) {
        return {
          binding: this.mapBinding(existing),
          duplicated: true
        };
      }

      const bindingConflict = await trx
        .selectFrom('wallet_address_bindings')
        .selectAll()
        .where('user_id', '=', input.userId)
        .executeTakeFirst();
      if (bindingConflict) {
        throw new DomainError(
          409,
          'USER_ALREADY_HAS_BOUND_WALLET_ADDRESS',
          'user already has a wallet address bound outside virtual wallet issuance'
        );
      }

      const walletAddressInUse = await trx
        .selectFrom('wallet_address_bindings')
        .selectAll()
        .where('wallet_address', '=', input.walletAddress)
        .executeTakeFirst();
      if (walletAddressInUse && walletAddressInUse.user_id !== input.userId) {
        throw new DomainError(409, 'WALLET_ADDRESS_IN_USE', 'wallet address is already bound to another user');
      }

      await trx
        .insertInto('wallet_address_bindings')
        .values({
          user_id: input.userId,
          wallet_address: input.walletAddress,
          created_at: nowIso
        })
        .execute();

      const stored = await trx
        .insertInto('virtual_wallet_bindings')
        .values({
          virtual_wallet_id: randomUUID(),
          user_id: input.userId,
          currency_id: input.currencyId,
          network: input.network,
          wallet_address: input.walletAddress,
          encrypted_private_key: input.encryptedPrivateKey,
          sweep_target_address: input.sweepTargetAddress,
          issued_by: 'hot_wallet',
          idempotency_key: input.idempotencyKey,
          status: 'active',
          activation_status: 'pending_trx_grant',
          activation_grant_tx_hash: null,
          activation_granted_at: null,
          activation_reclaim_tx_hash: null,
          activation_reclaimed_at: null,
          activation_last_error: null,
          resource_status: 'idle',
          resource_delegated_at: null,
          resource_released_at: null,
          resource_last_error: null,
          created_at: nowIso,
          retired_at: null,
          disabled_at: null,
          replaced_by_virtual_wallet_id: null
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        binding: this.mapBinding(stored),
        duplicated: false
      };
    });
  }

  async reissueVirtualWallet(input: {
    userId: string;
    currencyId: number;
    network: 'mainnet' | 'testnet';
    walletAddress: string;
    privateKey: string;
    encryptedPrivateKey: string;
    sweepTargetAddress: string;
    idempotencyKey: string;
    nowIso?: string;
  }): Promise<VirtualWalletIssueResult> {
    return this.db.transaction().execute(async (trx) => {
      const nowIso = input.nowIso ?? new Date().toISOString();
      await this.lockKey(trx, `virtual-wallet-user:${input.userId}`);
      await this.lockKey(trx, `virtual-wallet-idempotency:${input.idempotencyKey}`);
      await this.lockKey(trx, `wallet-address:${input.walletAddress}`);

      const duplicatedByIdempotency = await trx
        .selectFrom('virtual_wallet_bindings')
        .selectAll()
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst();
      if (duplicatedByIdempotency) {
        return {
          binding: this.mapBinding(duplicatedByIdempotency),
          duplicated: true
        };
      }

      const walletAddressInUse = await trx
        .selectFrom('wallet_address_bindings')
        .selectAll()
        .where('wallet_address', '=', input.walletAddress)
        .executeTakeFirst();
      if (walletAddressInUse && walletAddressInUse.user_id !== input.userId) {
        throw new DomainError(409, 'WALLET_ADDRESS_IN_USE', 'wallet address is already bound to another user');
      }

      const existing = await trx
        .selectFrom('virtual_wallet_bindings')
        .selectAll()
        .where('user_id', '=', input.userId)
        .where('currency_id', '=', input.currencyId)
        .where('status', '=', 'active')
        .executeTakeFirst();

      const stored = await trx
        .insertInto('virtual_wallet_bindings')
        .values({
          virtual_wallet_id: randomUUID(),
          user_id: input.userId,
          currency_id: input.currencyId,
          network: input.network,
          wallet_address: input.walletAddress,
          encrypted_private_key: input.encryptedPrivateKey,
          sweep_target_address: input.sweepTargetAddress,
          issued_by: 'hot_wallet',
          idempotency_key: input.idempotencyKey,
          status: 'active',
          activation_status: 'pending_trx_grant',
          activation_grant_tx_hash: null,
          activation_granted_at: null,
          activation_reclaim_tx_hash: null,
          activation_reclaimed_at: null,
          activation_last_error: null,
          resource_status: 'idle',
          resource_delegated_at: null,
          resource_released_at: null,
          resource_last_error: null,
          created_at: nowIso,
          retired_at: null,
          disabled_at: null,
          replaced_by_virtual_wallet_id: null
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (existing) {
        await trx
          .updateTable('virtual_wallet_bindings')
          .set({
            status: 'retired',
            retired_at: nowIso,
            replaced_by_virtual_wallet_id: stored.virtual_wallet_id
          })
          .where('virtual_wallet_id', '=', existing.virtual_wallet_id)
          .execute();
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

      return {
        binding: this.mapBinding(stored),
        duplicated: false
      };
    });
  }

  async getVirtualWallet(input: { userId?: string; walletAddress?: string }): Promise<VirtualWalletBinding | undefined> {
    if (input.userId) {
      const row =
        (await this.db
          .selectFrom('virtual_wallet_bindings')
          .selectAll()
          .where('user_id', '=', input.userId)
          .where('status', '=', 'active')
          .executeTakeFirst()) ??
        (await this.db
          .selectFrom('virtual_wallet_bindings')
          .selectAll()
          .where('user_id', '=', input.userId)
          .orderBy('created_at desc')
          .executeTakeFirst());
      return row ? this.mapBinding(row) : undefined;
    }

    if (input.walletAddress) {
      const row = await this.db
        .selectFrom('virtual_wallet_bindings')
        .selectAll()
        .where('wallet_address', '=', input.walletAddress)
        .executeTakeFirst();
      return row ? this.mapBinding(row) : undefined;
    }

    throw new DomainError(400, 'VALIDATION_ERROR', 'userId or walletAddress is required');
  }

  async listVirtualWalletsByActivationStatus(
    status: VirtualWalletBinding['activationStatus'],
    limit = 100
  ): Promise<VirtualWalletBinding[]> {
    const rows = await this.db
      .selectFrom('virtual_wallet_bindings')
      .selectAll()
      .where('status', '=', 'active')
      .where('activation_status', '=', status)
      .orderBy('created_at asc')
      .limit(Math.max(1, Math.min(limit, 500)))
      .execute();
    return rows.map((row) => this.mapBinding(row));
  }

  async retireVirtualWallet(input: {
    virtualWalletId: string;
    replacedByVirtualWalletId?: string;
    nowIso?: string;
  }): Promise<VirtualWalletBinding> {
    const existing = await this.db
      .selectFrom('virtual_wallet_bindings')
      .selectAll()
      .where('virtual_wallet_id', '=', input.virtualWalletId)
      .executeTakeFirst();
    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'virtual wallet not found');
    }
    if (existing.status !== 'active') {
      return this.mapBinding(existing);
    }

    const row = await this.db
      .updateTable('virtual_wallet_bindings')
      .set({
        status: 'retired',
        retired_at: input.nowIso ?? new Date().toISOString(),
        replaced_by_virtual_wallet_id: input.replacedByVirtualWalletId ?? null
      })
      .where('virtual_wallet_id', '=', input.virtualWalletId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.mapBinding(row);
  }

  async disableVirtualWallet(input: { virtualWalletId: string; nowIso?: string }): Promise<VirtualWalletBinding> {
    const existing = await this.db
      .selectFrom('virtual_wallet_bindings')
      .selectAll()
      .where('virtual_wallet_id', '=', input.virtualWalletId)
      .executeTakeFirst();
    if (!existing) {
      throw new DomainError(404, 'NOT_FOUND', 'virtual wallet not found');
    }
    if (existing.status === 'disabled') {
      return this.mapBinding(existing);
    }

    const row = await this.db
      .updateTable('virtual_wallet_bindings')
      .set({
        status: 'disabled',
        disabled_at: input.nowIso ?? new Date().toISOString()
      })
      .where('virtual_wallet_id', '=', input.virtualWalletId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.mapBinding(row);
  }

  async markActivationGranted(input: { virtualWalletId: string; txHash?: string; nowIso?: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      activation_status: 'trx_granted',
      activation_grant_tx_hash: input.txHash ?? null,
      activation_granted_at: input.nowIso ?? new Date().toISOString(),
      activation_last_error: null
    });
  }

  async markActivationReclaimPending(input: { virtualWalletId: string; txHash?: string; nowIso?: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      activation_status: 'reclaim_pending',
      activation_reclaim_tx_hash: input.txHash ?? null,
      activation_last_error: null
    });
  }

  async markActivationReclaimed(input: { virtualWalletId: string; txHash?: string; nowIso?: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      activation_status: 'reclaimed',
      activation_reclaim_tx_hash: input.txHash ?? null,
      activation_reclaimed_at: input.nowIso ?? new Date().toISOString(),
      activation_last_error: null
    });
  }

  async markActivationFailed(input: { virtualWalletId: string; message: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      activation_status: 'failed',
      activation_last_error: input.message
    });
  }

  async markResourceDelegated(input: { virtualWalletId: string; nowIso?: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      resource_status: 'delegated',
      resource_delegated_at: input.nowIso ?? new Date().toISOString(),
      resource_last_error: null
    });
  }

  async markResourceReleasePending(input: { virtualWalletId: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      resource_status: 'release_pending',
      resource_last_error: null
    });
  }

  async markResourceReleased(input: { virtualWalletId: string; nowIso?: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      resource_status: 'released',
      resource_released_at: input.nowIso ?? new Date().toISOString(),
      resource_last_error: null
    });
  }

  async markResourceFailed(input: { virtualWalletId: string; message: string }): Promise<VirtualWalletBinding> {
    return this.updateLifecycle(input.virtualWalletId, {
      resource_status: 'failed',
      resource_last_error: input.message
    });
  }

  async listWatchAddresses(network: 'mainnet' | 'testnet'): Promise<DepositWatchAddress[]> {
    const rows = await this.db
      .selectFrom('virtual_wallet_bindings')
      .select(['user_id', 'currency_id', 'wallet_address'])
      .where('network', '=', network)
      .where('status', '=', 'active')
      .execute();

    return rows.map((row) => ({
      userId: row.user_id,
      currencyId: row.currency_id,
      address: row.wallet_address,
      network: 'TRON'
    }));
  }

  async getWalletSignerByAddress(input: {
    address: string;
    currencyId: number;
    network?: 'mainnet' | 'testnet';
  }): Promise<FoxyaWalletSigner | undefined> {
    let query = this.db
      .selectFrom('virtual_wallet_bindings')
      .selectAll()
      .where('wallet_address', '=', input.address)
      .where('currency_id', '=', input.currencyId)
      .where('status', '=', 'active');

    if (input.network) {
      query = query.where('network', '=', input.network);
    }

    const row = await query.executeTakeFirst();
    if (!row) {
      return undefined;
    }

    return {
      userId: row.user_id,
      currencyId: row.currency_id,
      address: row.wallet_address,
      privateKey: this.keyCipher.decrypt(row.encrypted_private_key)
    };
  }

  private async lockKey(db: Kysely<KorionDatabase>, value: string) {
    await sql`select pg_advisory_xact_lock(hashtext(${value}))`.execute(db);
  }

  private async updateLifecycle(
    virtualWalletId: string,
    values: Partial<KorionDatabase['virtual_wallet_bindings']>
  ): Promise<VirtualWalletBinding> {
    const row = await this.db
      .updateTable('virtual_wallet_bindings')
      .set(values)
      .where('virtual_wallet_id', '=', virtualWalletId)
      .returningAll()
      .executeTakeFirst();
    if (!row) {
      throw new DomainError(404, 'NOT_FOUND', 'virtual wallet not found');
    }
    return this.mapBinding(row);
  }

  private mapBinding(row: KorionDatabase['virtual_wallet_bindings']): VirtualWalletBinding {
    return {
      virtualWalletId: row.virtual_wallet_id,
      userId: row.user_id,
      currencyId: row.currency_id,
      network: row.network,
      walletAddress: row.wallet_address,
      sweepTargetAddress: row.sweep_target_address,
      issuedBy: row.issued_by,
      status: row.status,
      activationStatus: row.activation_status,
      activationGrantTxHash: row.activation_grant_tx_hash ?? undefined,
      activationGrantedAt: row.activation_granted_at ?? undefined,
      activationReclaimTxHash: row.activation_reclaim_tx_hash ?? undefined,
      activationReclaimedAt: row.activation_reclaimed_at ?? undefined,
      activationLastError: row.activation_last_error ?? undefined,
      resourceStatus: row.resource_status,
      resourceDelegatedAt: row.resource_delegated_at ?? undefined,
      resourceReleasedAt: row.resource_released_at ?? undefined,
      resourceLastError: row.resource_last_error ?? undefined,
      createdAt: row.created_at,
      retiredAt: row.retired_at ?? undefined,
      disabledAt: row.disabled_at ?? undefined,
      replacedByVirtualWalletId: row.replaced_by_virtual_wallet_id ?? undefined
    };
  }
}
