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
