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
  activation_status: 'pending_trx_grant' | 'trx_granted' | 'reclaim_pending' | 'reclaimed' | 'failed';
  activation_grant_tx_hash: string | null;
  activation_granted_at: string | null;
  activation_reclaim_tx_hash: string | null;
  activation_reclaimed_at: string | null;
  activation_last_error: string | null;
  resource_status: 'idle' | 'delegate_pending' | 'delegated' | 'release_pending' | 'released' | 'failed';
  resource_delegated_at: string | null;
  resource_released_at: string | null;
  resource_last_error: string | null;
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
  status: 'DETECTED' | 'CONFIRMED' | 'CREDITED' | 'COMPLETED';
  block_number: number;
  created_at: string;
}

export interface WithdrawalsTable {
  withdraw_id: string;
  user_id: string;
  amount: string;
  to_address: string;
  status: 'LEDGER_RESERVED' | 'PENDING_ADMIN' | 'ADMIN_APPROVED' | 'TX_BROADCASTED' | 'COMPLETED' | 'FAILED' | 'REJECTED';
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
  external_auth_provider: string | null;
  external_auth_request_id: string | null;
  external_auth_confirmed_at: string | null;
}

export interface TxJobsTable {
  job_id: string;
  type: 'withdraw_dispatch' | 'withdraw_reconcile' | 'withdraw_external_sync' | 'withdraw_manual_review' | 'sweep_plan';
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
  reason_code: 'manual_review_passed' | 'high_value_verified' | 'trusted_destination_verified' | 'account_activity_verified' | 'ops_override';
  note: string | null;
  created_at: string;
}

export interface WithdrawAddressPoliciesTable {
  address: string;
  policy_type: 'blacklist' | 'whitelist' | 'internal_blocked';
  reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
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
  attempt_count: number;
  created_at: string;
  queued_at: string | null;
  last_attempt_at: string | null;
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

export interface LedgerAccountsTable {
  ledger_account_code: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'control';
  currency_code: string;
  created_at: string;
}

export interface LedgerJournalsTable {
  journal_id: string;
  journal_type: string;
  reference_type: string;
  reference_id: string;
  currency_code: string;
  description: string | null;
  created_at: string;
}

export interface LedgerPostingsTable {
  posting_id: string;
  journal_id: string;
  ledger_account_code: string;
  entry_side: 'debit' | 'credit';
  amount: string;
  created_at: string;
}

export interface NetworkFeeReceiptsTable {
  fee_receipt_id: string;
  reference_type: 'withdrawal' | 'sweep';
  reference_id: string;
  tx_hash: string;
  currency_code: 'TRX';
  fee_sun: string;
  energy_used: number;
  bandwidth_used: number;
  confirmed_at: string;
  created_at: string;
}

export interface OutboxEventsTable {
  outbox_event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'published' | 'dead_lettered';
  attempts: number;
  available_at: string;
  processing_started_at: string | null;
  last_error: string | null;
  created_at: string;
  published_at: string | null;
  dead_lettered_at: string | null;
  dead_letter_acknowledged_at: string | null;
  dead_letter_acknowledged_by: string | null;
  dead_letter_note: string | null;
  dead_letter_category: 'external_dependency' | 'validation' | 'state_conflict' | 'network' | 'unknown' | null;
  incident_ref: string | null;
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
  withdraw_address_policies: WithdrawAddressPoliciesTable;
  audit_logs: AuditLogsTable;
  sweep_records: SweepRecordsTable;
  deposit_monitor_cursors: DepositMonitorCursorsTable;
  external_deposit_events: ExternalDepositEventsTable;
  wallet_monitor_current: WalletMonitorCurrentTable;
  wallet_monitor_history: WalletMonitorHistoryTable;
  monitor_collector_runs: MonitorCollectorRunsTable;
  alert_monitor_cursors: AlertMonitorCursorsTable;
  health_check_states: HealthCheckStatesTable;
  ledger_accounts: LedgerAccountsTable;
  ledger_journals: LedgerJournalsTable;
  ledger_postings: LedgerPostingsTable;
  network_fee_receipts: NetworkFeeReceiptsTable;
  outbox_events: OutboxEventsTable;
}
