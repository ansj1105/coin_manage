# coin_manage Architecture

## Layers
- `src/domain`: 원장/입출금/가상지갑 도메인 규칙과 에러
- `src/application`: 서비스 유스케이스와 포트 인터페이스
- `src/infrastructure`: Postgres, BullMQ, Tron, foxya 연동 구현체
- `src/interfaces`: HTTP 라우트와 상태/운영 API
- `src/container`: 런타임 의존성 조립
- `src/bootstrap`: 앱 시작 전 secret bootstrap 같은 선행 초기화

## Runtime Topology
- `app-api`: HTTP API와 sandbox/status 엔드포인트
- `app-ops`: deposit monitor, wallet monitor, activation/resource jobs, alert/sweep singleton worker
- `app-withdraw-worker`: BullMQ 기반 출금 dispatch/reconcile 전용
- 저장소는 `postgres`와 `redis`를 기본 상태 저장소로 사용

```text
foxya app/web -> coin_manage app-api
                     |
                     +-> Postgres ledger / monitoring / deposit tables
                     +-> Redis BullMQ withdraw queue
                     +-> Tron reader/gateway
                     +-> foxya internal API (deposits, wallets)
                     +-> foxya DB signer lookup / alert source DB
```

## Core Flows
- Deposit monitor: foxya 내부 API의 watch address를 읽고 TRON 이벤트를 스캔해 원장 입금을 반영
- Sweep bot: foxya DB에서 source signer를 복호화해 completed deposit를 hot wallet로 sweep
- Withdraw worker: 승인된 출금을 queue 기반으로 브로드캐스트/재대사
- Virtual wallet lifecycle: 가입 직후 TRX grant, reclaim, resource delegation 정책 수행
- Monitoring/alerts: system wallet snapshot, reconciliation, hot wallet threshold alert, 외부 health polling

## Secret Flow
- `.env` 직접 주입을 기본 지원
- 부팅 시작점 [`src/index.ts`](/Users/anseojeong/work/coin_manage/src/index.ts) 는 먼저 [`runtime-secrets.ts`](/Users/anseojeong/work/coin_manage/src/bootstrap/runtime-secrets.ts) 를 실행
- `*_ASM_SECRET_ID` 와 optional `*_ASM_JSON_KEY` 가 있으면 AWS Secrets Manager에서 값을 읽어 해당 env로 주입한 뒤 기존 `env.ts` 검증을 수행
- 현재 운영상 우선 대상 secret:
  - `HOT_WALLET_PRIVATE_KEY`
  - `FOXYA_INTERNAL_API_KEY`
  - `FOXYA_ENCRYPTION_KEY`
  - `VIRTUAL_WALLET_ENCRYPTION_KEY`
  - `JWT_SECRET`

## Dependency Rules
- `interfaces` -> `application`
- `application` -> `domain` + `application/ports`
- `infrastructure` -> `application/ports` + `domain`
- `container` -> `application` + `infrastructure` + `config`
- `bootstrap` -> secret/bootstrap concern only, app graph 조립 전 단계

## Operational Notes
- 운영 foxya API 기본 경로는 `https://api.korion.io.kr`
- foxya DB proxy 기본 경로는 `172.31.36.110:15432`
- Postgres schema는 Flyway로 관리
- `coin_manage` Postgres는 출금 lifecycle의 canonical write model이므로 운영 목표를 `primary + standby + backup`으로 둔다
- `redis`는 queue/lock/transient delivery 용도이며 canonical withdrawal-state store가 아니다
- 앱 조립은 [`create-app-dependencies.ts`](/Users/anseojeong/work/coin_manage/src/container/create-app-dependencies.ts) 에서 수행
