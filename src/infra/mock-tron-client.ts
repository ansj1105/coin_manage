import { randomUUID } from 'node:crypto';
import type { BroadcastRequest, TronClient, TronReceiptStatus } from './tron-client.js';

export class MockTronClient implements TronClient {
  async broadcastTransfer(_request: BroadcastRequest): Promise<{ txHash: string }> {
    return { txHash: `mock-${randomUUID()}` };
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
}
