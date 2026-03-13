import { DomainError } from '../../domain/errors/domain-error.js';
import type { VirtualWalletRepository } from '../ports/virtual-wallet-repository.js';
import type { VirtualWalletBinding } from '../../domain/virtual-wallet/types.js';
import { env } from '../../config/env.js';

export class VirtualWalletLifecyclePolicyService {
  constructor(private readonly virtualWalletRepository: VirtualWalletRepository) {}

  async getStatus(input: { userId?: string; walletAddress?: string }) {
    const binding = await this.virtualWalletRepository.getVirtualWallet(input);
    return {
      binding,
      gate: this.evaluate(binding)
    };
  }

  async assertWithdrawalAllowed(input: { userId?: string; walletAddress?: string }) {
    const binding = await this.virtualWalletRepository.getVirtualWallet(input);
    const gate = this.evaluate(binding);
    if (!gate.withdrawAllowed) {
      throw new DomainError(409, 'WITHDRAWAL_NOT_READY', gate.reason);
    }
    return binding;
  }

  async canCreditDeposit(input: { userId?: string; walletAddress?: string }) {
    const binding = await this.virtualWalletRepository.getVirtualWallet(input);
    return {
      binding,
      gate: this.evaluate(binding)
    };
  }

  private evaluate(binding?: VirtualWalletBinding) {
    if (!binding) {
      return {
        depositAllowed: true,
        withdrawAllowed: true,
        reason: 'no managed virtual wallet'
      };
    }

    if (binding.status !== 'active') {
      return {
        depositAllowed: false,
        withdrawAllowed: false,
        reason: `virtual wallet is ${binding.status}`
      };
    }

    if (binding.activationStatus !== 'reclaimed') {
      return {
        depositAllowed: false,
        withdrawAllowed: false,
        reason: `activation not completed: ${binding.activationStatus}`
      };
    }

    const cooldownUntilMs = new Date(binding.createdAt).getTime() + env.signupWalletCooldownSec * 1000;
    if (Date.now() < cooldownUntilMs) {
      return {
        depositAllowed: false,
        withdrawAllowed: false,
        reason: `signup cooldown active until ${new Date(cooldownUntilMs).toISOString()}`
      };
    }

    return {
      depositAllowed: true,
      withdrawAllowed: true,
      reason: 'ready'
    };
  }
}
