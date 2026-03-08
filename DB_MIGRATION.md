# Flyway Migration Plan

## Scope
- Added PostgreSQL schema migration for:
  - `accounts`
  - `transactions`
  - `deposits`
  - `withdrawals`
  - `tx_jobs`

## Up Migration
- `flyway/sql/V1__init_orion_schema.sql`

## Down Migration (manual rollback path)
- `flyway/rollback/V1__init_orion_schema.down.sql`

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
- `db:up`: not yet measured in this environment.
- `db:migrate`: not yet measured in this environment.
- `db:validate`: not yet measured in this environment.
- `db:info`: not yet measured in this environment.
