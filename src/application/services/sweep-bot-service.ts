import type { DepositMonitorRepository } from '../ports/deposit-monitor-repository.js';
import type { ExternalDepositClient } from '../ports/external-deposit-client.js';
import type { FoxyaWalletRepository } from '../ports/foxya-wallet-repository.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
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
    broadcasted: number;
    confirmed: number;
    failed: number;
    skipped: number;
  };
}

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
      const events = await this.depositMonitorRepository.listEventsByStatus('completed', env.sweepBotCycleLimit);
      let broadcasted = 0;
      let confirmed = 0;
      let failed = 0;
      let skipped = 0;

      for (const event of events) {
        const result = await this.processEvent(event.depositId, event.toAddress, event.currencyId, event.amountDecimal, event.network);
        if (result === 'broadcasted') {
          broadcasted += 1;
        } else if (result === 'confirmed') {
          confirmed += 1;
        } else if (result === 'failed') {
          failed += 1;
        } else {
          skipped += 1;
        }
      }

      const payload = {
        scanned: events.length,
        broadcasted,
        confirmed,
        failed,
        skipped
      };
      this.status = {
        enabled: this.enabled,
        configured: true,
        lastRunAt: new Date().toISOString(),
        lastResult: payload
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

  private async processEvent(
    depositId: string,
    sourceAddress: string,
    currencyId: number,
    amountDecimal: string,
    network: string
  ): Promise<'broadcasted' | 'confirmed' | 'failed' | 'skipped'> {
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
        amount: parseStoredKoriAmount(amountDecimal),
        externalRef,
        note: 'imported from foxya sweep submission'
      });
      sweep = await this.ledger.markSweepBroadcasted(sweep.sweepId, deposit.sweepTxHash, 'imported foxya tx hash');
    }

    if (sweep?.status === 'broadcasted' && sweep.txHash) {
      const receipt = await this.tronGateway.getTransactionReceipt(sweep.txHash);
      if (receipt === 'confirmed') {
        await this.ledger.confirmSweep(sweep.sweepId, 'confirmed by sweep bot');
        return 'confirmed';
      }
      if (receipt === 'failed') {
        await this.ledger.failSweep(sweep.sweepId, 'on-chain receipt reported failure');
        await this.foxyaClient.failSweep(depositId, 'on-chain receipt reported failure');
        await this.alertService.notifySweepFailure({
          depositId,
          sourceAddress,
          message: 'on-chain receipt reported failure'
        });
        return 'failed';
      }
      return 'skipped';
    }

    if (sweep) {
      return sweep.status === 'confirmed' ? 'confirmed' : sweep.status === 'failed' ? 'failed' : 'skipped';
    }

    const signer = await this.foxyaWalletRepository?.getWalletSignerByAddress({
      address: sourceAddress,
      currencyId
    });
    if (!signer?.privateKey) {
      return 'skipped';
    }

    sweep = await this.ledger.createSweepRecord({
      sourceWalletCode: 'foxya-user',
      sourceAddress,
      targetAddress: env.hotWalletAddress,
      amount: parseStoredKoriAmount(amountDecimal),
      externalRef,
      note: `auto sweep for foxya deposit ${depositId}`
    });

    try {
      const { txHash } = await this.tronGateway.broadcastTransfer({
        toAddress: env.hotWalletAddress,
        amount: parseStoredKoriAmount(amountDecimal),
        network: network.toLowerCase() === 'testnet' ? 'testnet' : 'mainnet',
        fromAddress: signer.address,
        fromPrivateKey: signer.privateKey
      });

      await this.foxyaClient.submitSweep(depositId, txHash);
      await this.ledger.markSweepBroadcasted(sweep.sweepId, txHash, 'broadcasted by sweep bot');
      return 'broadcasted';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sweep broadcast failed';
      await this.ledger.failSweep(sweep.sweepId, message);
      await this.foxyaClient.failSweep(depositId, message);
      await this.alertService.notifySweepFailure({
        depositId,
        sourceAddress,
        message
      });
      return 'failed';
    }
  }
}
