import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../src/application/services/alert-service.js';
import { ResourceDelegationService } from '../src/application/services/resource-delegation-service.js';
import { InMemoryLedgerRepository } from '../src/infrastructure/persistence/in-memory-ledger-repository.js';
import { InMemoryVirtualWalletRepository } from '../src/infrastructure/persistence/in-memory-virtual-wallet-repository.js';
import { AesGcmVirtualWalletKeyCipher } from '../src/infrastructure/security/virtual-wallet-key-cipher.js';
import { VirtualWalletService } from '../src/application/services/virtual-wallet-service.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { parseKoriAmount } from '../src/domain/value-objects/money.js';

describe('resource delegation service', () => {
  let ledger: InMemoryLedgerRepository;
  let repository: InMemoryVirtualWalletRepository;
  let virtualWalletService: VirtualWalletService;
  let tronGateway: MockTronGateway;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => '',
        json: async () => ({})
      }))
    );
    ledger = new InMemoryLedgerRepository({
      singleLimit: parseKoriAmount(10000),
      dailyLimit: parseKoriAmount(50000)
    });
    repository = new InMemoryVirtualWalletRepository(ledger);
    virtualWalletService = new VirtualWalletService(
      repository,
      new AesGcmVirtualWalletKeyCipher('test-virtual-wallet-secret'),
      'THotWallet111111111111111111111111111'
    );
    tronGateway = new MockTronGateway();
  });

  it('delegates resources for queued sweeps and releases them after settlement', async () => {
    const issued = await virtualWalletService.issue({
      userId: '501',
      currencyId: 101,
      network: 'mainnet',
      idempotencyKey: 'resource-delegation-501'
    });
    await virtualWalletService.markActivationGranted({ virtualWalletId: issued.binding.virtualWalletId, txHash: 'grant-1' });
    await virtualWalletService.markActivationReclaimed({ virtualWalletId: issued.binding.virtualWalletId, txHash: 'reclaim-1' });

    const sweep = await ledger.createSweepRecord({
      sourceWalletCode: 'foxya-user',
      sourceAddress: issued.binding.walletAddress,
      targetAddress: 'THotWallet111111111111111111111111111',
      currencyId: issued.binding.currencyId,
      network: issued.binding.network,
      amount: 10n,
      externalRef: 'foxya-deposit:delegate-501'
    });
    await ledger.markSweepQueued(sweep.sweepId);

    const service = new ResourceDelegationService(ledger, repository, tronGateway, new AlertService(), {
      enabled: true,
      cycleLimit: 20,
      bandwidthAmountSun: 1_000_000n,
      energyAmountSun: 50_000_000n,
      hotWalletAddress: 'THotWallet111111111111111111111111111'
    });

    const delegatedCycle = await service.runCycle();
    expect(delegatedCycle.skipped).toBe(false);
    if (delegatedCycle.skipped) {
      return;
    }
    expect(delegatedCycle.delegated).toContain(issued.binding.walletAddress);

    const delegatedBinding = await virtualWalletService.get({ userId: '501' });
    expect(delegatedBinding?.resourceStatus).toBe('delegated');

    await ledger.markSweepBroadcasted(sweep.sweepId, 'sweep-tx-1');
    await ledger.confirmSweep(sweep.sweepId, 'confirmed');

    const releaseCycle = await service.runCycle();
    expect(releaseCycle.skipped).toBe(false);
    if (releaseCycle.skipped) {
      return;
    }
    expect(releaseCycle.released).toContain(issued.binding.walletAddress);

    const releasedBinding = await virtualWalletService.get({ userId: '501' });
    expect(releasedBinding?.resourceStatus).toBe('released');
  });
});
