# Clean Architecture Layout

## Layers
- `domain`: 도메인 규칙, 값 객체, 에러
- `application`: 유스케이스 서비스, 포트(인터페이스)
- `container`: factory/container 기반 의존성 조립
- `infrastructure`: 포트 구현체(ledger/event/tron/postgres)
- `interfaces`: HTTP API 라우터/미들웨어

## Dependency Rule
- `interfaces` -> `application`
- `application` -> `domain` + `application/ports`
- `container` -> `application` + `infrastructure` + `config`
- `infrastructure` -> `application/ports` + `domain`
- `domain` 은 외부 계층에 의존하지 않음

## Current Runtime Adapter
- Ledger: `InMemoryLedgerRepository` or `PostgresLedgerRepository`
- Event Publisher: `InMemoryEventPublisher`
- Tron Gateway: `MockTronGateway` or `TronWebTrc20Gateway`

## Runtime Notes
- PostgreSQL 스키마는 Flyway로 관리
- PostgreSQL 저장소는 `pg` 드라이버 위에 `Kysely` query builder 사용
- 앱 조립은 [`create-app-dependencies.ts`](/Users/an/work/coin_manage/src/container/create-app-dependencies.ts)에서 처리
