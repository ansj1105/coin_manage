import { env } from '../../config/env.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { TronGateway } from '../ports/tron-gateway.js';
import { AlertService } from './alert-service.js';
import { WithdrawService } from './withdraw-service.js';
import { WithdrawGuardService } from './withdraw-guard-service.js';

class RetryableWithdrawDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableWithdrawDispatchError';
  }
}

export class WithdrawDispatchWorker {
  constructor(
    private readonly ledger: LedgerRepository,
    private withdrawService: WithdrawService | undefined,
    private readonly tronGateway: TronGateway,
    private readonly alertService: AlertService,
    private readonly options = {
      hotWalletAddress: env.hotWalletAddress,
      minTrxSun: env.withdrawMinTrxSun,
      minBandwidth: env.withdrawMinBandwidth,
      minEnergy: env.withdrawMinEnergy
    },
    private readonly withdrawGuardService = new WithdrawGuardService(tronGateway)
  ) {}

  setWithdrawService(withdrawService: WithdrawService) {
    this.withdrawService = withdrawService;
  }

  async processDispatch(withdrawalId?: string, attempt = 1) {
    if (!withdrawalId) {
      throw new Error('withdraw dispatch job requires withdrawalId');
    }

    const service = this.getWithdrawService();
    const withdrawal = await service.get(withdrawalId);
    if (!withdrawal) {
      throw new Error('withdrawal not found');
    }

    if (withdrawal.status === 'COMPLETED' || withdrawal.status === 'FAILED' || withdrawal.status === 'TX_BROADCASTED') {
      return;
    }
    if (withdrawal.status !== 'ADMIN_APPROVED') {
      throw new Error(`withdrawal is not dispatchable in state ${withdrawal.status}`);
    }

    try {
      await this.ensureHotWalletResources(withdrawalId);
      await service.broadcast(withdrawalId);
    } catch (error) {
      await this.handleAttemptFailure(withdrawalId, attempt, error);
      throw error;
    }
  }

  async processReconcile(withdrawalId?: string, attempt = 1) {
    try {
      if (withdrawalId) {
        const withdrawal = await this.getWithdrawService().get(withdrawalId);
        if (!withdrawal || withdrawal.status === 'COMPLETED' || withdrawal.status === 'FAILED') {
          return;
        }
      }

      const result = await this.getWithdrawService().reconcileBroadcasted();
      if (!result.pending.length) {
        return;
      }

      if (withdrawalId && result.pending.includes(withdrawalId)) {
        throw new RetryableWithdrawDispatchError('broadcasted withdrawal still pending on-chain');
      }
      if (!withdrawalId && result.pending.length > 0 && !result.confirmed.length && !result.failed.length) {
        throw new RetryableWithdrawDispatchError('broadcasted withdrawals still pending on-chain');
      }
    } catch (error) {
      await this.handleAttemptFailure(withdrawalId ?? '-', attempt, error);
      throw error;
    }
  }

  private async handleAttemptFailure(withdrawalId: string, attempt: number, error: unknown) {
    const message = error instanceof Error ? error.message : 'withdraw dispatch worker failed';
    if (error instanceof RetryableWithdrawDispatchError) {
      await this.alertService.notifyWithdrawalDispatchRetry({
        withdrawalId,
        retryCount: attempt,
        reason: message
      });
      return;
    }

    await this.alertService.notifyWithdrawalDispatchFailed({
      withdrawalId,
      reason: message
    });
  }

  private async ensureHotWalletResources(withdrawalId: string) {
    const readiness = await this.withdrawGuardService.getHotWalletReadiness();
    if (readiness.ready) {
      return;
    }

    await this.alertService.notifyWithdrawalResourceLow({
      withdrawalId,
      hotWalletAddress: this.options.hotWalletAddress,
      trxBalanceSun: readiness.trxBalanceSun,
      availableBandwidth: readiness.availableBandwidth,
      availableEnergy: readiness.availableEnergy,
      minTrxSun: this.options.minTrxSun.toString(),
      minBandwidth: this.options.minBandwidth,
      minEnergy: this.options.minEnergy
    });
    throw new RetryableWithdrawDispatchError(`hot wallet is not ready: ${readiness.failures.join(',')}`);
  }

  private getWithdrawService() {
    if (!this.withdrawService) {
      throw new Error('withdraw service is not configured');
    }
    return this.withdrawService;
  }
}
