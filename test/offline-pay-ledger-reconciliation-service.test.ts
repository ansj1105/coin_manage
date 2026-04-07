import { describe, expect, it, vi } from 'vitest';
import { OfflinePayLedgerReconciliationService } from '../src/application/services/offline-pay-ledger-reconciliation-service.js';

describe('offline pay ledger reconciliation service', () => {
  it('includes foxya users with positive balance even when coin_manage has no ledger footprint yet', async () => {
    const ledger = {
      listOfflinePayReconciliationUserIds: vi.fn(async () => []),
      hasOfflinePayLedgerFootprint: vi.fn(async (userId: string) => userId === '999'),
      getOfflinePayUserBalanceSnapshot: vi.fn(async (userId: string) => ({
        userId,
        availableBalance: 0n,
        lockedBalance: 0n,
        liabilityBalance: 0n,
      })),
      appendAuditLog: vi.fn(async () => undefined),
    } as const;

    const operationsService = {
      reconcileOfflinePayUserBalance: vi.fn(async (input: { userId: string; targetLiabilityBalance: string }) => ({
        userId: input.userId,
        previousLiabilityBalance: '0.000000',
        targetLiabilityBalance: input.targetLiabilityBalance,
        deltaAmount: input.targetLiabilityBalance,
        adjusted: true,
      })),
    } as const;

    const foxyaWalletRepository = {
      listUserIdsWithPositiveCanonicalBalance: vi.fn(async () => ['35', '999']),
      getCanonicalWalletSnapshot: vi.fn(async ({ userId }: { userId: string }) => ({
        userId,
        currencyCode: 'KORI',
        totalBalance: userId === '35' ? '1020.923524' : '10.000000',
        lockedBalance: '0.000000',
        walletCount: 1,
        canonicalBasis: 'FOX_CLIENT_VISIBLE_AVAILABLE_KORI_EXCLUDING_OFFLINE_COLLATERAL',
      })),
    } as const;

    const eventPublisher = {
      publish: vi.fn(),
    } as const;

    const service = new OfflinePayLedgerReconciliationService(
      ledger as never,
      operationsService as never,
      foxyaWalletRepository as never,
      eventPublisher as never,
      {
        currencyCode: 'KORI',
        toleranceAmount: 0n,
        maxAdjustmentAmount: 10_000_000_000n,
      },
    );

    const result = await service.runCycle(10);

    expect(result.checkedCount).toBe(1);
    expect(result.adjustedCount).toBe(1);
    expect(ledger.hasOfflinePayLedgerFootprint).toHaveBeenCalledWith('35');
    expect(operationsService.reconcileOfflinePayUserBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '35',
        targetLiabilityBalance: '1020.923524',
      }),
    );
    expect(operationsService.reconcileOfflinePayUserBalance).not.toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '999',
      }),
    );
  });
});
