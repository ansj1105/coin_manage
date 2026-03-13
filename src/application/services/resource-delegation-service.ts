import { env } from '../../config/env.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { TronGateway, TronResourceType } from '../ports/tron-gateway.js';
import type { VirtualWalletRepository } from '../ports/virtual-wallet-repository.js';
import { AlertService } from './alert-service.js';

const TRX_SUN = 1_000_000n;

type ResourceDelegationOptions = {
  enabled: boolean;
  cycleLimit: number;
  bandwidthAmountSun: bigint;
  energyAmountSun: bigint;
  hotWalletAddress: string;
};

export class ResourceDelegationService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly virtualWalletRepository: VirtualWalletRepository,
    private readonly tronGateway: TronGateway,
    private readonly alertService: AlertService,
    private readonly options: ResourceDelegationOptions = {
      enabled: env.resourceDelegationEnabled,
      cycleLimit: env.resourceDelegationCycleLimit,
      bandwidthAmountSun: BigInt(Math.round(env.resourceDelegationBandwidthTrx * Number(TRX_SUN))),
      energyAmountSun: BigInt(Math.round(env.resourceDelegationEnergyTrx * Number(TRX_SUN))),
      hotWalletAddress: env.hotWalletAddress
    }
  ) {}

  async runCycle() {
    if (!this.options.enabled) {
      return { skipped: true as const, reason: 'resource delegation disabled' };
    }

    const [queuedSweeps, settledSweeps, activeSweeps] = await Promise.all([
      this.ledger.listSweepRecordsByStatuses(['queued'], this.options.cycleLimit),
      this.ledger.listSweepRecordsByStatuses(['confirmed', 'failed'], this.options.cycleLimit),
      this.ledger.listSweepRecordsByStatuses(['queued', 'broadcasted'], this.options.cycleLimit * 5)
    ]);

    const delegated: string[] = [];
    const released: string[] = [];
    const waiting: string[] = [];
    const failed: string[] = [];
    const activeSourceAddresses = new Set(activeSweeps.map((sweep) => sweep.sourceAddress));

    for (const sourceAddress of this.uniqueAddresses(queuedSweeps.map((sweep) => sweep.sourceAddress))) {
      const result = await this.delegateForAddress(sourceAddress);
      if (result === 'delegated') {
        delegated.push(sourceAddress);
      } else if (result === 'waiting') {
        waiting.push(sourceAddress);
      } else if (result === 'failed') {
        failed.push(sourceAddress);
      }
    }

    for (const sourceAddress of this.uniqueAddresses(settledSweeps.map((sweep) => sweep.sourceAddress))) {
      if (activeSourceAddresses.has(sourceAddress)) {
        continue;
      }
      const result = await this.releaseForAddress(sourceAddress);
      if (result === 'released') {
        released.push(sourceAddress);
      } else if (result === 'failed') {
        failed.push(sourceAddress);
      }
    }

    return {
      skipped: false as const,
      delegated,
      released,
      waiting,
      failed
    };
  }

  private async delegateForAddress(sourceAddress: string): Promise<'delegated' | 'waiting' | 'failed' | 'skipped'> {
    const binding = await this.virtualWalletRepository.getVirtualWallet({ walletAddress: sourceAddress });
    if (!binding || binding.status !== 'active' || binding.activationStatus !== 'reclaimed') {
      return 'skipped';
    }
    if (binding.resourceStatus === 'delegated' || binding.resourceStatus === 'release_pending') {
      return 'skipped';
    }

    try {
      await this.virtualWalletRepository.markResourceDelegatePending({
        virtualWalletId: binding.virtualWalletId
      });

      const resources: Array<{ resource: TronResourceType; amountSun: bigint }> = [];
      if (this.options.bandwidthAmountSun > 0n) {
        resources.push({ resource: 'BANDWIDTH', amountSun: this.options.bandwidthAmountSun });
      }
      if (this.options.energyAmountSun > 0n) {
        resources.push({ resource: 'ENERGY', amountSun: this.options.energyAmountSun });
      }

      for (const item of resources) {
        const delegatable = await this.tronGateway.getCanDelegatedMaxSize(
          this.options.hotWalletAddress,
          item.resource,
          binding.network
        );
        if (delegatable < item.amountSun) {
          await this.virtualWalletRepository.markResourceFailed({
            virtualWalletId: binding.virtualWalletId,
            message: `${item.resource} delegatable stake is below required amount`
          });
          await this.alertService.notifyResourceDelegationWaiting({
            userId: binding.userId,
            walletAddress: binding.walletAddress,
            resource: item.resource,
            requiredSun: item.amountSun.toString(),
            availableSun: delegatable.toString()
          });
          return 'waiting';
        }
      }

      for (const item of resources) {
        await this.tronGateway.delegateResource({
          receiverAddress: binding.walletAddress,
          amountSun: item.amountSun,
          resource: item.resource,
          network: binding.network,
          fromAddress: this.options.hotWalletAddress
        });
      }

      await this.virtualWalletRepository.markResourceDelegated({
        virtualWalletId: binding.virtualWalletId
      });
      return 'delegated';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'resource delegation failed';
      await this.virtualWalletRepository.markResourceFailed({
        virtualWalletId: binding.virtualWalletId,
        message
      });
      await this.alertService.notifyResourceDelegationFailure({
        userId: binding.userId,
        walletAddress: binding.walletAddress,
        message
      });
      return 'failed';
    }
  }

  private async releaseForAddress(sourceAddress: string): Promise<'released' | 'failed' | 'skipped'> {
    const binding = await this.virtualWalletRepository.getVirtualWallet({ walletAddress: sourceAddress });
    if (!binding || binding.status !== 'active') {
      return 'skipped';
    }
    if (!['delegated', 'release_pending'].includes(binding.resourceStatus)) {
      return 'skipped';
    }

    try {
      await this.virtualWalletRepository.markResourceReleasePending({
        virtualWalletId: binding.virtualWalletId
      });

      for (const resource of ['BANDWIDTH', 'ENERGY'] as const) {
        const delegatedAmount = await this.tronGateway.getDelegatedResource(
          this.options.hotWalletAddress,
          binding.walletAddress,
          resource,
          binding.network
        );
        if (delegatedAmount <= 0n) {
          continue;
        }

        await this.tronGateway.undelegateResource({
          receiverAddress: binding.walletAddress,
          amountSun: delegatedAmount,
          resource,
          network: binding.network,
          fromAddress: this.options.hotWalletAddress
        });
      }

      await this.virtualWalletRepository.markResourceReleased({
        virtualWalletId: binding.virtualWalletId
      });
      return 'released';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'resource release failed';
      await this.virtualWalletRepository.markResourceFailed({
        virtualWalletId: binding.virtualWalletId,
        message
      });
      await this.alertService.notifyResourceReleaseFailure({
        userId: binding.userId,
        walletAddress: binding.walletAddress,
        message
      });
      return 'failed';
    }
  }

  private uniqueAddresses(addresses: string[]) {
    return [...new Set(addresses.filter(Boolean))];
  }
}
