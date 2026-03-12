export interface AccountsTable {
  user_id: string;
  balance: string;
  locked_balance: string;
  updated_at: string;
}

export interface WalletAddressBindingsTable {
  user_id: string;
  wallet_address: string;
  created_at: string;
}

export interface VirtualWalletBindingsTable {
  virtual_wallet_id: string;
  user_id: string;
  currency_id: number;
  network: 'mainnet' | 'testnet';
  wallet_address: string;
  encrypted_private_key: string;
  sweep_target_address: string;
  issued_by: 'hot_wallet';
  idempotency_key: string;
  status: 'active' | 'retired' | 'disabled';
  created_at: string;
  retired_at: string | null;
  disabled_at: string | null;
  replaced_by_virtual_wallet_id: string | null;
}

export interface TransactionsTable {
  tx_id: string;
  user_id: string;
  type: 'deposit' | 'withdraw' | 'payment' | 'internal_transfer_in' | 'internal_transfer_out';
  amount: string;
  status: 'pending' | 'confirmed' | 'failed';
  block_tx: string | null;
  idempotency_key: string | null;
  related_user_id: string | null;
  created_at: string;
}

export interface DepositsTable {
  deposit_id: string;
  user_id: string;
  tx_hash: string;
  amount: string;
  status: 'confirmed';
  block_number: number;
  created_at: string;
}

export interface WithdrawalsTable {
  withdraw_id: string;
  user_id: string;
  amount: string;
  to_address: string;
  status: 'requested' | 'review_required' | 'approved' | 'broadcasted' | 'confirmed' | 'failed' | 'rejected';
  tx_hash: string | null;
  idempotency_key: string;
  ledger_tx_id: string;
  created_at: string;
  approved_at: string | null;
  broadcasted_at: string | null;
  confirmed_at: string | null;
  failed_at: string | null;
  fail_reason: string | null;
  risk_level: 'low' | 'medium' | 'high';
  risk_score: number;
  risk_flags: string[];
  required_approvals: number;
  client_ip: string | null;
  device_id: string | null;
  review_required_at: string | null;
}

export interface TxJobsTable {
  job_id: string;
  type: 'withdraw_dispatch' | 'withdraw_reconcile' | 'withdraw_manual_review' | 'sweep_plan';
  payload: Record<string, string>;
  status: 'pending' | 'running' | 'done' | 'failed';
  retry_count: number;
  created_at: string;
}

export interface WithdrawalApprovalsTable {
  approval_id: string;
  withdraw_id: string;
  admin_id: string;
  actor_type: 'admin' | 'system';
  note: string | null;
  created_at: string;
}

export interface AuditLogsTable {
  audit_id: string;
  entity_type: 'withdrawal' | 'sweep' | 'system';
  entity_id: string;
  action: string;
  actor_type: 'admin' | 'system' | 'user';
  actor_id: string;
  metadata: Record<string, string>;
  created_at: string;
}

export interface SweepRecordsTable {
  sweep_id: string;
  source_wallet_code: string;
  source_address: string;
  target_address: string;
  currency_id: number | null;
  network: 'mainnet' | 'testnet' | null;
  amount: string;
  status: 'planned' | 'queued' | 'broadcasted' | 'confirmed' | 'failed' | 'skipped';
  external_ref: string | null;
  tx_hash: string | null;
  note: string | null;
  created_at: string;
  broadcasted_at: string | null;
  confirmed_at: string | null;
}

export interface DepositMonitorCursorsTable {
  scanner_key: string;
  network: 'mainnet' | 'testnet';
  contract_address: string;
  cursor_timestamp_ms: string;
  last_scanned_block_number: number | string | null;
  last_seen_event_block_number: number | string | null;
  last_seen_tx_hash: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface ExternalDepositEventsTable {
  event_key: string;
  deposit_id: string;
  user_id: string;
  currency_id: number;
  network: string;
  from_address: string | null;
  to_address: string;
  tx_hash: string;
  event_index: number;
  block_number: number | string;
  block_timestamp_ms: string;
  amount_raw: string;
  amount_decimal: string;
  status: 'discovered' | 'registered' | 'completed';
  foxya_registered_at: string | null;
  foxya_completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletMonitorCurrentTable {
  wallet_code: string;
  address: string;
  token_symbol: string;
  token_contract_address: string | null;
  token_balance: string | null;
  token_raw_balance: string | null;
  token_decimals: number | null;
  trx_balance: string | null;
  trx_raw_balance: string | null;
  fetched_at: string;
  status: 'ok' | 'error';
  error_message: string | null;
  updated_at: string;
}

export interface WalletMonitorHistoryTable {
  snapshot_id: string;
  collector_name: string;
  wallet_code: string;
  address: string;
  token_symbol: string;
  token_contract_address: string | null;
  token_balance: string | null;
  token_raw_balance: string | null;
  token_decimals: number | null;
  trx_balance: string | null;
  trx_raw_balance: string | null;
  fetched_at: string;
  status: 'ok' | 'error';
  error_message: string | null;
  created_at: string;
}

export interface MonitorCollectorRunsTable {
  run_id: string;
  collector_name: string;
  status: 'success' | 'degraded' | 'failed';
  success_count: number;
  error_count: number;
  total_count: number;
  error_message: string | null;
  started_at: string;
  finished_at: string;
}

export interface AlertMonitorCursorsTable {
  monitor_key: string;
  last_seen_id: string | number;
  updated_at: string;
}

export interface HealthCheckStatesTable {
  target_key: string;
  target_name: string;
  target_url: string;
  last_status: 'healthy' | 'unhealthy';
  consecutive_failures: number;
  last_checked_at: string;
  last_failure_at: string | null;
  last_error: string | null;
}

export interface KorionDatabase {
  accounts: AccountsTable;
  wallet_address_bindings: WalletAddressBindingsTable;
  virtual_wallet_bindings: VirtualWalletBindingsTable;
  transactions: TransactionsTable;
  deposits: DepositsTable;
  withdrawals: WithdrawalsTable;
  tx_jobs: TxJobsTable;
  withdrawal_approvals: WithdrawalApprovalsTable;
  audit_logs: AuditLogsTable;
  sweep_records: SweepRecordsTable;
  deposit_monitor_cursors: DepositMonitorCursorsTable;
  external_deposit_events: ExternalDepositEventsTable;
  wallet_monitor_current: WalletMonitorCurrentTable;
  wallet_monitor_history: WalletMonitorHistoryTable;
  monitor_collector_runs: MonitorCollectorRunsTable;
  alert_monitor_cursors: AlertMonitorCursorsTable;
  health_check_states: HealthCheckStatesTable;
}
