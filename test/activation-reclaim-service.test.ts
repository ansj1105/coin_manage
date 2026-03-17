import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivationGrantService } from '../src/application/services/activation-grant-service.js';
import { ActivationReclaimService } from '../src/application/services/activation-reclaim-service.js';
import { AlertService } from '../src/application/services/alert-service.js';
import type { TronGateway } from '../src/application/ports/tron-gateway.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryLedgerRepository } from '../src/infrastructure/persistence/in-memory-ledger-repository.js';
import { InMemoryVirtualWalletRepository } from '../src/infrastructure/persistence/in-memory-virtual-wallet-repository.js';
import { AesGcmVirtualWalletKeyCipher } from '../src/infrastructure/security/virtual-wallet-key-cipher.js';
import { VirtualWalletService } from '../src/application/services/virtual-wallet-service.js';
import { parseKoriAmount } from '../src/domain/value-objects/money.js';

class LowBandwidthTronGateway extends MockTronGateway implements TronGateway {
  override async getAccountResources() {
    return {
      trxBalanceSun: 1_000_000n,
      energyLimit: 0,
      energyUsed: 0,
      bandwidthLimit: 100,
      bandwidthUsed: 0
    };
  }
}

describe('activation reclaim service', () => {
  let repository: InMemoryVirtualWalletRepository;
  let virtualWalletService: VirtualWalletService;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => '',
        json: async () => ({})
      }))
    );
    const ledger = new InMemoryLedgerRepository({
      singleLimit: parseKoriAmount(10000),
      dailyLimit: parseKoriAmount(50000)
    });
    repository = new InMemoryVirtualWalletRepository(ledger);
    virtualWalletService = new VirtualWalletService(
      repository,
      new AesGcmVirtualWalletKeyCipher('test-virtual-wallet-secret'),
      'THotWallet111111111111111111111111111'
    );
  });

  it('reclaims activation trx back to hot wallet when bandwidth is available', async () => {
    const issued = await virtualWalletService.issue({
      userId: '401',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'activation-reclaim-401'
    });
    await new ActivationGrantService(repository, new MockTronGateway(), new AlertService(), undefined, {
      enabled: true,
      cycleLimit: 10,
      amountTrx: 1
    }).runCycle();

    const result = await new ActivationReclaimService(repository, new MockTronGateway(), new AlertService(), {
      enabled: true,
      cycleLimit: 10,
      amountTrx: 1,
      minAvailableBandwidth: 300
    }).runCycle();

    expect(result.skipped).toBe(false);
    if (result.skipped) {
      return;
    }

    expect(result.reclaimed).toContain(issued.binding.virtualWalletId);

    const updated = await virtualWalletService.get({ userId: '401' });
    expect(updated?.activationStatus).toBe('reclaimed');
    expect(updated?.activationReclaimTxHash).toMatch(/^mock-native-/);
  });

  it('keeps wallet in trx_granted state when bandwidth is insufficient', async () => {
    await virtualWalletService.issue({
      userId: '402',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'activation-reclaim-402'
    });
    await new ActivationGrantService(repository, new MockTronGateway(), new AlertService(), undefined, {
      enabled: true,
      cycleLimit: 10,
      amountTrx: 1
    }).runCycle();

    const result = await new ActivationReclaimService(repository, new LowBandwidthTronGateway(), new AlertService(), {
      enabled: true,
      cycleLimit: 10,
      amountTrx: 1,
      minAvailableBandwidth: 300
    }).runCycle();

    expect(result.skipped).toBe(false);
    if (result.skipped) {
      return;
    }

    expect(result.waiting).toHaveLength(1);
    const updated = await virtualWalletService.get({ userId: '402' });
    expect(updated?.activationStatus).toBe('trx_granted');
    expect(updated?.activationReclaimTxHash).toBeUndefined();
  });
});
