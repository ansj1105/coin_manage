import type { DepositWatchAddress, ExternalDepositRecord } from '../../domain/deposit-monitor/types.js';

export interface RegisterExternalDepositRequest {
  depositId: string;
  userId: string;
  currencyId: number;
  amount: string;
  network: string;
  senderAddress?: string;
  toAddress: string;
  logIndex: number;
  blockNumber: number;
  txHash: string;
}

export interface ExternalDepositClient {
  listWatchAddresses(): Promise<DepositWatchAddress[]>;
  registerDeposit(input: RegisterExternalDepositRequest): Promise<ExternalDepositRecord>;
  completeDeposit(depositId: string): Promise<ExternalDepositRecord>;
  getDeposit(depositId: string): Promise<ExternalDepositRecord | undefined>;
}
