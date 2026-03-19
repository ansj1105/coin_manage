import { env } from '../../config/env.js';
import type { PerWalletSigner } from '../ports/per-wallet-signer.js';
import type { TronGateway } from '../ports/tron-gateway.js';
import type { VirtualWalletRepository } from '../ports/virtual-wallet-repository.js';
import { AlertService } from './alert-service.js';

const TRX_SUN = 1_000_000n;

type ActivationReclaimOptions = {
  enabled: boolean;
  cycleLimit: number;
  amountTrx: number;
  minAvailableBandwidth: number;
};

export class ActivationReclaimService {
  constructor(
    private readonly virtualWalletRepository: VirtualWalletRepository,
    private readonly tronGateway: TronGateway,
    private readonly perWalletSigner: PerWalletSigner,
    private readonly alertService: AlertService,
    private readonly options: ActivationReclaimOptions = {
      enabled: env.activationReclaimEnabled,
      cycleLimit: env.activationReclaimCycleLimit,
      amountTrx: env.activationReclaimAmountTrx,
      minAvailableBandwidth: env.activationReclaimMinBandwidth
    }
  ) {}

  async runCycle() {
    if (!this.options.enabled) {
      return { skipped: true as const, reason: 'activation reclaim disabled' };
    }

    const bindings = await this.virtualWalletRepository.listVirtualWalletsByActivationStatus(
      'trx_granted',
      this.options.cycleLimit
    );

    const reclaimed: string[] = [];
    const waiting: string[] = [];
    const failed: string[] = [];
    const reclaimAmountSun = BigInt(Math.round(this.options.amountTrx * Number(TRX_SUN)));

    for (const binding of bindings) {
      const resources = await this.tronGateway.getAccountResources(binding.walletAddress, binding.network);
      const availableBandwidth = Math.max(0, resources.bandwidthLimit - resources.bandwidthUsed);
      if (availableBandwidth < this.options.minAvailableBandwidth || resources.trxBalanceSun < reclaimAmountSun) {
        await this.alertService.notifyActivationReclaimWaiting({
          userId: binding.userId,
          walletAddress: binding.walletAddress,
          availableBandwidth,
          trxBalanceSun: resources.trxBalanceSun.toString(),
          requiredBandwidth: this.options.minAvailableBandwidth,
          requiredTrxSun: reclaimAmountSun.toString()
        });
        waiting.push(binding.virtualWalletId);
        continue;
      }

      try {
        await this.virtualWalletRepository.markActivationReclaimPending({
          virtualWalletId: binding.virtualWalletId
        });

        const { txHash } = await this.perWalletSigner.broadcastActivationReclaim({
          virtualWalletId: binding.virtualWalletId,
          walletAddress: binding.walletAddress,
          currencyId: binding.currencyId,
          toAddress: binding.sweepTargetAddress,
          amountSun: reclaimAmountSun,
          network: binding.network,
        });
        await this.virtualWalletRepository.markActivationReclaimed({
          virtualWalletId: binding.virtualWalletId,
          txHash
        });
        reclaimed.push(binding.virtualWalletId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'activation reclaim failed';
        await this.virtualWalletRepository.markActivationFailed({
          virtualWalletId: binding.virtualWalletId,
          message
        });
        await this.alertService.notifyActivationReclaimFailure({
          userId: binding.userId,
          walletAddress: binding.walletAddress,
          message
        });
        failed.push(binding.virtualWalletId);
      }
    }

    return {
      skipped: false as const,
      reclaimed,
      waiting,
      failed
    };
  }
}
