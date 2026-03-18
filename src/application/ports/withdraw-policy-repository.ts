import type { WithdrawAddressPolicy, WithdrawAddressPolicyType } from '../../domain/withdraw-policy/types.js';

export interface WithdrawPolicyRepository {
  upsertAddressPolicy(input: {
    address: string;
    policyType: WithdrawAddressPolicyType;
    reason?: string;
    createdBy: string;
    nowIso?: string;
  }): Promise<WithdrawAddressPolicy>;
  getAddressPolicies(address: string): Promise<WithdrawAddressPolicy[]>;
  listAddressPolicies(input?: {
    address?: string;
    policyType?: WithdrawAddressPolicyType;
    limit?: number;
  }): Promise<WithdrawAddressPolicy[]>;
  deleteAddressPolicy(address: string, policyType: WithdrawAddressPolicyType): Promise<boolean>;
}
