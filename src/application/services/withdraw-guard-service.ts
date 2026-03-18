import { TronWeb } from 'tronweb';
import { env } from '../../config/env.js';
import { getConfiguredSystemWallets } from '../../config/system-wallets.js';
import { DomainError } from '../../core/domain-error.js';
import type { TronGateway } from '../ports/tron-gateway.js';
import type { WithdrawPolicyRepository } from '../ports/withdraw-policy-repository.js';
import { WithdrawPolicyService } from './withdraw-policy-service.js';

const PLACEHOLDER_PRIVATE_KEYS = new Set(['replace-with-private-key', 'dev-only-private-key-change-me']);

export interface HotWalletReadiness {
  ready: boolean;
  signerHealthy: boolean;
  signerAddress?: string;
  trxBalanceSun: string;
  availableBandwidth: number;
  availableEnergy: number;
  minTrxSun: string;
  minBandwidth: number;
  minEnergy: number;
  failures: string[];
}

type WithdrawGuardOptions = {
  tronGatewayMode: 'mock' | 'trc20';
  hotWalletAddress: string;
  hotWalletPrivateKey: string;
  minTrxSun: bigint;
  minBandwidth: number;
  minEnergy: number;
  restrictedDestinationAddresses: string[];
  policyService?: WithdrawPolicyService;
};

export class WithdrawGuardService {
  constructor(
    private readonly tronGateway: TronGateway,
    private readonly options: WithdrawGuardOptions = {
      tronGatewayMode: env.tronGatewayMode,
      hotWalletAddress: env.hotWalletAddress,
      hotWalletPrivateKey: env.hotWalletPrivateKey,
      minTrxSun: BigInt(env.withdrawMinTrxSun),
      minBandwidth: env.withdrawMinBandwidth,
      minEnergy: env.withdrawMinEnergy,
      restrictedDestinationAddresses: getConfiguredSystemWallets().map((wallet) => wallet.address),
      policyService: undefined
    }
  ) {}

  static withPolicyRepository(
    tronGateway: TronGateway,
    withdrawPolicyRepository: WithdrawPolicyRepository,
    options: Omit<WithdrawGuardOptions, 'policyService'> = {
      tronGatewayMode: env.tronGatewayMode,
      hotWalletAddress: env.hotWalletAddress,
      hotWalletPrivateKey: env.hotWalletPrivateKey,
      minTrxSun: BigInt(env.withdrawMinTrxSun),
      minBandwidth: env.withdrawMinBandwidth,
      minEnergy: env.withdrawMinEnergy,
      restrictedDestinationAddresses: getConfiguredSystemWallets().map((wallet) => wallet.address)
    }
  ) {
    return new WithdrawGuardService(tronGateway, {
      ...options,
      policyService: new WithdrawPolicyService(withdrawPolicyRepository)
    });
  }

  async assertRequestAllowed(input: { toAddress: string; walletAddress?: string }) {
    this.assertDestinationAllowed(input);
    await this.options.policyService?.assertAddressAllowed(input.toAddress);
    await this.assertHotWalletReady('WITHDRAW_CIRCUIT_OPEN', 'withdraw request circuit is open');
  }

  async assertBroadcastAllowed(input: { toAddress: string }) {
    this.assertDestinationAllowed(input);
    await this.options.policyService?.assertAddressAllowed(input.toAddress);
    await this.assertHotWalletReady('WITHDRAW_BROADCAST_BLOCKED', 'hot wallet is not ready for broadcast');
  }

  async getHotWalletReadiness(): Promise<HotWalletReadiness> {
    if (this.options.tronGatewayMode !== 'trc20') {
      return {
        ready: true,
        signerHealthy: true,
        signerAddress: this.options.hotWalletAddress,
        trxBalanceSun: '0',
        availableBandwidth: Number.MAX_SAFE_INTEGER,
        availableEnergy: Number.MAX_SAFE_INTEGER,
        minTrxSun: this.options.minTrxSun.toString(),
        minBandwidth: this.options.minBandwidth,
        minEnergy: this.options.minEnergy,
        failures: []
      };
    }

    const signer = this.getSignerAddress();
    const resources = await this.tronGateway.getAccountResources(this.options.hotWalletAddress);
    const availableBandwidth = Math.max(0, resources.bandwidthLimit - resources.bandwidthUsed);
    const availableEnergy = Math.max(0, resources.energyLimit - resources.energyUsed);
    const failures: string[] = [];

    if (!signer.healthy) {
      failures.push('signer_unhealthy');
    }
    if (resources.trxBalanceSun < this.options.minTrxSun) {
      failures.push('trx_low');
    }
    if (availableBandwidth < this.options.minBandwidth) {
      failures.push('bandwidth_low');
    }
    if (availableEnergy < this.options.minEnergy) {
      failures.push('energy_low');
    }

    return {
      ready: failures.length === 0,
      signerHealthy: signer.healthy,
      signerAddress: signer.address,
      trxBalanceSun: resources.trxBalanceSun.toString(),
      availableBandwidth,
      availableEnergy,
      minTrxSun: this.options.minTrxSun.toString(),
      minBandwidth: this.options.minBandwidth,
      minEnergy: this.options.minEnergy,
      failures
    };
  }

  private assertDestinationAllowed(input: { toAddress: string; walletAddress?: string }) {
    const restricted = new Set(this.options.restrictedDestinationAddresses.filter(Boolean));
    if (restricted.has(input.toAddress)) {
      throw new DomainError(400, 'WITHDRAW_DESTINATION_RESTRICTED', 'withdraw destination is a managed system wallet');
    }

    if (input.walletAddress && input.walletAddress === input.toAddress) {
      throw new DomainError(400, 'WITHDRAW_DESTINATION_RESTRICTED', 'withdraw destination cannot match the source wallet');
    }
  }

  private async assertHotWalletReady(code: string, message: string) {
    const readiness = await this.getHotWalletReadiness();
    if (readiness.ready) {
      return;
    }

    throw new DomainError(503, code, message, readiness);
  }

  private getSignerAddress(): { healthy: boolean; address?: string } {
    if (PLACEHOLDER_PRIVATE_KEYS.has(this.options.hotWalletPrivateKey)) {
      return { healthy: false };
    }

    try {
      const address = TronWeb.address.fromPrivateKey(this.options.hotWalletPrivateKey);
      if (!address || address !== this.options.hotWalletAddress) {
        return { healthy: false, address: address || undefined };
      }
      return { healthy: true, address };
    } catch {
      return { healthy: false };
    }
  }
}
