import { randomUUID } from 'node:crypto';
import type { BroadcastRequest, TronClient, TronReceiptStatus } from './tron-client.js';

export class MockTronClient implements TronClient {
  async broadcastTransfer(_request: BroadcastRequest): Promise<{ txHash: string }> {
    return { txHash: `mock-${randomUUID()}` };
  }

  async broadcastNativeTransfer(_request: BroadcastRequest): Promise<{ txHash: string }> {
    return { txHash: `mock-native-${randomUUID()}` };
  }

  async getTransactionReceipt(txHash: string): Promise<TronReceiptStatus> {
    if (txHash.startsWith('pending-')) {
      return 'pending';
    }
    if (txHash.startsWith('failed-')) {
      return 'failed';
    }
    return 'confirmed';
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
}
