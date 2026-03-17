import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  env: {
    sandboxDirectOnchainSendEnabled: true,
    sandboxMainnetDirectOnchainSendEnabled: true,
    tronGatewayMode: 'trc20',
    hotWalletAddress: 'THotWallet111111111111111111111111111'
  }
}));

const { OnchainService } = await import('../src/application/services/onchain-service.js');
const reader = {
  getWalletMonitoringSnapshot: vi.fn()
};

const gateway = {
  broadcastTransfer: vi.fn(),
  getTransactionReceipt: vi.fn()
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('OnchainService', () => {
  it('looks up address balances on the selected network', async () => {
    reader.getWalletMonitoringSnapshot.mockResolvedValue({
      address: 'TEcBR2zfPGCLGsoGpMFLpGTEwsC8jB72Hf',
      tokenSymbol: 'KORI',
      tokenContractAddress: 'TPKZnRjJngnxVgxw52pMPSrCp2wGm7iT9W',
      tokenBalance: '10',
      tokenRawBalance: '10000000',
      tokenDecimals: 6,
      trxBalance: '2',
      trxRawBalance: '2000000',
      fetchedAt: new Date().toISOString(),
      status: 'ok'
    });

    const service = new OnchainService(reader as any, gateway as any);
    const payload = await service.lookupBalance({
      network: 'testnet',
      address: 'TEcBR2zfPGCLGsoGpMFLpGTEwsC8jB72Hf'
    });

    expect(payload.network).toBe('testnet');
    expect(payload.wallet.address).toBe('TEcBR2zfPGCLGsoGpMFLpGTEwsC8jB72Hf');
    expect(reader.getWalletMonitoringSnapshot).toHaveBeenCalledOnce();
  });

  it('forwards direct sends to the TRON gateway with selected network context', async () => {
    gateway.broadcastTransfer.mockResolvedValue({ txHash: 'tx-123' });
    const service = new OnchainService(reader as any, gateway as any);

    const payload = await service.sendFromHotWallet({
      network: 'testnet',
      toAddress: 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa',
      amountKori: 1
    });

    expect(payload.network).toBe('testnet');
    expect(payload.txHash).toBe('tx-123');
    expect(gateway.broadcastTransfer).toHaveBeenCalledOnce();
  });
});
