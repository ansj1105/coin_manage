import { DomainError } from '../../domain/errors/domain-error.js';
import type {
  ExternalDepositClient,
  RegisterExternalDepositRequest
} from '../../application/ports/external-deposit-client.js';
import type { DepositWatchAddress, ExternalDepositRecord } from '../../domain/deposit-monitor/types.js';

type RequestOptions = {
  method?: 'GET' | 'POST';
  path: string;
  body?: unknown;
};

const HTTP_NOT_FOUND = 404;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_ATTEMPTS = 2;

export class FoxyaInternalDepositClient implements ExternalDepositClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async listWatchAddresses(): Promise<DepositWatchAddress[]> {
    return this.request<DepositWatchAddress[]>({
      path: '/watch-addresses'
    });
  }

  async registerDeposit(input: RegisterExternalDepositRequest): Promise<ExternalDepositRecord> {
    try {
      return await this.request<ExternalDepositRecord>({
        method: 'POST',
        path: '/register',
        body: {
          ...input,
          userId: Number(input.userId)
        }
      });
    } catch (error) {
      const existing = await this.getDeposit(input.depositId);
      if (existing) {
        return existing;
      }
      throw error;
    }
  }

  async completeDeposit(depositId: string): Promise<ExternalDepositRecord> {
    try {
      return await this.request<ExternalDepositRecord>({
        method: 'POST',
        path: `/${depositId}/complete`
      });
    } catch (error) {
      const existing = await this.getDeposit(depositId);
      if (existing?.status?.toUpperCase() === 'COMPLETED') {
        return existing;
      }
      throw error;
    }
  }

  async getDeposit(depositId: string): Promise<ExternalDepositRecord | undefined> {
    try {
      return await this.request<ExternalDepositRecord>({
        path: `/${depositId}`
      });
    } catch (error) {
      if (error instanceof DomainError && error.statusCode === HTTP_NOT_FOUND) {
        return undefined;
      }
      throw error;
    }
  }

  async submitSweep(depositId: string, txHash: string): Promise<ExternalDepositRecord> {
    return this.request<ExternalDepositRecord>({
      method: 'POST',
      path: `/${depositId}/sweep/submit`,
      body: { txHash }
    });
  }

  async failSweep(depositId: string, errorMessage: string): Promise<ExternalDepositRecord> {
    return this.request<ExternalDepositRecord>({
      method: 'POST',
      path: `/${depositId}/sweep/fail`,
      body: { errorMessage }
    });
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${options.path}`, {
          method: options.method ?? 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Api-Key': this.apiKey
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (!response.ok) {
          const message = await response.text();
          const error = new DomainError(
            response.status,
            'FOXYA_INTERNAL_API_ERROR',
            message || 'foxya internal api request failed'
          );
          if (attempt < MAX_REQUEST_ATTEMPTS && RETRYABLE_STATUS_CODES.has(response.status)) {
            lastError = error;
            continue;
          }
          throw error;
        }

        const payload = (await response.json()) as T | { data?: T };
        if (payload && typeof payload === 'object' && 'data' in payload) {
          return payload.data as T;
        }
        return payload as T;
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

    const message = lastError instanceof Error ? lastError.message : 'foxya internal api request failed';
    throw new DomainError(502, 'FOXYA_INTERNAL_API_FETCH_FAILED', message);
  }
}
