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
        body: input
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

  private async request<T>(options: RequestOptions): Promise<T> {
    const response = await fetch(`${this.baseUrl}${options.path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': this.apiKey
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const message = await response.text();
      throw new DomainError(response.status, 'FOXYA_INTERNAL_API_ERROR', message || 'foxya internal api request failed');
    }

    return (await response.json()) as T;
  }
}
