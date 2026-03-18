import { DomainError } from '../../core/domain-error.js';
import type { WithdrawPolicyRepository } from '../ports/withdraw-policy-repository.js';
import type { WithdrawAddressPolicyType } from '../../domain/withdraw-policy/types.js';

const BLOCKING_POLICY_TYPES = new Set<WithdrawAddressPolicyType>(['blacklist', 'internal_blocked']);

export class WithdrawPolicyService {
  constructor(private readonly repository: WithdrawPolicyRepository) {}

  async assertAddressAllowed(address: string) {
    const policies = await this.repository.getAddressPolicies(address);
    const blockingPolicy = policies.find((policy) => BLOCKING_POLICY_TYPES.has(policy.policyType));
    if (!blockingPolicy) {
      return;
    }

    throw new DomainError(400, 'WITHDRAW_DESTINATION_BLOCKED', 'withdraw destination is blocked by policy', {
      address,
      policyType: blockingPolicy.policyType,
      reason: blockingPolicy.reason ?? ''
    });
  }

  async upsertAddressPolicy(input: {
    address: string;
    policyType: WithdrawAddressPolicyType;
    reason?: string;
    createdBy: string;
  }) {
    return this.repository.upsertAddressPolicy(input);
  }

  async listAddressPolicies(input?: {
    address?: string;
    policyType?: WithdrawAddressPolicyType;
    limit?: number;
  }) {
    return this.repository.listAddressPolicies(input);
  }

  async deleteAddressPolicy(address: string, policyType: WithdrawAddressPolicyType) {
    return this.repository.deleteAddressPolicy(address, policyType);
  }
}
