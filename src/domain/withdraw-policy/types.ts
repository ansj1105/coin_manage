export type WithdrawAddressPolicyType = 'blacklist' | 'whitelist' | 'internal_blocked';

export interface WithdrawAddressPolicy {
  address: string;
  policyType: WithdrawAddressPolicyType;
  reason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
