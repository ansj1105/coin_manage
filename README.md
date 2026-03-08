# ORION KORI Backend (Node.js)

`개발.md` 기반으로 만든 KORI 입금/내부원장/출금 백엔드 스캐폴드입니다.

## 아키텍처 (Clean Architecture)
- `src/domain`: 도메인 규칙, 에러, 값 객체
- `src/application`: 유스케이스 서비스 + 포트 인터페이스
- `src/infrastructure`: 인메모리 Ledger, TRON 게이트웨이, 이벤트 퍼블리셔
- `src/interfaces`: HTTP 라우트/미들웨어
- `src/app.ts`: DI(의존성 조립)

## 포함된 코어 기능
- Deposit Core: 입금 감지 반영 + `txHash` idempotency
- Wallet Core: 잔액 조회, 내부 이체
- Withdraw Core: 출금 요청/승인/브로드캐스트/확정
- Risk Control: 1회/1일 출금 한도
- Scheduler: pending 재처리, broadcast 상태 reconcile
- 주소 필터: 지정된 재단/입금/핫 지갑 주소로만 입금 반영

## 빠른 시작
```bash
npm install
cp .env.example .env
npm run dev
```

## Flyway + PostgreSQL
```bash
npm run db:up
npm run db:migrate
npm run db:info
```

Rollback SQL은 `flyway/rollback/V1__init_orion_schema.down.sql`에 포함되어 있습니다.

## API
- `POST /api/deposits/scan`
- `GET /api/wallets/:userId/balance`
- `POST /api/wallets/transfer`
- `POST /api/withdrawals`
- `POST /api/withdrawals/:withdrawalId/approve`
- `POST /api/withdrawals/:withdrawalId/broadcast`
- `POST /api/withdrawals/:withdrawalId/confirm`
- `GET /api/withdrawals/:withdrawalId`
- `POST /api/scheduler/retry-pending`

상세 계약은 `openapi.yaml` 참고.

## 테스트
```bash
npm test
npm run build
```
