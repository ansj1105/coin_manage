import { randomUUID } from 'node:crypto';
import type { BroadcastRequest, TronReceiptStatus } from './tron-client.js';
import type {
  ResourceDelegationRequest,
  TronGateway,
  TronResourceType,
  TronTransactionReceipt
} from '../application/ports/tron-gateway.js';

export class MockTronClient implements TronGateway {
  private readonly delegatedResources = new Map<string, bigint>();

  async broadcastTransfer(_request: BroadcastRequest): Promise<{ txHash: string }> {
    return { txHash: `mock-${randomUUID()}` };
  }

  async broadcastNativeTransfer(_request: BroadcastRequest): Promise<{ txHash: string }> {
    return { txHash: `mock-native-${randomUUID()}` };
  }

  async delegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }> {
    const key = this.toDelegationKey(request.fromAddress ?? 'hot-wallet', request.receiverAddress, request.resource);
    this.delegatedResources.set(key, (this.delegatedResources.get(key) ?? 0n) + request.amountSun);
    return { txHash: `mock-delegate-${randomUUID()}` };
  }

  async undelegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }> {
    const key = this.toDelegationKey(request.fromAddress ?? 'hot-wallet', request.receiverAddress, request.resource);
    const current = this.delegatedResources.get(key) ?? 0n;
    this.delegatedResources.set(key, current > request.amountSun ? current - request.amountSun : 0n);
    return { txHash: `mock-undelegate-${randomUUID()}` };
  }

  async getTransactionReceipt(txHash: string): Promise<TronReceiptStatus> {
    return (await this.getTransactionReceiptDetails(txHash)).status;
  }

  async getTransactionReceiptDetails(txHash: string): Promise<TronTransactionReceipt> {
    if (txHash.startsWith('pending-')) {
      return { status: 'pending', feeSun: 0n, energyUsed: 0, bandwidthUsed: 0 };
    }
    if (txHash.startsWith('failed-')) {
      return { status: 'failed', feeSun: 1_500_000n, energyUsed: 5000, bandwidthUsed: 350 };
    }
    return { status: 'confirmed', feeSun: 1_500_000n, energyUsed: 5000, bandwidthUsed: 350 };
  }

  async getAccountResources(): Promise<{
    trxBalanceSun: bigint;
    energyLimit: number;
    energyUsed: number;
    bandwidthLimit: number;
    bandwidthUsed: number;
  }> {
    return {
      trxBalanceSun: 100_000_000n,
      energyLimit: 100_000,
      energyUsed: 0,
      bandwidthLimit: 10_000,
      bandwidthUsed: 0
    };
  }

  async getCanDelegatedMaxSize(_address: string, _resource: TronResourceType): Promise<bigint> {
    return 1_000_000_000n;
  }

  async getDelegatedResource(fromAddress: string, toAddress: string, resource: TronResourceType): Promise<bigint> {
    return this.delegatedResources.get(this.toDelegationKey(fromAddress, toAddress, resource)) ?? 0n;
  }

  private toDelegationKey(fromAddress: string, toAddress: string, resource: TronResourceType) {
    return `${fromAddress}:${toAddress}:${resource}`;
  }
}
