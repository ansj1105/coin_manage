import type { BlockchainNetwork } from '../config/blockchain-networks.js';
import type { TronAccountResources } from '../application/ports/tron-gateway.js';

export interface BroadcastRequest {
  toAddress: string;
  amount: bigint;
  network?: BlockchainNetwork;
  apiUrl?: string;
  contractAddress?: string;
  fromAddress?: string;
  fromPrivateKey?: string;
}

export type TronReceiptStatus = 'pending' | 'confirmed' | 'failed';

export interface TronClient {
  broadcastTransfer(request: BroadcastRequest): Promise<{ txHash: string }>;
  getTransactionReceipt(txHash: string): Promise<TronReceiptStatus>;
  getAccountResources(address: string, network?: BlockchainNetwork): Promise<TronAccountResources>;
}
