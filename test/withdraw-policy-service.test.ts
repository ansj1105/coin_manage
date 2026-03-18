import { describe, expect, it } from 'vitest';
import { WithdrawPolicyService } from '../src/application/services/withdraw-policy-service.js';
import { InMemoryWithdrawPolicyRepository } from '../src/infrastructure/persistence/in-memory-withdraw-policy-repository.js';

const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('withdraw policy service', () => {
  it('upserts, lists, and deletes address policies', async () => {
    const service = new WithdrawPolicyService(new InMemoryWithdrawPolicyRepository());

    const created = await service.upsertAddressPolicy({
      address: VALID_TRON_ADDRESS,
      policyType: 'blacklist',
      reason: 'risk-detected',
      createdBy: 'ops-admin-1'
    });

    expect(created.address).toBe(VALID_TRON_ADDRESS);
    expect(created.policyType).toBe('blacklist');

    const listed = await service.listAddressPolicies({
      address: VALID_TRON_ADDRESS
    });
    expect(listed).toHaveLength(1);

    await expect(service.assertAddressAllowed(VALID_TRON_ADDRESS)).rejects.toMatchObject({
      code: 'WITHDRAW_DESTINATION_BLOCKED'
    });

    expect(await service.deleteAddressPolicy(VALID_TRON_ADDRESS, 'blacklist')).toBe(true);
    await expect(service.assertAddressAllowed(VALID_TRON_ADDRESS)).resolves.toBeUndefined();
  });
});
