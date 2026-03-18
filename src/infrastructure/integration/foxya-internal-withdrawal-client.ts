import { DomainError } from '../../domain/errors/domain-error.js';
import type { ExternalWithdrawalSyncClient } from '../../application/ports/external-withdrawal-sync-client.js';
import type { WithdrawalStateChangedContract } from '../../contracts/ledger-contracts.js';

const REQUEST_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 2;

export class FoxyaInternalWithdrawalClient implements ExternalWithdrawalSyncClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async syncWithdrawalState(contract: WithdrawalStateChangedContract): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/coin-manage/${contract.withdrawalId}/state`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Api-Key': this.apiKey
          },
          body: JSON.stringify(contract),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (!response.ok) {
          const message = await response.text();
          const error = new DomainError(
            response.status,
            'FOXYA_INTERNAL_WITHDRAWAL_API_ERROR',
            message || 'foxya internal withdrawal sync failed'
          );
          if (attempt < MAX_REQUEST_ATTEMPTS && RETRYABLE_STATUS_CODES.has(response.status)) {
            lastError = error;
            continue;
          }
          throw error;
        }

        return;
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        lastError = error;
        if (attempt < MAX_REQUEST_ATTEMPTS) {
          continue;
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'foxya internal withdrawal sync failed';
    throw new DomainError(502, 'FOXYA_INTERNAL_WITHDRAWAL_API_FETCH_FAILED', message);
  }
}
