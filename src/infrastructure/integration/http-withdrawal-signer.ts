import {
  WITHDRAW_SIGNER_SCHEMA_VERSION,
  withdrawalSignerBroadcastResponseSchema,
  type WithdrawalSignerBroadcastRequestContract
} from '../../contracts/withdraw-signer-contracts.js';
import { DomainError } from '../../domain/errors/domain-error.js';
import type { WithdrawalSigner, WithdrawalSigningRequest } from '../../application/ports/withdrawal-signer.js';

export class HttpWithdrawalSigner implements WithdrawalSigner {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string
  ) {}

  async broadcastWithdrawal(request: WithdrawalSigningRequest): Promise<{ txHash: string }> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/withdrawals/${request.withdrawalId}/broadcast`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { 'x-internal-api-key': this.apiKey } : {})
      },
      body: JSON.stringify(this.buildRequestBody(request))
    });

    if (!response.ok) {
      throw new DomainError(502, 'WITHDRAW_SIGNER_REMOTE_FAILED', `withdraw signer request failed with status ${response.status}`);
    }

    const parsed = withdrawalSignerBroadcastResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new DomainError(502, 'WITHDRAW_SIGNER_REMOTE_INVALID_RESPONSE', 'withdraw signer returned invalid response', {
        issues: parsed.error.flatten()
      });
    }

    return { txHash: parsed.data.txHash };
  }

  private buildRequestBody(request: WithdrawalSigningRequest): WithdrawalSignerBroadcastRequestContract {
    return {
      schemaVersion: WITHDRAW_SIGNER_SCHEMA_VERSION,
      withdrawalId: request.withdrawalId,
      toAddress: request.toAddress,
      amountSun: request.amount.toString()
    };
  }
}
