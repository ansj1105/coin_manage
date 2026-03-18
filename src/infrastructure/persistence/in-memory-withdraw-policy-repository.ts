import type { WithdrawPolicyRepository } from '../../application/ports/withdraw-policy-repository.js';
import type { WithdrawAddressPolicy, WithdrawAddressPolicyType } from '../../domain/withdraw-policy/types.js';

const buildKey = (address: string, policyType: WithdrawAddressPolicyType) => `${address}:${policyType}`;

export class InMemoryWithdrawPolicyRepository implements WithdrawPolicyRepository {
  private readonly addressPolicies = new Map<string, WithdrawAddressPolicy>();

  async upsertAddressPolicy(input: {
    address: string;
    policyType: WithdrawAddressPolicyType;
    reason?: string;
    createdBy: string;
    nowIso?: string;
  }): Promise<WithdrawAddressPolicy> {
    const nowIso = input.nowIso ?? new Date().toISOString();
    const existing = this.addressPolicies.get(buildKey(input.address, input.policyType));
    const policy: WithdrawAddressPolicy = {
      address: input.address,
      policyType: input.policyType,
      reason: input.reason,
      createdBy: existing?.createdBy ?? input.createdBy,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso
    };
    this.addressPolicies.set(buildKey(input.address, input.policyType), policy);
    return { ...policy };
  }

  async getAddressPolicies(address: string): Promise<WithdrawAddressPolicy[]> {
    return [...this.addressPolicies.values()]
      .filter((policy) => policy.address === address)
      .map((policy) => ({ ...policy }));
  }

  async listAddressPolicies(input: {
    address?: string;
    policyType?: WithdrawAddressPolicyType;
    limit?: number;
  } = {}): Promise<WithdrawAddressPolicy[]> {
    return [...this.addressPolicies.values()]
      .filter((policy) => !input.address || policy.address === input.address)
      .filter((policy) => !input.policyType || policy.policyType === input.policyType)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 100)
      .map((policy) => ({ ...policy }));
  }

  async deleteAddressPolicy(address: string, policyType: WithdrawAddressPolicyType): Promise<boolean> {
    return this.addressPolicies.delete(buildKey(address, policyType));
  }
}
