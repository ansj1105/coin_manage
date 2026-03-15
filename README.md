# KORION KORI Backend (Node.js)

`개발.md` 기반으로 만든 KORI 입금/내부원장/출금 백엔드 스캐폴드입니다.

## 아키텍처 (Clean Architecture)
- `src/domain`: 도메인 규칙, 에러, 값 객체
- `src/application`: 유스케이스 서비스 + 포트 인터페이스
- `src/container`: 의존성 조립, factory/container
- `src/infrastructure`: 인메모리 Ledger, TRON 게이트웨이, 이벤트 퍼블리셔
- `src/interfaces`: HTTP 라우트/미들웨어
- `src/app.ts`: Express 앱 조립

기능 기준 문서는 [기능정의서.md](/Users/an/work/coin_manage/기능정의서.md), 구현 히스토리 중심 문서는 [DEVELOPMENT_FUNCTION_SPEC.md](/Users/an/work/coin_manage/DEVELOPMENT_FUNCTION_SPEC.md) 참고.

## 포함된 코어 기능
- Deposit Core: 입금 감지 반영 + `txHash` idempotency
- Wallet Core: 잔액 조회, 주소 바인딩, 내부 이체
- Withdraw Core: 출금 요청/승인/브로드캐스트/확정
- Risk Control: 1회/1일 출금 한도
- Scheduler: pending 재처리, broadcast 상태 reconcile
- Admin Control: 감사 로그, 관리자 승인 기록, 다중 승인
- Operations: 출금 큐 처리, sweep plan/기록, 대사 요약, 핫월렛 임계치 알림
- Deposit Monitor Bot: foxya 내부 API watch-addresses 조회, TRON KORI 입금 감지/등록/확정 자동화
- 주소 필터: 지정된 재단/입금/핫 지갑 주소로만 입금 반영

## 출금 최종 책임 경계
- `coin_manage`: 출금 요청 상태머신, 내부 원장 잠금/복구, BullMQ dispatch/reconcile, 운영 recovery
- `coin_csms`: 관리자 승인/거절 UI, 관리자 API
- `foxya_coin_service`: 사용자 요청 접수와 레거시 호환 상태 반영
- `coin_publish`: 입금 감지와 백필 전용, 신규 운영 기준 출금 worker 소유권 없음

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

Rollback SQL은 `flyway/rollback/V1__init_korion_schema.down.sql`에 포함되어 있습니다.

## Docker Compose (EC2 권장)
한 번에 `DB -> Flyway migrate -> App` 순으로 구동:
```bash
cp .env.example .env
npm run stack:up
```

EC2 운영 가이드는 [EC2_DEPLOYMENT.md](/Users/an/work/coin_manage/EC2_DEPLOYMENT.md) 참고.

`3000` 포트가 이미 사용 중이면 `.env`에서 `APP_PORT`를 다른 값으로 변경:
```env
APP_PORT=3001
```

컨테이너 역할 분리:
```env
HTTP_ENABLED=true
SINGLETON_WORKERS_ENABLED=true
WITHDRAW_QUEUE_WORKER_ENABLED=true
```

- `app-api`: HTTP만 담당
- `app-withdraw-worker`: BullMQ 출금 dispatch/reconcile 전용, `docker compose up -d --scale app-withdraw-worker=3` 식으로 수평 확장 가능
- `app-ops`: 모니터링/입금감지/sweep/alert 같은 싱글턴 배치 담당

운영 배포에서 PostgreSQL은 기본적으로 `127.0.0.1`에만 바인딩됩니다:
```env
DB_BIND_ADDRESS=127.0.0.1
```

실제 DB 영속화를 사용하려면:
```env
APP_LEDGER_PROVIDER=postgres
```

실제 TRC20 송금을 사용하려면:
```env
APP_TRON_GATEWAY_MODE=trc20
TRON_API_KEY=replace-with-tron-api-key
MAINNET_TRON_API_URL=https://api.trongrid.io
TESTNET_TRON_API_URL=https://nile.trongrid.io
KORI_TOKEN_CONTRACT_ADDRESS=TPKZnRjJngnxVgxw52pMPSrCp2wGm7iT9W
MAINNET_KORI_TOKEN_CONTRACT_ADDRESS=TBJZD8RwQ1JcQvEP9BTbPbgBCGxUjxSXnn
TESTNET_KORI_TOKEN_CONTRACT_ADDRESS=TPKZnRjJngnxVgxw52pMPSrCp2wGm7iT9W
ALLOW_SANDBOX_DIRECT_ONCHAIN_SEND=true
ALLOW_MAINNET_SANDBOX_DIRECT_ONCHAIN_SEND=false
```

foxya 백엔드와 자동 입금 연동을 사용하려면:
```env
APP_DEPOSIT_MONITOR_ENABLED=true
APP_DEPOSIT_MONITOR_NETWORK=mainnet
APP_DEPOSIT_MONITOR_CONFIRMATIONS=20
APP_DEPOSIT_MONITOR_CURRENCY_IDS=3
FOXYA_INTERNAL_API_URL=http://54.210.92.221:8080/api/v1/internal/deposits
FOXYA_INTERNAL_API_KEY=replace-with-foxya-deposit-scanner-api-key
```

foxya 지갑 private key 복호화 기반 자동 sweep bot까지 사용하려면:
```env
SWEEP_BOT_ENABLED=true
SWEEP_BOT_POLL_INTERVAL_SEC=30
SWEEP_BOT_CYCLE_LIMIT=100
FOXYA_DB_HOST=54.210.92.221
FOXYA_DB_PORT=15432
FOXYA_DB_NAME=foxya
FOXYA_DB_USER=foxya
FOXYA_DB_PASSWORD=replace-with-password
FOXYA_ENCRYPTION_KEY=replace-with-foxya-encryption-key
```

텔레그램 알림을 사용하려면:
```env
TELEGRAM_BOT_TOKEN=replace-with-bot-token
TELEGRAM_CHAT_ID=replace-with-chat-id
```

출금 재시도 큐를 Redis로 사용하려면:
```env
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
REDIS_KEY_PREFIX=korion
WITHDRAW_RETRY_BASE_DELAY_SEC=15
```

권장 클러스터링 전략:
- API는 `app-api`를 여러 대로 확장
- 출금 queue worker는 `app-withdraw-worker`만 여러 대로 확장
- `app-ops`는 1대로 유지
- PostgreSQL은 상태 원본, Redis/BullMQ는 출금 실행 제어와 재시도만 담당

출금 모듈화 원칙:
- 관리자 승인 전에는 절대 온체인 브로드캐스트하지 않음
- 승인 이후 출금 실행/재시도/컨펌은 `coin_manage` worker만 담당
- 레거시 시스템은 출금 본체가 아니라 입력/조회/호환 계층으로만 남긴다

주의:
- `watch-addresses` 응답에는 통화 코드가 있어도 체인 이벤트 자체는 계약 기준이라, 같은 TRON 주소가 여러 통화에 재사용되면 `APP_DEPOSIT_MONITOR_CURRENCY_IDS=3`처럼 KORI currency id만 제한해야 합니다.
- `coin_manage`와 `foxya`가 다른 EC2면 container service name(`foxya-api`, `foxya-postgres`)을 쓰면 안 됩니다. `FOXYA_INTERNAL_API_URL`과 `FOXYA_DB_HOST`는 실제 라우팅 가능한 IP/도메인으로 넣어야 합니다.
- `foxya db-proxy`를 원격에서 직접 쓸 때는 `DB_PROXY_BIND_ADDRESS=0.0.0.0`와 SG 제한을 같이 적용해야 합니다.
- sweep bot은 source wallet에 TRX gas가 없으면 브로드캐스트 실패할 수 있습니다. 이 경우 foxya deposit `sweep_failed`와 텔레그램 알림으로 남깁니다.

`TRON_API_KEY`를 안 넣으면 지금까지는 public `TRON_API_URL`만으로 동작했습니다.
이제는 key가 있으면 `TRON-PRO-API-KEY` 헤더를 같이 붙입니다.
`ALLOW_RUNTIME_PROFILE_SWITCHING` 또는 `APP_ALLOW_RUNTIME_PROFILE_SWITCHING`을 `true`로 두면 sandbox에서 `runtime / mainnet / testnet / custom` contract profile 전환이 가능합니다.
운영 서버에서도 이 값을 `true`로 두면 전환 API가 열립니다.
`WALLET_MONITOR_ENABLED=true`와 `WALLET_MONITOR_INTERVAL_SEC=20`을 두면 백그라운드 수집기가 주기적으로 지갑 모니터링 값을 DB에 저장하고, sandbox/status는 저장된 최근값만 읽습니다.
`HOT_WALLET_ALERT_MIN_KORI`, `HOT_WALLET_ALERT_MIN_TRX`는 상태/대사 응답에서 핫월렛 알림 임계치로 사용됩니다.
`SWEEP_PLAN_MIN_KORI`는 sweep plan 생성 최소 잔액 기준입니다.
`ALLOW_SANDBOX_DIRECT_ONCHAIN_SEND=true`면 sandbox에서 핫월렛 직접 전송 API가 열립니다.
mainnet 직접 전송은 `ALLOW_MAINNET_SANDBOX_DIRECT_ONCHAIN_SEND=true`가 추가로 필요합니다.

내부 전송과 실제 온체인 전송은 분리되어 있습니다.
- `POST /api/wallets/transfer`: 내부 원장 간 이동. private key 불필요.
- `POST /api/withdrawals`: 요청 시 내부 원장 잠금과 출금 요청 알림을 생성합니다.
- `POST /api/withdrawals/:withdrawalId/approve`: 관리자 수동 승인 후 `withdraw_dispatch` job을 생성합니다.
- 출금 worker: `WITHDRAW_DISPATCH_ENABLED=true`일 때 승인된 출금을 BullMQ로 백그라운드 브로드캐스트/재대사합니다.
- 앱 부팅 시 `ADMIN_APPROVED`, `TX_BROADCASTED` 상태 출금을 DB에서 다시 읽어 queue recovery seed를 수행합니다.
- `TRON_GATEWAY_MODE=trc20`일 때만 실제 핫월렛 서명이 발생합니다.

상태/로그:
```bash
docker compose ps
npm run stack:logs
```

중지:
```bash
npm run stack:down
```

## API
- `POST /api/deposits/scan`
- `GET /api/system/status`
- `POST /api/system/monitoring/run`
- `GET /api/system/deposit-monitor`
- `POST /api/system/deposit-monitor/run`
- `GET /api/system/sweep-bot`
- `POST /api/system/sweep-bot/run`
- `POST /api/system/alerts/telegram/test`
  - optional body: `{ "message": "..." }`
- `GET /api/system/external-alert-monitor`
- `POST /api/system/external-alert-monitor/run`
- `GET /api/system/audit-logs`
- `GET /api/system/withdraw-jobs/failed`
- `POST /api/system/withdraw-jobs/recover`
- `GET /api/system/reconciliation`
- `GET /api/system/sweeps`
- `POST /api/system/sweeps/plan`
- `POST /api/system/sweeps/:sweepId/broadcast`
- `POST /api/system/sweeps/:sweepId/confirm`
- `GET /api/onchain/networks/:network/wallets/:address/balance`
- `POST /api/onchain/networks/:network/transfers`
- `POST /api/wallets/address-binding`
- `GET /api/wallets/address-binding?userId=&walletAddress=`
- `GET /api/wallets/balance?userId=&walletAddress=`
- `GET /api/wallets/:userId/balance`
- `GET /api/wallets/:userId/address`
- `POST /api/wallets/transfer`
- `POST /api/withdrawals`
- `GET /api/withdrawals/pending-approvals`
- `POST /api/withdrawals/:withdrawalId/approve`
- `GET /api/withdrawals/:withdrawalId/approvals`
- `POST /api/withdrawals/:withdrawalId/broadcast`
- `POST /api/withdrawals/:withdrawalId/confirm`
- `GET /api/withdrawals/:withdrawalId`
- `POST /api/scheduler/process-withdraw-queue`
- `POST /api/scheduler/retry-pending`

상세 계약은 `openapi.yaml` 참고.

## Local Sandbox
브라우저에서 전체 흐름을 바로 점검하려면:
```bash
npm run dev
```

열기:
```text
http://localhost:3000/sandbox/
```

포함 항목:
- runtime / wallet config 확인
- monitor collector 상태와 최근 수집 결과 확인
- treasury / cold / liquidity / reward / marketing / hot wallet 메타데이터 확인
- 각 system wallet의 KORI / TRX on-chain 모니터링 확인
- mainnet / testnet 탭 기반 arbitrary address on-chain balance lookup
- mainnet / testnet 탭 기반 hot wallet direct send test
- testnet 탭에서 hot wallet Nile TRX / KORI readiness 확인과 faucet 링크 제공
- TRON API key / contract preset 상태 확인
- mainnet / testnet / custom contract profile 전환
- wallet address binding / lookup
- balance 조회
- deposit scan (`userId` 또는 `walletAddress`)
- foxya watch-address 기반 자동 deposit monitor 상태/수동 실행
- foxya DB signer 기반 automatic sweep bot 상태/수동 실행
- foxya 주요 이벤트/health target 모니터 상태/수동 실행
- internal transfer (`userId` 또는 `walletAddress`)
- withdrawal request / approve / broadcast / confirm
- pending approvals / approval history
- reconciliation / audit logs / sweep planning / custom telegram test message
- scheduler retry

## 테스트
```bash
npm test
npm run build
```

## 현재 런타임 범위
- Docker 기준으로 앱까지 원커맨드 기동됨.
- DB 마이그레이션은 Flyway로 적용됨.
- `APP_LEDGER_PROVIDER=postgres`를 사용하면 앱이 PostgreSQL 기반 Ledger를 사용합니다.
- `APP_TRON_GATEWAY_MODE=trc20`는 구현되어 있고 TRON API key와 mainnet/testnet contract preset까지 반영됐습니다.
- `APP_DEPOSIT_MONITOR_ENABLED=true`면 foxya 내부 API와 같은 도커 네트워크에서 watch-address 조회, TRON KORI 입금 register/complete가 자동 실행됩니다.
- `SWEEP_BOT_ENABLED=true`와 foxya DB 접속 정보 + `FOXYA_ENCRYPTION_KEY`가 있으면 completed deposit를 hot wallet로 자동 sweep합니다.
- `ALERT_MONITOR_ENABLED=true`와 `ALERT_MONITOR_HEALTH_TARGETS`가 있으면 외부 health URL 비정상/복구를 텔레그램으로 전송합니다.
- foxya DB 접근이 가능하면 `internal_transfers`, `token_deposits`, `external_transfers`, `swaps`, `exchanges`, `payment_deposits` 신규 row를 텔레그램으로 전송합니다.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`가 있으면 핫월렛 임계치와 sweep/deposit monitor 실패를 텔레그램으로 전송합니다.
- 메인넷 운영 송금 검증은 별도 컨트랙트 주소와 실환경 검증이 필요합니다.
