import type { DepositMonitorRepository } from '../ports/deposit-monitor-repository.js';
import type { ExternalDepositClient } from '../ports/external-deposit-client.js';
import type { FoxyaWalletRepository } from '../ports/foxya-wallet-repository.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { SweepRecord } from '../../domain/ledger/types.js';
import type { TronGateway } from '../ports/tron-gateway.js';
import { env } from '../../config/env.js';
import { parseStoredKoriAmount } from '../../domain/value-objects/money.js';
import { AlertService } from './alert-service.js';

export interface SweepBotStatus {
  enabled: boolean;
  configured: boolean;
  lastRunAt?: string;
  lastError?: string;
  lastResult?: {
    scanned: number;
    planned: number;
    queued: number;
    broadcasted: number;
    confirmed: number;
    failed: number;
    skipped: number;
  };
}

type SweepStageResult = 'planned' | 'queued' | 'broadcasted' | 'confirmed' | 'failed' | 'skipped';

export class SweepBotService {
  private running = false;
  private status: SweepBotStatus = {
    enabled: env.sweepBotEnabled,
    configured: false
  };

  constructor(
    private readonly depositMonitorRepository: DepositMonitorRepository,
    private readonly foxyaClient: ExternalDepositClient | undefined,
    private readonly foxyaWalletRepository: FoxyaWalletRepository | undefined,
    private readonly ledger: LedgerRepository,
    private readonly tronGateway: TronGateway,
    private readonly alertService: AlertService,
    private readonly enabled = env.sweepBotEnabled
  ) {
    this.status.enabled = this.enabled;
    this.status.configured = Boolean(this.foxyaClient && this.foxyaWalletRepository);
  }

  getStatus(): SweepBotStatus {
    return { ...this.status, lastResult: this.status.lastResult ? { ...this.status.lastResult } : undefined };
  }

  async runCycle(): Promise<{ skipped: true; reason: string } | NonNullable<SweepBotStatus['lastResult']>> {
    if (!this.enabled) {
      return { skipped: true, reason: 'sweep bot disabled' };
    }
    if (!this.foxyaClient || !this.foxyaWalletRepository) {
      return { skipped: true, reason: 'foxya sweep dependencies are not configured' };
    }
    if (this.running) {
      return { skipped: true, reason: 'sweep bot already running' };
    }

    this.running = true;
    try {
      const planResults = await this.planSweepsFromCompletedDeposits();
      const queueResults = await this.queuePlannedSweeps();
      const executeResults = await this.executeQueuedSweeps();
      const confirmResults = await this.confirmBroadcastedSweeps();

      const payload = {
        scanned: planResults.scanned,
        planned: planResults.planned,
        queued: queueResults.queued,
        broadcasted: executeResults.broadcasted,
        confirmed: confirmResults.confirmed,
        failed: planResults.failed + executeResults.failed + confirmResults.failed,
        skipped: planResults.skipped + queueResults.skipped + executeResults.skipped + confirmResults.skipped
      };
      this.status = {
        enabled: this.enabled,
        configured: true,
        lastRunAt: new Date().toISOString(),
        lastResult: payload,
        lastError: undefined
      };
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sweep bot cycle failed';
      this.status = {
        ...this.status,
        enabled: this.enabled,
        configured: true,
        lastRunAt: new Date().toISOString(),
        lastError: message
      };
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async planSweepsFromCompletedDeposits() {
    const events = await this.depositMonitorRepository.listEventsByStatus('completed', env.sweepBotCycleLimit);
    let planned = 0;
    let failed = 0;
    let skipped = 0;

    for (const event of events) {
      const result = await this.planEvent(event.depositId, event.toAddress, event.currencyId, event.amountDecimal, event.network);
      if (result === 'planned') {
        planned += 1;
      } else if (result === 'failed') {
        failed += 1;
      } else {
        skipped += 1;
      }
    }

    return {
      scanned: events.length,
      planned,
      failed,
      skipped
    };
  }

  private async queuePlannedSweeps() {
    const sweeps = await this.ledger.listSweepRecordsByStatuses(['planned'], env.sweepBotCycleLimit);
    let queued = 0;
    let skipped = 0;

    for (const sweep of sweeps) {
      if (sweep.externalRef?.startsWith('foxya-deposit:')) {
        await this.ledger.markSweepQueued(sweep.sweepId, 'queued by sweep bot');
        await this.ledger.enqueueJob('sweep_plan', { sweepId: sweep.sweepId, stage: 'executor' });
        queued += 1;
      } else {
        skipped += 1;
      }
    }

    return { queued, skipped };
  }

  private async executeQueuedSweeps() {
    const sweeps = await this.ledger.listSweepRecordsByStatuses(['queued'], env.sweepBotCycleLimit);
    let broadcasted = 0;
    let failed = 0;
    let skipped = 0;

    for (const sweep of sweeps) {
      const result = await this.executeSweep(sweep);
      if (result === 'broadcasted') {
        broadcasted += 1;
      } else if (result === 'failed') {
        failed += 1;
      } else {
        skipped += 1;
      }
    }

    return { broadcasted, failed, skipped };
  }

  private async confirmBroadcastedSweeps() {
    const sweeps = await this.ledger.listSweepRecordsByStatuses(['broadcasted'], env.sweepBotCycleLimit);
    let confirmed = 0;
    let failed = 0;
    let skipped = 0;

    for (const sweep of sweeps) {
      const result = await this.confirmSweep(sweep);
      if (result === 'confirmed') {
        confirmed += 1;
      } else if (result === 'failed') {
        failed += 1;
      } else {
        skipped += 1;
      }
    }

    return { confirmed, failed, skipped };
  }

  private async planEvent(
    depositId: string,
    sourceAddress: string,
    currencyId: number,
    amountDecimal: string,
    network: string
  ): Promise<SweepStageResult> {
    if (!this.foxyaClient) {
      return 'skipped';
    }

    const deposit = await this.foxyaClient.getDeposit(depositId);
    if (!deposit) {
      return 'skipped';
    }

    const externalRef = `foxya-deposit:${depositId}`;
    let sweep = await this.ledger.findSweepByExternalRef(externalRef);

    if (deposit.sweepStatus?.toUpperCase() === 'FAILED') {
      if (sweep && sweep.status !== 'failed') {
        await this.ledger.failSweep(sweep.sweepId, deposit.sweepErrorMessage ?? 'foxya marked sweep failed');
      }
      return 'failed';
    }

    if (!sweep && deposit.sweepStatus?.toUpperCase() === 'SUBMITTED' && deposit.sweepTxHash) {
      sweep = await this.ledger.createSweepRecord({
        sourceWalletCode: 'foxya-user',
        sourceAddress,
        targetAddress: env.hotWalletAddress,
        currencyId,
        network: network.toLowerCase() === 'testnet' ? 'testnet' : 'mainnet',
        amount: parseStoredKoriAmount(amountDecimal),
        externalRef,
        note: 'imported from foxya sweep submission'
      });
      await this.ledger.markSweepBroadcasted(sweep.sweepId, deposit.sweepTxHash, 'imported foxya tx hash');
      return 'skipped';
    }

    if (sweep) {
      return sweep.status === 'failed' ? 'failed' : 'skipped';
    }

    await this.ledger.createSweepRecord({
      sourceWalletCode: 'foxya-user',
      sourceAddress,
      targetAddress: env.hotWalletAddress,
      currencyId,
      network: network.toLowerCase() === 'testnet' ? 'testnet' : 'mainnet',
      amount: parseStoredKoriAmount(amountDecimal),
      externalRef,
      note: `planned auto sweep for foxya deposit ${depositId}`
    });
    return 'planned';
  }

  private async executeSweep(sweep: SweepRecord): Promise<SweepStageResult> {
    if (!this.foxyaClient || !this.foxyaWalletRepository) {
      return 'skipped';
    }

    const depositId = this.parseDepositId(sweep.externalRef);
    if (!depositId) {
      return 'skipped';
    }

    const deposit = await this.foxyaClient.getDeposit(depositId);
    if (!deposit) {
      return 'skipped';
    }

    const signer = await this.foxyaWalletRepository.getWalletSignerByAddress({
      address: sweep.sourceAddress,
      currencyId: sweep.currencyId ?? 0
    });
    if (!signer?.privateKey) {
      return 'skipped';
    }

    const network = sweep.network ?? 'mainnet';
    const attemptedSweep = await this.ledger.recordSweepAttempt(sweep.sweepId, 'attempted by sweep executor');
    const resources = await this.tronGateway.getAccountResources(signer.address, network);
    const availableEnergy = Math.max(resources.energyLimit - resources.energyUsed, 0);
    const availableBandwidth = Math.max(resources.bandwidthLimit - resources.bandwidthUsed, 0);
    const trxBalance = Number(resources.trxBalanceSun) / 1_000_000;
    const queueAgeSec = attemptedSweep.queuedAt
      ? Math.floor((Date.now() - new Date(attemptedSweep.queuedAt).getTime()) / 1000)
      : 0;

    if (trxBalance < env.sweepSourceMinTrx || availableEnergy < env.sweepSourceMinEnergy || availableBandwidth <= 0) {
      await this.alertService.notifySweepResourceLow({
        depositId,
        sourceAddress: sweep.sourceAddress,
        network,
        trxBalance: trxBalance.toFixed(6),
        availableEnergy,
        availableBandwidth,
        attemptCount: attemptedSweep.attemptCount
      });

      if (queueAgeSec >= env.sweepQueueTimeoutSec || attemptedSweep.attemptCount >= env.sweepMaxRetryCount) {
        const reason = `sweep resource low timeout: trx=${trxBalance.toFixed(6)}, energy=${availableEnergy}, bandwidth=${availableBandwidth}`;
        await this.ledger.failSweep(sweep.sweepId, reason);
        await this.foxyaClient.failSweep(depositId, reason);
        await this.alertService.notifySweepQueueTimeout({
          depositId,
          sourceAddress: sweep.sourceAddress,
          queuedAt: attemptedSweep.queuedAt,
          attemptCount: attemptedSweep.attemptCount,
          timeoutSec: env.sweepQueueTimeoutSec
        });
        return 'failed';
      }

      return 'skipped';
    }

    try {
      const { txHash } = await this.tronGateway.broadcastTransfer({
        toAddress: sweep.targetAddress,
        amount: sweep.amount,
        network,
        fromAddress: signer.address,
        fromPrivateKey: signer.privateKey
      });
      await this.foxyaClient.submitSweep(depositId, txHash);
      await this.ledger.markSweepBroadcasted(sweep.sweepId, txHash, 'broadcasted by sweep executor');
      return 'broadcasted';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sweep broadcast failed';
      await this.ledger.failSweep(sweep.sweepId, message);
      await this.foxyaClient.failSweep(depositId, message);
      await this.alertService.notifySweepFailure({
        depositId,
        sourceAddress: sweep.sourceAddress,
        message
      });
      return 'failed';
    }
  }

  private async confirmSweep(sweep: SweepRecord): Promise<SweepStageResult> {
    if (!this.foxyaClient || !sweep.txHash) {
      return 'skipped';
    }

    const depositId = this.parseDepositId(sweep.externalRef);
    if (!depositId) {
      return 'skipped';
    }

    const receipt = await this.tronGateway.getTransactionReceiptDetails(sweep.txHash);
    if (receipt.status === 'confirmed') {
      await this.ledger.confirmSweep(sweep.sweepId, {
        note: 'confirmed by sweep confirmer',
        networkFee: {
          txHash: sweep.txHash,
          feeSun: receipt.feeSun,
          energyUsed: receipt.energyUsed,
          bandwidthUsed: receipt.bandwidthUsed
        }
      });
      return 'confirmed';
    }
    if (receipt.status === 'failed') {
      await this.ledger.failSweep(sweep.sweepId, 'on-chain receipt reported failure');
      await this.foxyaClient.failSweep(depositId, 'on-chain receipt reported failure');
      await this.alertService.notifySweepFailure({
        depositId,
        sourceAddress: sweep.sourceAddress,
        message: 'on-chain receipt reported failure'
      });
      return 'failed';
    }
    return 'skipped';
  }

  private parseDepositId(externalRef?: string) {
    return externalRef?.startsWith('foxya-deposit:') ? externalRef.slice('foxya-deposit:'.length) : undefined;
  }
}
