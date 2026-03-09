import { Pool } from 'pg';
import type { FoxyaAlertEvent, FoxyaAlertSourceRepository, FoxyaAlertTable } from '../../application/ports/foxya-alert-source-repository.js';

type QueryableRow = Record<string, unknown>;

const formatUser = (row: QueryableRow, prefix: 'user' | 'sender' | 'receiver') => {
  const id = row[`${prefix}_id`];
  const loginId = row[`${prefix}_login_id`];
  const nickname = row[`${prefix}_nickname`];
  const name = row[`${prefix}_name`];
  const parts = [loginId, nickname, name].filter((item) => typeof item === 'string' && item.trim().length > 0);
  return `${parts.length ? parts.join(' / ') : 'unknown'} [${id ?? '-'}]`;
};

const pushLine = (lines: string[], label: string, value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return;
  }
  lines.push(`${label}=${value}`);
};

export class PostgresFoxyaAlertSourceRepository implements FoxyaAlertSourceRepository {
  constructor(private readonly pool: Pool) {}

  async getMaxId(table: FoxyaAlertTable): Promise<number> {
    const result = await this.pool.query<{ max_id: string | number | null }>(`select coalesce(max(id), 0) as max_id from ${table}`);
    return Number(result.rows[0]?.max_id ?? 0);
  }

  async listNewEvents(table: FoxyaAlertTable, afterId: number, limit: number): Promise<FoxyaAlertEvent[]> {
    switch (table) {
      case 'internal_transfers':
        return this.listInternalTransfers(afterId, limit);
      case 'external_transfers':
        return this.listExternalTransfers(afterId, limit);
      case 'token_deposits':
        return this.listTokenDeposits(afterId, limit);
      case 'payment_deposits':
        return this.listPaymentDeposits(afterId, limit);
      case 'swaps':
        return this.listSwaps(afterId, limit);
      case 'exchanges':
        return this.listExchanges(afterId, limit);
    }
  }

  private async listInternalTransfers(afterId: number, limit: number): Promise<FoxyaAlertEvent[]> {
    const result = await this.pool.query<QueryableRow>(
      `
        select
          it.id,
          it.transfer_id,
          it.sender_id,
          su.login_id as sender_login_id,
          su.nickname as sender_nickname,
          su.name as sender_name,
          sw.address as sender_address,
          it.receiver_id,
          ru.login_id as receiver_login_id,
          ru.nickname as receiver_nickname,
          ru.name as receiver_name,
          rw.address as receiver_address,
          it.currency_id,
          c.code as currency_code,
          c.name as currency_name,
          c.chain as currency_chain,
          it.amount,
          it.fee,
          it.status,
          it.transfer_type,
          it.transaction_type,
          it.memo,
          it.request_ip,
          it.order_number,
          it.created_at
        from internal_transfers it
        left join users su on su.id = it.sender_id
        left join users ru on ru.id = it.receiver_id
        left join user_wallets sw on sw.id = it.sender_wallet_id
        left join user_wallets rw on rw.id = it.receiver_wallet_id
        left join currency c on c.id = it.currency_id
        where it.deleted_at is null
          and it.id > $1
        order by it.id asc
        limit $2
      `,
      [afterId, limit]
    );

    return result.rows.map((row) => {
      const lines: string[] = [];
      pushLine(lines, 'transferId', row.transfer_id);
      pushLine(lines, 'status', row.status);
      pushLine(lines, 'transferType', row.transfer_type);
      pushLine(lines, 'transactionType', row.transaction_type);
      pushLine(lines, 'currency', [row.currency_code, row.currency_name, row.currency_chain].filter(Boolean).join(' / '));
      pushLine(lines, 'amount', row.amount);
      pushLine(lines, 'fee', row.fee);
      pushLine(lines, 'sender', formatUser(row, 'sender'));
      pushLine(lines, 'senderWallet', row.sender_address);
      pushLine(lines, 'receiver', formatUser(row, 'receiver'));
      pushLine(lines, 'receiverWallet', row.receiver_address);
      pushLine(lines, 'orderNumber', row.order_number);
      pushLine(lines, 'memo', row.memo);
      pushLine(lines, 'requestIp', row.request_ip);
      pushLine(lines, 'createdAt', row.created_at);

      return {
        table: 'internal_transfers',
        id: Number(row.id),
        eventId: String(row.transfer_id),
        occurredAt: String(row.created_at),
        title: `[FOXYA] Internal Transfer ${row.status ?? ''}`.trim(),
        lines
      };
    });
  }

  private async listExternalTransfers(afterId: number, limit: number): Promise<FoxyaAlertEvent[]> {
    const result = await this.pool.query<QueryableRow>(
      `
        select
          et.id,
          et.transfer_id,
          et.user_id,
          u.login_id as user_login_id,
          u.nickname as user_nickname,
          u.name as user_name,
          uw.address as wallet_address,
          et.currency_id,
          c.code as currency_code,
          c.name as currency_name,
          c.chain as currency_chain,
          et.to_address,
          et.amount,
          et.fee,
          et.network_fee,
          et.status,
          et.tx_hash,
          et.chain,
          et.confirmations,
          et.required_confirmations,
          et.memo,
          et.request_ip,
          et.order_number,
          et.transaction_type,
          et.created_at
        from external_transfers et
        join users u on u.id = et.user_id
        join user_wallets uw on uw.id = et.wallet_id
        left join currency c on c.id = et.currency_id
        where et.deleted_at is null
          and et.id > $1
        order by et.id asc
        limit $2
      `,
      [afterId, limit]
    );

    return result.rows.map((row) => {
      const lines: string[] = [];
      pushLine(lines, 'transferId', row.transfer_id);
      pushLine(lines, 'status', row.status);
      pushLine(lines, 'user', formatUser(row, 'user'));
      pushLine(lines, 'walletAddress', row.wallet_address);
      pushLine(lines, 'currency', [row.currency_code, row.currency_name, row.currency_chain ?? row.chain].filter(Boolean).join(' / '));
      pushLine(lines, 'amount', row.amount);
      pushLine(lines, 'fee', row.fee);
      pushLine(lines, 'networkFee', row.network_fee);
      pushLine(lines, 'toAddress', row.to_address);
      pushLine(lines, 'txHash', row.tx_hash);
      pushLine(lines, 'confirmations', `${row.confirmations}/${row.required_confirmations}`);
      pushLine(lines, 'transactionType', row.transaction_type);
      pushLine(lines, 'orderNumber', row.order_number);
      pushLine(lines, 'memo', row.memo);
      pushLine(lines, 'requestIp', row.request_ip);
      pushLine(lines, 'createdAt', row.created_at);

      return {
        table: 'external_transfers',
        id: Number(row.id),
        eventId: String(row.transfer_id),
        occurredAt: String(row.created_at),
        title: `[FOXYA] External Transfer ${row.status ?? ''}`.trim(),
        lines
      };
    });
  }

  private async listTokenDeposits(afterId: number, limit: number): Promise<FoxyaAlertEvent[]> {
    const result = await this.pool.query<QueryableRow>(
      `
        select
          td.id,
          td.deposit_id,
          td.user_id,
          u.login_id as user_login_id,
          u.nickname as user_nickname,
          u.name as user_name,
          td.order_number,
          td.currency_id,
          c.code as currency_code,
          c.name as currency_name,
          c.chain as currency_chain,
          td.amount,
          td.network,
          td.sender_address,
          td.tx_hash,
          td.status,
          td.sweep_status,
          td.sweep_tx_hash,
          td.created_at
        from token_deposits td
        left join users u on u.id = td.user_id
        left join currency c on c.id = td.currency_id
        where td.id > $1
        order by td.id asc
        limit $2
      `,
      [afterId, limit]
    );

    return result.rows.map((row) => {
      const lines: string[] = [];
      pushLine(lines, 'depositId', row.deposit_id);
      pushLine(lines, 'status', row.status);
      pushLine(lines, 'user', row.user_id ? formatUser(row, 'user') : 'unmatched');
      pushLine(lines, 'currency', [row.currency_code, row.currency_name, row.currency_chain ?? row.network].filter(Boolean).join(' / '));
      pushLine(lines, 'amount', row.amount);
      pushLine(lines, 'network', row.network);
      pushLine(lines, 'senderAddress', row.sender_address);
      pushLine(lines, 'txHash', row.tx_hash);
      pushLine(lines, 'sweepStatus', row.sweep_status);
      pushLine(lines, 'sweepTxHash', row.sweep_tx_hash);
      pushLine(lines, 'orderNumber', row.order_number);
      pushLine(lines, 'createdAt', row.created_at);

      return {
        table: 'token_deposits',
        id: Number(row.id),
        eventId: String(row.deposit_id),
        occurredAt: String(row.created_at),
        title: `[FOXYA] Token Deposit ${row.status ?? ''}`.trim(),
        lines
      };
    });
  }

  private async listPaymentDeposits(afterId: number, limit: number): Promise<FoxyaAlertEvent[]> {
    const result = await this.pool.query<QueryableRow>(
      `
        select
          pd.id,
          pd.deposit_id,
          pd.user_id,
          u.login_id as user_login_id,
          u.nickname as user_nickname,
          u.name as user_name,
          pd.order_number,
          pd.currency_id,
          c.code as currency_code,
          c.name as currency_name,
          pd.amount,
          pd.deposit_method,
          pd.payment_amount,
          pd.status,
          pd.created_at
        from payment_deposits pd
        join users u on u.id = pd.user_id
        left join currency c on c.id = pd.currency_id
        where pd.id > $1
        order by pd.id asc
        limit $2
      `,
      [afterId, limit]
    );

    return result.rows.map((row) => {
      const lines: string[] = [];
      pushLine(lines, 'depositId', row.deposit_id);
      pushLine(lines, 'status', row.status);
      pushLine(lines, 'user', formatUser(row, 'user'));
      pushLine(lines, 'currency', [row.currency_code, row.currency_name].filter(Boolean).join(' / '));
      pushLine(lines, 'amount', row.amount);
      pushLine(lines, 'depositMethod', row.deposit_method);
      pushLine(lines, 'paymentAmount', row.payment_amount);
      pushLine(lines, 'orderNumber', row.order_number);
      pushLine(lines, 'createdAt', row.created_at);

      return {
        table: 'payment_deposits',
        id: Number(row.id),
        eventId: String(row.deposit_id),
        occurredAt: String(row.created_at),
        title: `[FOXYA] Payment Deposit ${row.status ?? ''}`.trim(),
        lines
      };
    });
  }

  private async listSwaps(afterId: number, limit: number): Promise<FoxyaAlertEvent[]> {
    const result = await this.pool.query<QueryableRow>(
      `
        select
          s.id,
          s.swap_id,
          s.user_id,
          u.login_id as user_login_id,
          u.nickname as user_nickname,
          u.name as user_name,
          s.order_number,
          fc.code as from_currency_code,
          tc.code as to_currency_code,
          s.from_amount,
          s.to_amount,
          s.network,
          s.status,
          s.error_message,
          s.created_at
        from swaps s
        join users u on u.id = s.user_id
        left join currency fc on fc.id = s.from_currency_id
        left join currency tc on tc.id = s.to_currency_id
        where s.id > $1
        order by s.id asc
        limit $2
      `,
      [afterId, limit]
    );

    return result.rows.map((row) => {
      const lines: string[] = [];
      pushLine(lines, 'swapId', row.swap_id);
      pushLine(lines, 'status', row.status);
      pushLine(lines, 'user', formatUser(row, 'user'));
      pushLine(lines, 'from', `${row.from_amount} ${row.from_currency_code ?? ''}`.trim());
      pushLine(lines, 'to', `${row.to_amount} ${row.to_currency_code ?? ''}`.trim());
      pushLine(lines, 'network', row.network);
      pushLine(lines, 'orderNumber', row.order_number);
      pushLine(lines, 'errorMessage', row.error_message);
      pushLine(lines, 'createdAt', row.created_at);

      return {
        table: 'swaps',
        id: Number(row.id),
        eventId: String(row.swap_id),
        occurredAt: String(row.created_at),
        title: `[FOXYA] Swap ${row.status ?? ''}`.trim(),
        lines
      };
    });
  }

  private async listExchanges(afterId: number, limit: number): Promise<FoxyaAlertEvent[]> {
    const result = await this.pool.query<QueryableRow>(
      `
        select
          e.id,
          e.exchange_id,
          e.user_id,
          u.login_id as user_login_id,
          u.nickname as user_nickname,
          u.name as user_name,
          e.order_number,
          fc.code as from_currency_code,
          tc.code as to_currency_code,
          e.from_amount,
          e.to_amount,
          e.status,
          e.error_message,
          e.created_at
        from exchanges e
        join users u on u.id = e.user_id
        left join currency fc on fc.id = e.from_currency_id
        left join currency tc on tc.id = e.to_currency_id
        where e.id > $1
        order by e.id asc
        limit $2
      `,
      [afterId, limit]
    );

    return result.rows.map((row) => {
      const lines: string[] = [];
      pushLine(lines, 'exchangeId', row.exchange_id);
      pushLine(lines, 'status', row.status);
      pushLine(lines, 'user', formatUser(row, 'user'));
      pushLine(lines, 'from', `${row.from_amount} ${row.from_currency_code ?? ''}`.trim());
      pushLine(lines, 'to', `${row.to_amount} ${row.to_currency_code ?? ''}`.trim());
      pushLine(lines, 'orderNumber', row.order_number);
      pushLine(lines, 'errorMessage', row.error_message);
      pushLine(lines, 'createdAt', row.created_at);

      return {
        table: 'exchanges',
        id: Number(row.id),
        eventId: String(row.exchange_id),
        occurredAt: String(row.created_at),
        title: `[FOXYA] Exchange ${row.status ?? ''}`.trim(),
        lines
      };
    });
  }
}
