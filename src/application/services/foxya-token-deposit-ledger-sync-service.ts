import type { LedgerRepository } from '../ports/ledger-repository.js';
import type {
  FoxyaTokenDepositLedgerSyncCandidate,
  FoxyaTokenDepositLedgerSyncCursor,
  FoxyaTokenDepositLedgerSyncCursorRepository,
  FoxyaTokenDepositLedgerSyncSourceRepository
} from '../ports/foxya-token-deposit-ledger-sync-repository.js';
import { parseStoredKoriAmount } from '../../domain/value-objects/money.js';

const DEFAULT_CURSOR_KEY_PREFIX = 'foxya_token_deposits';
const SUPPORTED_LEDGER_SYNC_CURRENCIES = new Set(['KORI']);

export interface FoxyaTokenDepositLedgerSyncResult {
  checkedCount: number;
  syncedCount: number;
  duplicatedCount: number;
  skippedUnsupportedCount: number;
  failedCount: number;
  cursorAdvanced: boolean;
}

export class FoxyaTokenDepositLedgerSyncService {
  constructor(
    private readonly sourceRepository: FoxyaTokenDepositLedgerSyncSourceRepository,
    private readonly cursorRepository: FoxyaTokenDepositLedgerSyncCursorRepository,
    private readonly ledger: LedgerRepository,
    private readonly options: {
      currencyCode: string;
      cursorKey?: string;
    }
  ) {}

  async runCycle(limit: number): Promise<FoxyaTokenDepositLedgerSyncResult> {
    const currencyCode = this.options.currencyCode.trim().toUpperCase();
    if (!SUPPORTED_LEDGER_SYNC_CURRENCIES.has(currencyCode)) {
      throw new Error(`unsupported foxya token deposit ledger sync currency: ${currencyCode}`);
    }

    const cursorKey = this.options.cursorKey ?? `${DEFAULT_CURSOR_KEY_PREFIX}:${currencyCode}`;
    const cursor = await this.cursorRepository.getCursor(cursorKey);
    const candidates = await this.sourceRepository.listCompletedTokenDeposits({
      currencyCode,
      cursor,
      limit
    });

    let checkedCount = 0;
    let syncedCount = 0;
    let duplicatedCount = 0;
    let skippedUnsupportedCount = 0;
    let failedCount = 0;
    let lastProcessed: Pick<FoxyaTokenDepositLedgerSyncCursor, 'lastConfirmedAt' | 'lastFoxyaId'> | undefined;

    for (const candidate of candidates) {
      checkedCount += 1;
      try {
        if (candidate.currencyCode.trim().toUpperCase() !== currencyCode) {
          skippedUnsupportedCount += 1;
          lastProcessed = this.cursorFromCandidate(candidate);
          continue;
        }

        const applied = await this.ledger.applyDeposit({
          userId: candidate.userId,
          amount: parseStoredKoriAmount(candidate.amount),
          txHash: candidate.txHash,
          toAddress: candidate.toAddress,
          walletAddress: candidate.toAddress,
          blockNumber: candidate.blockNumber ?? 0
        });

        if (applied.deposit.status !== 'COMPLETED') {
          await this.ledger.completeDeposit(applied.deposit.depositId);
        }

        if (applied.duplicated) {
          duplicatedCount += 1;
        } else {
          syncedCount += 1;
        }

        lastProcessed = this.cursorFromCandidate(candidate);
      } catch (error) {
        failedCount += 1;
        console.error('FoxyaTokenDepositLedgerSyncService candidate failed', {
          depositId: candidate.depositId,
          txHash: candidate.txHash,
          foxyaId: candidate.foxyaId,
          error: error instanceof Error ? error.message : String(error)
        });
        break;
      }
    }

    let cursorAdvanced = false;
    if (lastProcessed) {
      await this.cursorRepository.saveCursor({
        cursorKey,
        lastConfirmedAt: lastProcessed.lastConfirmedAt,
        lastFoxyaId: lastProcessed.lastFoxyaId,
        updatedAt: new Date().toISOString()
      });
      cursorAdvanced = true;
    }

    return {
      checkedCount,
      syncedCount,
      duplicatedCount,
      skippedUnsupportedCount,
      failedCount,
      cursorAdvanced
    };
  }

  private cursorFromCandidate(
    candidate: FoxyaTokenDepositLedgerSyncCandidate
  ): Pick<FoxyaTokenDepositLedgerSyncCursor, 'lastConfirmedAt' | 'lastFoxyaId'> {
    return {
      lastConfirmedAt: candidate.confirmedAt,
      lastFoxyaId: candidate.foxyaId
    };
  }
}
