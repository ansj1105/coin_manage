# Foxya Balance Credit Ledger Sync

## Policy

Foxya wallet credit events are mirrored into the KORION ledger only when the
Foxya event is already final for that source. The worker is KORI-only until the
ledger account model is expanded for additional assets.

Mining is synced from `mining_history` with `status = 'COMPLETED'`.
`mining_sessions.credited_amount` is not a ledger source because it is a
running-session accumulator and would overlap with the completed history row.

## Included Sources

| Source | Foxya table | Final condition | Ledger reference type |
| --- | --- | --- | --- |
| Mining | `mining_history` | `status = 'COMPLETED'` | `foxya_mining_history` |
| Airdrop | `internal_transfers` | `transaction_type = 'AIRDROP_TRANSFER'`, `status = 'COMPLETED'` | `foxya_airdrop_transfer` |
| Payment deposit | `payment_deposits` | `status = 'COMPLETED'` | `foxya_payment_deposit` |
| Swap to KORI | `swaps` | `to = KORI`, `from != KORI`, `status = 'COMPLETED'` | `foxya_swap` |
| Exchange to KORI | `exchanges` | `to = KORI`, `from != KORI`, `status = 'COMPLETED'` | `foxya_exchange` |
| Referral reward | `internal_transfers` | `transfer_type = 'REFERRAL_REWARD'`, `status = 'COMPLETED'` | `foxya_referral_reward` |

Direct KORI token deposits are handled by the existing
`FoxyaTokenDepositLedgerSyncWorker`, not this balance-credit worker.

## Excluded Sources

- `mining_sessions.credited_amount`: running accumulator; use completed
  `mining_history` instead.
- `external_transfers`: withdrawal/outflow path.
- ordinary internal transfers and merchant payments: balanced user-to-user or
  user-to-merchant movements, not external credits.
- `OFFLINE_PAY_*` internal transfer rows: offline-pay settlement is owned by
  offline-pay and ledger settlement workers.
- same-currency `KORI -> KORI` swaps/exchanges: no new KORI credit.
- TRX/USDT token deposits: excluded until the ledger supports asset-specific
  accounts beyond KORI.

## Scheduler

The worker staggers per-source execution with:

- `FOXYA_BALANCE_CREDIT_LEDGER_SYNC_INITIAL_DELAY_SEC`
- `FOXYA_BALANCE_CREDIT_LEDGER_SYNC_SOURCE_GAP_SEC`

This avoids all Foxya source scans starting at the same second after app
startup.

## Operational Checks

Completed mining history volume:

```sql
select status, count(*), coalesce(sum(amount), 0)
from mining_history
where deleted_at is null
group by status
order by status;
```

Running mining sessions are intentionally not synced:

```sql
select count(*), coalesce(sum(credited_amount), 0)
from mining_sessions
where credited_amount > 0
  and ends_at > now();
```

Ended credited sessions without completed history should be treated as a Foxya
mining-finalization gap, not as an alternate ledger source.

