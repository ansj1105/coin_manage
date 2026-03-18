import type { Kysely } from 'kysely';
import type { WithdrawPolicyRepository } from '../../../application/ports/withdraw-policy-repository.js';
import type { WithdrawAddressPolicy, WithdrawAddressPolicyType } from '../../../domain/withdraw-policy/types.js';
import type { KorionDatabase } from './db-schema.js';

export class PostgresWithdrawPolicyRepository implements WithdrawPolicyRepository {
  constructor(private readonly db: Kysely<KorionDatabase>) {}

  async upsertAddressPolicy(input: {
    address: string;
    policyType: WithdrawAddressPolicyType;
    reason?: string;
    createdBy: string;
    nowIso?: string;
  }): Promise<WithdrawAddressPolicy> {
    const nowIso = input.nowIso ?? new Date().toISOString();

    await this.db
      .insertInto('withdraw_address_policies')
      .values({
        address: input.address,
        policy_type: input.policyType,
        reason: input.reason ?? null,
        created_by: input.createdBy,
        created_at: nowIso,
        updated_at: nowIso
      })
      .onConflict((oc) =>
        oc.columns(['address', 'policy_type']).doUpdateSet({
          reason: input.reason ?? null,
          updated_at: nowIso
        })
      )
      .execute();

    const stored = await this.db
      .selectFrom('withdraw_address_policies')
      .selectAll()
      .where('address', '=', input.address)
      .where('policy_type', '=', input.policyType)
      .executeTakeFirstOrThrow();

    return this.mapPolicy(stored);
  }

  async getAddressPolicies(address: string): Promise<WithdrawAddressPolicy[]> {
    const rows = await this.db
      .selectFrom('withdraw_address_policies')
      .selectAll()
      .where('address', '=', address)
      .orderBy('updated_at', 'desc')
      .execute();

    return rows.map((row) => this.mapPolicy(row));
  }

  async listAddressPolicies(input: {
    address?: string;
    policyType?: WithdrawAddressPolicyType;
    limit?: number;
  } = {}): Promise<WithdrawAddressPolicy[]> {
    let query = this.db
      .selectFrom('withdraw_address_policies')
      .selectAll()
      .orderBy('updated_at', 'desc')
      .limit(input.limit ?? 100);

    if (input.address) {
      query = query.where('address', '=', input.address);
    }
    if (input.policyType) {
      query = query.where('policy_type', '=', input.policyType);
    }

    const rows = await query.execute();
    return rows.map((row) => this.mapPolicy(row));
  }

  async deleteAddressPolicy(address: string, policyType: WithdrawAddressPolicyType): Promise<boolean> {
    const result = await this.db
      .deleteFrom('withdraw_address_policies')
      .where('address', '=', address)
      .where('policy_type', '=', policyType)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0) > 0;
  }

  private mapPolicy(row: KorionDatabase['withdraw_address_policies']): WithdrawAddressPolicy {
    return {
      address: row.address,
      policyType: row.policy_type,
      reason: row.reason ?? undefined,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
