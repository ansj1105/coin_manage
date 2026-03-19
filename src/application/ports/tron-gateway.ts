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

export type TronResourceType = 'BANDWIDTH' | 'ENERGY';

export interface ResourceDelegationRequest {
  receiverAddress: string;
  amountSun: bigint;
  resource: TronResourceType;
  network?: BlockchainNetwork;
  fromAddress?: string;
  fromPrivateKey?: string;
  lock?: boolean;
  lockPeriod?: number;
}

export type TronReceiptStatus = 'pending' | 'confirmed' | 'failed';

export interface TronTransactionReceipt {
  status: TronReceiptStatus;
  feeSun: bigint;
  energyUsed: number;
  bandwidthUsed: number;
}

export interface TronAccountResources {
  trxBalanceSun: bigint;
  energyLimit: number;
  energyUsed: number;
  bandwidthLimit: number;
  bandwidthUsed: number;
}

export interface TronGateway {
  broadcastTransfer(request: BroadcastRequest): Promise<{ txHash: string }>;
  broadcastNativeTransfer(request: BroadcastRequest): Promise<{ txHash: string }>;
  delegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }>;
  undelegateResource(request: ResourceDelegationRequest): Promise<{ txHash: string }>;
  getTransactionReceipt(txHash: string): Promise<TronReceiptStatus>;
  getTransactionReceiptDetails(txHash: string): Promise<TronTransactionReceipt>;
  getAccountResources(address: string, network?: BlockchainNetwork): Promise<TronAccountResources>;
  getCanDelegatedMaxSize(
    address: string,
    resource: TronResourceType,
    network?: BlockchainNetwork
  ): Promise<bigint>;
  getDelegatedResource(fromAddress: string, toAddress: string, resource: TronResourceType, network?: BlockchainNetwork): Promise<bigint>;
}
