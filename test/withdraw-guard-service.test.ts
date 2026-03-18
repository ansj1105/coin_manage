import { describe, expect, it } from 'vitest';
import type { TronGateway } from '../src/application/ports/tron-gateway.js';
import { DomainError } from '../src/core/domain-error.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { WithdrawGuardService } from '../src/application/services/withdraw-guard-service.js';

const VALID_PRIVATE_KEY = '03fa15b86aed96b2189edec3a6545771c8c6b4415d71b3869613d6002694da7e';
const HOT_WALLET_ADDRESS = 'TYKL8DPoR99bccujHXxcyBewCV1NimdRc8';
const TREASURY_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';
const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

class LowResourceGateway extends MockTronGateway implements TronGateway {
  override async getAccountResources() {
    return {
      trxBalanceSun: 1_000_000n,
      energyLimit: 10,
      energyUsed: 9,
      bandwidthLimit: 200,
      bandwidthUsed: 10
    };
  }
}

describe('WithdrawGuardService', () => {
  it('rejects managed destination wallets at request time', async () => {
    const service = new WithdrawGuardService(new MockTronGateway(), {
      tronGatewayMode: 'trc20',
      hotWalletAddress: HOT_WALLET_ADDRESS,
      hotWalletPrivateKey: VALID_PRIVATE_KEY,
      minTrxSun: 5_000_000n,
      minBandwidth: 500,
      minEnergy: 10_000,
      restrictedDestinationAddresses: [TREASURY_ADDRESS, HOT_WALLET_ADDRESS]
    });

    await expect(service.assertRequestAllowed({ toAddress: TREASURY_ADDRESS })).rejects.toMatchObject({
      code: 'WITHDRAW_DESTINATION_RESTRICTED'
    } satisfies Partial<DomainError>);
  });

  it('opens the request circuit when signer or resources are unhealthy', async () => {
    const service = new WithdrawGuardService(new LowResourceGateway(), {
      tronGatewayMode: 'trc20',
      hotWalletAddress: HOT_WALLET_ADDRESS,
      hotWalletPrivateKey: VALID_PRIVATE_KEY,
      minTrxSun: 5_000_000n,
      minBandwidth: 500,
      minEnergy: 10_000,
      restrictedDestinationAddresses: []
    });

    await expect(service.assertRequestAllowed({ toAddress: VALID_TRON_ADDRESS })).rejects.toMatchObject({
      code: 'WITHDRAW_CIRCUIT_OPEN'
    } satisfies Partial<DomainError>);
  });

  it('reports signer mismatch in readiness', async () => {
    const service = new WithdrawGuardService(new MockTronGateway(), {
      tronGatewayMode: 'trc20',
      hotWalletAddress: HOT_WALLET_ADDRESS,
      hotWalletPrivateKey: '1111111111111111111111111111111111111111111111111111111111111111',
      minTrxSun: 5_000_000n,
      minBandwidth: 500,
      minEnergy: 10_000,
      restrictedDestinationAddresses: []
    });

    const readiness = await service.getHotWalletReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.failures).toContain('signer_unhealthy');
  });
});
