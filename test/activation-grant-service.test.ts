import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivationGrantService } from '../src/application/services/activation-grant-service.js';
import { AlertService } from '../src/application/services/alert-service.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryLedgerRepository } from '../src/infrastructure/persistence/in-memory-ledger-repository.js';
import { InMemoryVirtualWalletRepository } from '../src/infrastructure/persistence/in-memory-virtual-wallet-repository.js';
import { AesGcmVirtualWalletKeyCipher } from '../src/infrastructure/security/virtual-wallet-key-cipher.js';
import { VirtualWalletService } from '../src/application/services/virtual-wallet-service.js';
import { parseKoriAmount } from '../src/domain/value-objects/money.js';

describe('activation grant service', () => {
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

  it('marks pending virtual wallets as trx granted after native transfer', async () => {
    const issued = await virtualWalletService.issue({
      userId: '301',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'activation-grant-301'
    });

    const service = new ActivationGrantService(repository, new MockTronGateway(), new AlertService(), undefined, {
      enabled: true,
      cycleLimit: 10,
      amountTrx: 1
    });
    const result = await service.runCycle();
    expect(result.skipped).toBe(false);
    if (result.skipped) {
      return;
    }

    expect(result.granted).toContain(issued.binding.virtualWalletId);

    const updated = await virtualWalletService.get({ userId: '301' });
    expect(updated?.activationStatus).toBe('trx_granted');
    expect(updated?.activationGrantTxHash).toMatch(/^mock-native-/);
  });
});
