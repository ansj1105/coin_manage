export interface WithdrawalSigningRequest {
  withdrawalId: string;
  toAddress: string;
  amount: bigint;
}

export interface WithdrawalSigner {
  broadcastWithdrawal(request: WithdrawalSigningRequest): Promise<{ txHash: string }>;
}
