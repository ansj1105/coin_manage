import type { TronGateway } from '../../application/ports/tron-gateway.js';
import type { WithdrawalSigner, WithdrawalSigningRequest } from '../../application/ports/withdrawal-signer.js';

export class HotWalletWithdrawalSigner implements WithdrawalSigner {
  constructor(private readonly tronGateway: TronGateway) {}

  async broadcastWithdrawal(request: WithdrawalSigningRequest): Promise<{ txHash: string }> {
    return this.tronGateway.broadcastTransfer({
      toAddress: request.toAddress,
      amount: request.amount
    });
  }
}
