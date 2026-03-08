export interface BroadcastRequest {
  toAddress: string;
  amount: bigint;
}

export type TronReceiptStatus = 'pending' | 'confirmed' | 'failed';

export interface TronClient {
  broadcastTransfer(request: BroadcastRequest): Promise<{ txHash: string }>;
  getTransactionReceipt(txHash: string): Promise<TronReceiptStatus>;
}
