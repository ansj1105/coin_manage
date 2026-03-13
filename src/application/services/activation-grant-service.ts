import { env } from '../../config/env.js';
import type { TronGateway } from '../ports/tron-gateway.js';
import type { VirtualWalletRepository } from '../ports/virtual-wallet-repository.js';
import { AlertService } from './alert-service.js';

const TRX_SUN = 1_000_000n;

type ActivationGrantOptions = {
  enabled: boolean;
  cycleLimit: number;
  amountTrx: number;
};

export class ActivationGrantService {
  constructor(
    private readonly virtualWalletRepository: VirtualWalletRepository,
    private readonly tronGateway: TronGateway,
    private readonly alertService: AlertService,
    private readonly options: ActivationGrantOptions = {
      enabled: env.activationGrantEnabled,
      cycleLimit: env.activationGrantCycleLimit,
      amountTrx: env.activationGrantAmountTrx
    }
  ) {}

  async runCycle() {
    if (!this.options.enabled) {
      return { skipped: true as const, reason: 'activation grant disabled' };
    }

    const bindings = await this.virtualWalletRepository.listVirtualWalletsByActivationStatus(
      'pending_trx_grant',
      this.options.cycleLimit
    );

    const granted: string[] = [];
    const failed: string[] = [];

    for (const binding of bindings) {
      try {
        const { txHash } = await this.tronGateway.broadcastNativeTransfer({
          toAddress: binding.walletAddress,
          amount: BigInt(Math.round(this.options.amountTrx * Number(TRX_SUN))),
          network: binding.network
        });
        await this.virtualWalletRepository.markActivationGranted({
          virtualWalletId: binding.virtualWalletId,
          txHash
        });
        granted.push(binding.virtualWalletId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'activation grant failed';
        await this.virtualWalletRepository.markActivationFailed({
          virtualWalletId: binding.virtualWalletId,
          message
        });
        await this.alertService.notifyActivationGrantFailure({
          userId: binding.userId,
          walletAddress: binding.walletAddress,
          message
        });
        failed.push(binding.virtualWalletId);
      }
    }

    return {
      skipped: false as const,
      granted,
      failed
    };
  }
}
