# Clean Architecture Layout

## Layers
- `domain`: 도메인 규칙, 값 객체, 에러
- `application`: 유스케이스 서비스, 포트(인터페이스)
- `infrastructure`: 포트 구현체(ledger/event/tron/postgres)
- `interfaces`: HTTP API 라우터/미들웨어

## Dependency Rule
- `interfaces` -> `application`
- `application` -> `domain` + `application/ports`
- `infrastructure` -> `application/ports` + `domain`
- `domain` 은 외부 계층에 의존하지 않음

## Current Runtime Adapter
- Ledger: `InMemoryLedgerRepository`
- Event Publisher: `InMemoryEventPublisher`
- Tron Gateway: `MockTronGateway`

PostgreSQL는 Flyway로 스키마를 관리하며, 런타임 저장소 전환 시 `application/ports/ledger-repository.ts` 계약을 구현해 교체합니다.
