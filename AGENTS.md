# Project Rules

## Backend Schema Rule

- Keep route-level validation schemas in `src/interfaces/http/schemas` instead of defining large inline `zod` objects inside route files.
- When an internal API contract is shared across services, also expose a JSON-schema-shaped export under `src/contracts` so the contract can be reused in docs, callbacks, or bridge clients.
- Use schema files for structural rules only.
- Keep DB lookups, readiness checks, blacklist evaluation, balances, and other stateful decisions in service or policy layers, not in the schema.

## Backend Contract Rule

- Any endpoint addition or request/response contract change must update `openapi.yaml` in the same task.
- If the change affects cross-instance behavior, document which service is the source of truth and how retries or reconciliation work.

## Backend Persistence Rule

- For persistence-backed features, add the migration and rollback together.
- Do not introduce a new policy or accounting table without deciding which service owns the data and which service only consumes it.

## Backend Integration Rule

- Treat `coin_manage` as the write model for withdrawal lifecycle state unless a task explicitly changes that architecture.
- `foxya_coin_service` may submit requests and cache display state, but canonical withdrawal status belongs to `coin_manage`.
- Redis can be used for locks, queues, and transient delivery, but not as the canonical withdrawal-state store.
- Multi-node deployment improves availability and throughput; it does not replace explicit callback or polling contracts between services.
- Do not couple withdrawal callbacks to unrelated foxya internal credentials such as deposit-scanner keys. Prefer a dedicated withdrawal callback API key, and only use fallback wiring temporarily for zero-downtime rollout.

## Deployment Env Rule

- When a new runtime env var is introduced, update code readers, compose passthrough lists, and every container role that needs it in the same task.
- In `coin_manage`, verify env propagation across `app-api`, `app-withdraw-worker`, and `app-ops`.
- If `offline_pay` collateral calls start timing out, check `pg_stat_replication`, `pg_stat_activity`, and `synchronous_standby_names` on `coin_manage` before assuming an app-level bug.
- Do not leave `synchronous_standby_names` configured on a primary that has no attached standby. Use `./scripts/db-sync-standby-guard.sh --repair` to clear that state.

## Offline Pay Integration Rule

- `offline_pay` 연동 기능은 화면용 더미 상태나 샘플 ledger를 기본 동작에 남기지 않는다.
- 테스트용 collateral/settlement/topup/release 샘플은 test mode, fixture, or test table seed로만 다룬다.
- 오프라인 결제는 기본적으로 `internal ledger only`이며 자동 실출금으로 이어지지 않도록 유지한다.
- 연동 계약이 바뀌면 `coin_front`, `offline_pay`, `coin_manage`, 필요 시 `foxya_coin_service`, `coin_csms`, `coin_publish`까지 영향 범위를 확인한다.
- 오프라인 정책 때문에 운영/정산 테이블이 바뀌면 DB migration과 운영 조회 API를 함께 갱신한다.
