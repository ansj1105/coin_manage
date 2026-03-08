# Flyway Migration Plan

## Scope
- Added PostgreSQL schema migration for:
  - `accounts`
  - `transactions`
  - `deposits`
  - `withdrawals`
  - `tx_jobs`

## Up Migration
- `flyway/sql/V1__init_korion_schema.sql`

## Down Migration (manual rollback path)
- `flyway/rollback/V1__init_korion_schema.down.sql`

## Lock / Performance Risk
- `CREATE TABLE` only: low lock risk for existing workloads (new deploy baseline).
- `CREATE INDEX` on empty/new tables: low runtime impact.
- No table rewrite/backfill in V1.

## Rollback Trigger Conditions
- Migration partially applied and app fails to start with schema mismatch.
- Query failures on newly created relations during smoke checks.

## Rollback Procedure
1. Stop app traffic.
2. Run rollback SQL in transaction-safe order (reverse dependency).
3. Re-run previous app version and health checks.

## Verification Commands
```bash
npm run db:up
npm run db:migrate
npm run db:validate
npm run db:info
```

## Observed Timings
- `db:up`: `real 0.55s` (failed: Docker daemon unavailable)
- `db:migrate`: `real 0.36s` (failed: Docker daemon unavailable)
- `db:validate`: `real 0.38s` (failed: Docker daemon unavailable)
- `db:info`: `real 0.36s` (failed: Docker daemon unavailable)
