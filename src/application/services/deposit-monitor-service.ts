import { randomUUID } from 'node:crypto';
import type { DepositMonitorRepository } from '../ports/deposit-monitor-repository.js';
import type { ExternalDepositClient } from '../ports/external-deposit-client.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import type { Trc20EventReader } from '../ports/trc20-event-reader.js';
import { getBlockchainNetworkConfig } from '../../config/blockchain-networks.js';
import { env } from '../../config/env.js';
import { parseKoriAmount } from '../../domain/value-objects/money.js';
import type {
  DepositMonitorCycleResult,
  DepositMonitorStatus,
  DepositWatchAddress,
  ExternalDepositEvent
} from '../../domain/deposit-monitor/types.js';

const SCANNER_KEY = 'tron-kori-monitor';

const formatRawAmount = (rawAmount: string): string => {
  const normalized = rawAmount.replace(/^0+(\d)/, '$1');
  const padded = normalized.padStart(7, '0');
  const whole = padded.slice(0, -6) || '0';
  const fractional = padded.slice(-6).replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : whole;
};

export class DepositMonitorService {
  private running = false;

  constructor(
    private readonly repository: DepositMonitorRepository,
    private readonly foxyaClient: ExternalDepositClient | undefined,
    private readonly eventReader: Trc20EventReader,
    private readonly ledger: LedgerRepository
  ) {}

  async runCycle(): Promise<DepositMonitorCycleResult | { skipped: true; reason: string }> {
    return this.runCycleInternal();
  }

  async reconcile(input: {
    lookbackMs?: number;
    addresses?: string[];
    txHashes?: string[];
  }): Promise<DepositMonitorCycleResult | { skipped: true; reason: string }> {
    return this.runCycleInternal({
      overrideStartTimestampMs: Date.now() - (input.lookbackMs ?? env.depositMonitorLookbackMs),
      addressFilter: new Set((input.addresses ?? []).map((value) => value.trim()).filter(Boolean)),
      txHashFilter: new Set((input.txHashes ?? []).map((value) => value.trim()).filter(Boolean)),
      persistCursor: false
    });
  }

  private async runCycleInternal(options?: {
    overrideStartTimestampMs?: number;
    addressFilter?: Set<string>;
    txHashFilter?: Set<string>;
    persistCursor?: boolean;
  }): Promise<DepositMonitorCycleResult | { skipped: true; reason: string }> {
    if (!env.depositMonitorEnabled) {
      return { skipped: true, reason: 'deposit monitor disabled' };
    }

    if (!this.foxyaClient) {
      return { skipped: true, reason: 'foxya internal api is not configured' };
    }

    if (this.running) {
      return { skipped: true, reason: 'deposit monitor already running' };
    }

    this.running = true;

    let savedCursorTimestampMs = env.depositMonitorStartTimestampMs ?? Date.now() - env.depositMonitorLookbackMs;
    let savedLastSeenBlockNumber: number | undefined;
    let savedLastSeenTxHash: string | undefined;

    try {
      const network = env.depositMonitorNetwork;
      const contractAddress = env.koriTokenContractAddress ?? getBlockchainNetworkConfig(network).contractAddress;
      const watchAddresses = this.filterWatchAddresses(await this.foxyaClient.listWatchAddresses());
      const currentBlockNumber = await this.eventReader.getCurrentBlockNumber(network);
      const cursor = await this.repository.getCursor(SCANNER_KEY);
      const startTimestampMs =
        options?.overrideStartTimestampMs ??
        cursor?.cursorTimestampMs ??
        env.depositMonitorStartTimestampMs ??
        Date.now() - env.depositMonitorLookbackMs;
      const minBlockTimestamp = Math.max(0, startTimestampMs - env.depositMonitorLookbackMs);

      let fingerprint: string | undefined;
      let scannedEvents = 0;
      let matchedEvents = 0;
      let registeredCount = 0;
      let completedCount = 0;
      let skippedCount = 0;
      let lastSeenBlockNumber = cursor?.lastSeenEventBlockNumber;
      let lastSeenTxHash = cursor?.lastSeenTxHash;
      let lastSeenTimestamp = startTimestampMs;
      savedCursorTimestampMs = startTimestampMs;
      savedLastSeenBlockNumber = lastSeenBlockNumber;
      savedLastSeenTxHash = lastSeenTxHash;

      const effectiveWatchAddresses = this.filterAdhocWatchAddresses(watchAddresses, options?.addressFilter);
      const watchAddressesByAddress = new Map<string, DepositWatchAddress[]>();
      for (const item of effectiveWatchAddresses) {
        const bucket = watchAddressesByAddress.get(item.address) ?? [];
        bucket.push(item);
        watchAddressesByAddress.set(item.address, bucket);
      }

      while (true) {
        const page = await this.eventReader.listTransfers({
          network,
          contractAddress,
          minBlockTimestamp,
          fingerprint,
          limit: env.depositMonitorPageLimit
        });

        if (!page.events.length) {
          break;
        }

        scannedEvents += page.events.length;

        for (const chainEvent of page.events) {
          if (options?.txHashFilter?.size && !options.txHashFilter.has(chainEvent.txHash)) {
            skippedCount += 1;
            continue;
          }

          lastSeenTimestamp = Math.max(lastSeenTimestamp, chainEvent.blockTimestampMs);
          lastSeenBlockNumber = Math.max(lastSeenBlockNumber ?? 0, chainEvent.blockNumber);
          lastSeenTxHash = chainEvent.txHash;
          savedCursorTimestampMs = lastSeenTimestamp;
          savedLastSeenBlockNumber = lastSeenBlockNumber;
          savedLastSeenTxHash = lastSeenTxHash;

          if (!chainEvent.toAddress) {
            skippedCount += 1;
            continue;
          }

          const targets = watchAddressesByAddress.get(chainEvent.toAddress);
          if (!targets?.length) {
            skippedCount += 1;
            continue;
          }

          matchedEvents += 1;

          for (const target of targets) {
            const eventKey = `${network}:${target.currencyId}:${chainEvent.txHash}:${chainEvent.eventIndex}`;
            const event = await this.repository.recordDiscoveredEvent({
              eventKey,
              depositId: randomUUID(),
              userId: target.userId,
              currencyId: target.currencyId,
              network: target.network,
              fromAddress: chainEvent.fromAddress,
              toAddress: chainEvent.toAddress,
              txHash: chainEvent.txHash,
              eventIndex: chainEvent.eventIndex,
              blockNumber: chainEvent.blockNumber,
              blockTimestampMs: chainEvent.blockTimestampMs,
              amountRaw: chainEvent.amountRaw,
              amountDecimal: formatRawAmount(chainEvent.amountRaw),
              status: 'discovered'
            });

            if (event.foxyaRegisteredAt) {
              if (await this.completeIfEligible(event, currentBlockNumber)) {
                completedCount += 1;
              }
              continue;
            }

            await this.foxyaClient.registerDeposit({
              depositId: event.depositId,
              userId: event.userId,
              currencyId: event.currencyId,
              amount: event.amountDecimal,
              network: event.network,
              senderAddress: event.fromAddress,
              toAddress: event.toAddress,
              logIndex: event.eventIndex,
              blockNumber: event.blockNumber,
              txHash: event.txHash
            });

            const registeredAt = new Date().toISOString();
            await this.repository.markEventStatus(event.eventKey, 'registered', {
              foxyaRegisteredAt: registeredAt
            });
            registeredCount += 1;

            if (await this.completeIfEligible({ ...event, foxyaRegisteredAt: registeredAt }, currentBlockNumber)) {
              completedCount += 1;
            }
          }
        }

        if (!page.nextFingerprint) {
          break;
        }
        fingerprint = page.nextFingerprint;
      }

      const savedCursor = options?.persistCursor === false
        ? {
            scannerKey: SCANNER_KEY,
            network,
            contractAddress,
            cursorTimestampMs: lastSeenTimestamp,
            lastScannedBlockNumber: currentBlockNumber,
            lastSeenEventBlockNumber: lastSeenBlockNumber,
            lastSeenTxHash: lastSeenTxHash,
            lastError: undefined,
            updatedAt: new Date().toISOString()
          }
        : await this.repository.saveCursor({
            scannerKey: SCANNER_KEY,
            network,
            contractAddress,
            cursorTimestampMs: lastSeenTimestamp,
            lastScannedBlockNumber: currentBlockNumber,
            lastSeenEventBlockNumber: lastSeenBlockNumber,
            lastSeenTxHash: lastSeenTxHash,
            lastError: undefined
          });

      return {
        scannedEvents,
        watchedAddresses: effectiveWatchAddresses.length,
        matchedEvents,
        registeredCount,
        completedCount,
        skippedCount,
        currentBlockNumber,
        cursorTimestampMs: savedCursor.cursorTimestampMs
      };
    } catch (error) {
      await this.repository.saveCursor({
        scannerKey: SCANNER_KEY,
        network: env.depositMonitorNetwork,
        contractAddress:
          env.koriTokenContractAddress ?? getBlockchainNetworkConfig(env.depositMonitorNetwork).contractAddress,
        cursorTimestampMs: savedCursorTimestampMs,
        lastSeenEventBlockNumber: savedLastSeenBlockNumber,
        lastSeenTxHash: savedLastSeenTxHash,
        lastError: error instanceof Error ? error.message : 'deposit monitor cycle failed'
      });
      throw error;
    } finally {
      this.running = false;
    }
  }

  async getStatus(): Promise<DepositMonitorStatus> {
    const [cursor, recentEvents, counts] = await Promise.all([
      this.repository.getCursor(SCANNER_KEY),
      this.repository.listRecentEvents(20),
      this.repository.countEventsByStatus()
    ]);

    return {
      enabled: env.depositMonitorEnabled,
      network: env.depositMonitorNetwork,
      contractAddress: env.koriTokenContractAddress ?? getBlockchainNetworkConfig(env.depositMonitorNetwork).contractAddress,
      foxyaIntegrationEnabled: Boolean(env.foxyaInternalApiUrl && env.foxyaInternalApiKey),
      pollIntervalSec: env.depositMonitorPollIntervalSec,
      requiredConfirmations: env.depositMonitorConfirmations,
      startTimestampMs: env.depositMonitorStartTimestampMs,
      currencyFilterIds: env.depositMonitorCurrencyIds,
      cursor,
      recentEvents,
      counts
    };
  }

  private filterWatchAddresses(addresses: DepositWatchAddress[]): DepositWatchAddress[] {
    const allowedCurrencyIds = new Set(env.depositMonitorCurrencyIds);
    return addresses
      .filter((item) => item.network.toUpperCase() === 'TRON')
      .filter((item) => (allowedCurrencyIds.size ? allowedCurrencyIds.has(item.currencyId) : true))
      .map((item) => ({
        ...item,
        userId: String(item.userId),
        address: item.address.trim()
      }));
  }

  private filterAdhocWatchAddresses(addresses: DepositWatchAddress[], addressFilter?: Set<string>) {
    if (!addressFilter?.size) {
      return addresses;
    }

    return addresses.filter((item) => addressFilter.has(item.address));
  }

  private async completeIfEligible(event: ExternalDepositEvent, currentBlockNumber: number): Promise<boolean> {
    const confirmations = currentBlockNumber - event.blockNumber + 1;
    if (confirmations < env.depositMonitorConfirmations || event.foxyaCompletedAt || !this.foxyaClient) {
      return false;
    }

    const applied = await this.ledger.applyDeposit({
      userId: event.userId,
      amount: parseKoriAmount(Number(event.amountDecimal)),
      txHash: event.txHash,
      blockNumber: event.blockNumber
    });

    await this.ledger.completeDeposit(applied.deposit.depositId);
    await this.foxyaClient.completeDeposit(event.depositId);
    await this.repository.markEventStatus(event.eventKey, 'completed', {
      foxyaCompletedAt: new Date().toISOString()
    });
    return true;
  }
}
