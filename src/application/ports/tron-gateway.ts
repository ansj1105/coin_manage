import type { BlockchainNetwork } from '../../config/blockchain-networks.js';

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

export interface TronAccountResources {
  trxBalanceSun: bigint;
  energyLimit: number;
  energyUsed: number;
  bandwidthLimit: number;
  bandwidthUsed: number;
}

export interface TronGateway {
  broadcastTransfer(request: BroadcastRequest): Promise<{ txHash: string }>;
  getTransactionReceipt(txHash: string): Promise<TronReceiptStatus>;
  getAccountResources(address: string, network?: BlockchainNetwork): Promise<TronAccountResources>;
}
