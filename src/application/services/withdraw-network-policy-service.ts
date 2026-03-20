import { DomainError } from '../../domain/errors/domain-error.js';
import { getEffectiveBlockchainNetwork } from '../../config/runtime-settings.js';
import type { FoxyaUserFlagRepository } from '../ports/foxya-user-flag-repository.js';

export class WithdrawNetworkPolicyService {
  constructor(private readonly foxyaUserFlagRepository: FoxyaUserFlagRepository) {}

  async assertUserWithdrawalNetworkAllowed(userId: string) {
    const isTestUser = await this.foxyaUserFlagRepository.isTestUser(userId);
    if (!isTestUser) {
      return;
    }

    const effectiveNetwork = getEffectiveBlockchainNetwork();
    if (effectiveNetwork !== 'testnet') {
      throw new DomainError(
        403,
        'TEST_USER_MAINNET_WITHDRAW_FORBIDDEN',
        'test users can only withdraw on testnet'
      );
    }
  }
}
