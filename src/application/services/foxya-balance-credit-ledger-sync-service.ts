import type { LedgerRepository } from '../ports/ledger-repository.js';
import type {
  FoxyaBalanceCreditLedgerSyncCandidate,
  FoxyaBalanceCreditLedgerSyncCursor,
  FoxyaBalanceCreditLedgerSyncCursorRepository,
  FoxyaBalanceCreditLedgerSyncSourceRepository,
  FoxyaBalanceCreditSourceName
} from '../ports/foxya-balance-credit-ledger-sync-repository.js';
import { parseStoredKoriAmount } from '../../domain/value-objects/money.js';

const DEFAULT_CURSOR_KEY_PREFIX = 'foxya_balance_credit';
const SUPPORTED_LEDGER_SYNC_CURRENCIES = new Set(['KORI']);

export interface FoxyaBalanceCreditLedgerSyncResult {
  sourceName: FoxyaBalanceCreditSourceName;
  checkedCount: number;
  syncedCount: number;
  duplicatedCount: number;
  skippedUnsupportedCount: number;
  failedCount: number;
  cursorAdvanced: boolean;
}

export class FoxyaBalanceCreditLedgerSyncService {
  constructor(
    private readonly sourceRepository: FoxyaBalanceCreditLedgerSyncSourceRepository,
    private readonly cursorRepository: FoxyaBalanceCreditLedgerSyncCursorRepository,
    private readonly ledger: LedgerRepository,
    private readonly options: {
      currencyCode: string;
      cursorKeyPrefix?: string;
    }
  ) {}

  async runCycle(
    sourceName: FoxyaBalanceCreditSourceName,
    limit: number
  ): Promise<FoxyaBalanceCreditLedgerSyncResult> {
    const currencyCode = this.options.currencyCode.trim().toUpperCase();
    if (!SUPPORTED_LEDGER_SYNC_CURRENCIES.has(currencyCode)) {
      throw new Error(`unsupported foxya balance credit ledger sync currency: ${currencyCode}`);
    }

    const cursorKey = this.cursorKey(sourceName, currencyCode);
    const cursor = await this.cursorRepository.getCursor(cursorKey);
    const candidates = await this.sourceRepository.listCompletedCredits({
      sourceName,
      currencyCode,
      cursor,
      limit
    });

    let checkedCount = 0;
    let syncedCount = 0;
    let duplicatedCount = 0;
    let skippedUnsupportedCount = 0;
    let failedCount = 0;
    let lastProcessed: Pick<FoxyaBalanceCreditLedgerSyncCursor, 'lastOccurredAt' | 'lastFoxyaId'> | undefined;

    for (const candidate of candidates) {
      checkedCount += 1;
      try {
        if (candidate.currencyCode.trim().toUpperCase() !== currencyCode) {
          skippedUnsupportedCount += 1;
          lastProcessed = this.cursorFromCandidate(candidate);
          continue;
        }

        const applied = await this.ledger.applyExternalCredit({
          userId: candidate.userId,
          amount: parseStoredKoriAmount(candidate.amount),
          currencyCode,
          journalType: candidate.journalType,
          referenceType: candidate.referenceType,
          referenceId: candidate.referenceId,
          description: candidate.description,
          nowIso: candidate.occurredAt
        });

        if (applied.duplicated) {
          duplicatedCount += 1;
        } else {
          syncedCount += 1;
        }

        lastProcessed = this.cursorFromCandidate(candidate);
      } catch (error) {
        failedCount += 1;
        console.error('FoxyaBalanceCreditLedgerSyncService candidate failed', {
          sourceName,
          foxyaId: candidate.foxyaId,
          referenceType: candidate.referenceType,
          referenceId: candidate.referenceId,
          error: error instanceof Error ? error.message : String(error)
        });
        break;
      }
    }

    let cursorAdvanced = false;
    if (lastProcessed) {
      await this.cursorRepository.saveCursor({
        cursorKey,
        sourceName,
        currencyCode,
        lastOccurredAt: lastProcessed.lastOccurredAt,
        lastFoxyaId: lastProcessed.lastFoxyaId,
        updatedAt: new Date().toISOString()
      });
      cursorAdvanced = true;
    }

    return {
      sourceName,
      checkedCount,
      syncedCount,
      duplicatedCount,
      skippedUnsupportedCount,
      failedCount,
      cursorAdvanced
    };
  }

  private cursorKey(sourceName: FoxyaBalanceCreditSourceName, currencyCode: string) {
    return `${this.options.cursorKeyPrefix ?? DEFAULT_CURSOR_KEY_PREFIX}:${sourceName}:${currencyCode}`;
  }

  private cursorFromCandidate(
    candidate: FoxyaBalanceCreditLedgerSyncCandidate
  ): Pick<FoxyaBalanceCreditLedgerSyncCursor, 'lastOccurredAt' | 'lastFoxyaId'> {
    return {
      lastOccurredAt: candidate.occurredAt,
      lastFoxyaId: candidate.foxyaId
    };
  }
}
