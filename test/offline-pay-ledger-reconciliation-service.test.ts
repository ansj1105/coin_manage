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
    expect(ledger.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'offline_pay.user_balance.reconciled',
        actorId: 'offline-pay-ledger-reconcile-worker',
        metadata: expect.objectContaining({
          userId: '35',
          adjusted: 'true',
          targetLiabilityBalance: '1020.923524',
          accountingSide: 'SENDER',
          receiverSettlementMode: 'EXTERNAL_HISTORY_SYNC',
          settlementModel: 'SENDER_LEDGER_PLUS_RECEIVER_HISTORY',
          reconciliationTrackingOwner: 'OFFLINE_PAY_SAGA',
        }),
      }),
    );
    expect(operationsService.reconcileOfflinePayUserBalance).not.toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '999',
      }),
    );
  });

  it('does not credit available balance for positive deltas on existing offline-pay ledger users', async () => {
    const ledger = {
      listOfflinePayReconciliationUserIds: vi.fn(async () => ['1761']),
      hasOfflinePayLedgerFootprint: vi.fn(async () => true),
      getOfflinePayUserBalanceSnapshot: vi.fn(async (userId: string) => ({
        userId,
        availableBalance: 80_000000n,
        lockedBalance: 10_000000n,
        liabilityBalance: 90_000000n,
      })),
      appendAuditLog: vi.fn(async () => undefined),
    } as const;

    const operationsService = {
      reconcileOfflinePayUserBalance: vi.fn(),
    } as const;

    const foxyaWalletRepository = {
      listUserIdsWithPositiveCanonicalBalance: vi.fn(async () => []),
      getCanonicalWalletSnapshot: vi.fn(async ({ userId }: { userId: string }) => ({
        userId,
        currencyCode: 'KORI',
        totalBalance: '100.000000',
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
    expect(result.adjustedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(operationsService.reconcileOfflinePayUserBalance).not.toHaveBeenCalled();
    expect(ledger.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'offline_pay.user_balance.reconcile.skipped',
        actorId: 'offline-pay-ledger-reconcile-worker',
        metadata: expect.objectContaining({
          userId: '1761',
          reason: 'positive_delta_existing_offline_pay_ledger',
          currentLiabilityBalance: '90.000000',
          targetLiabilityBalance: '100.000000',
          deltaAmount: '10.000000',
        }),
      }),
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      'offline_pay.ledger_reconciliation.skipped',
      expect.objectContaining({
        userId: '1761',
        reason: 'positive_delta_existing_offline_pay_ledger',
        deltaAmount: '10.000000',
      }),
    );
  });
});
