# KORION 구현 현황

## 트리 기준 점검

- `Withdraw Core` [출금 서버]
  - 상태: 부분 구현
  - 구현됨: 출금 요청, 리스크 평가, 승인 기록, 다중 승인 수 계산, 브로드캐스트, 확정, 실패 복구, idempotency, PostgreSQL Ledger 반영
  - 구현됨: `mock` 게이트웨이와 `TRC20` 게이트웨이 분기, 출금 큐 처리, receipt reconcile
  - 미구현: 관리자 인증/인가, 실제 멀티시그, 운영자 권한 분리

- `Deposit Core` [입금 감지]
  - 상태: 부분 구현
  - 구현됨: 수동 입금 스캔 API, 추적 지갑 필터, `txHash` 중복 방지, Ledger 반영
  - 구현됨: foxya 내부 API 기반 자동 입금 모니터, TRON KORI `Transfer` 이벤트 스캔, cursor 저장, 재기동 후 이어받기
  - 구현됨: foxya DB signer + `ENCRYPTION_KEY` 기반 sweep bot 자동 브로드캐스트 / receipt confirm
  - 미구현: source wallet TRX gas 자동 top-up

- `Wallet Core` [잔액/송금관리]
  - 상태: 구현
  - 구현됨: 계정 잔액, locked balance, 내부 이체, 출금 lock/unlock, PostgreSQL 영속 Ledger
  - 구현됨: Docker 재기동 이후에도 DB 기준 데이터 유지
  - 미구현: 외부 사용자 인증 연동, 거래내역 조회 API 확장, 정산용 계정 모델

- `Blockchain Monitor` [TRON Node / API]
  - 상태: 부분 구현
  - 구현됨: wallet monitoring snapshot 저장, collector run 이력, TRC20 event polling, last cursor 저장
  - 구현됨: mainnet/testnet API URL 분리, foxya 내부 API / 외부 DB 기반 연동, 텔레그램 운영 알림 전송
  - 미구현: fallback node

- `Hot Wallet` [Sign & Send]
  - 상태: 부분 구현
  - 구현됨: private key 주소 일치 검증, TronWeb 기반 TRC20 `transfer()` 브로드캐스트 코드
  - 구현됨: mainnet/testnet contract preset, hot wallet 잔액 임계치 계산
  - 미구현: 메인넷 실송금 운영 검증 완료

- `Internal Ledger DB` [앱 내부 잔액 장부]
  - 상태: 구현
  - 구현됨: `accounts`, `transactions`, `deposits`, `withdrawals`, `tx_jobs`, `sweep_records`, `audit_logs`, `withdrawal_approvals`
  - 구현됨: Flyway 마이그레이션, PostgreSQL 저장소, Kysely query builder 적용
  - 미구현: 정산 전용 테이블, 결제 주문/가맹점/정산 집계 테이블

- `TRON Blockchain` [KORI Token]
  - 상태: 부분 연동
  - 구현됨: TRON 네트워크 호출 구조, 출금 receipt 조회, TRC20 전송 경로, 자동 입금 이벤트 모니터, user wallet signer 기반 sweep
  - 미구현: 메인넷 실송금 검증

- `KORION Pay Server` [결제 정산 서버]
  - 상태: 미구현
  - 필요: 주문, 승인, 취소, 정산 배치, 가맹점 정산 Ledger, 외부 결제 연동

- `Application Server` [Wallet App Backend / API Server]
  - 상태: 구현
  - 구현됨: Express API, Clean Architecture 분리, container/factory 기반 의존성 조립, Docker Compose 배포 경로
  - 구현됨: 상태 API, 감사 로그, 대사, sweep plan, deposit monitor status/run, sweep bot status/run, telegram test
  - 미구현: 인증/인가, rate limit, observability

- `Foxyya Platform` [온라인 서비스]
  - 상태: 연동 가능
  - 근거: foxya 내부 API watch-address 조회, deposit register/complete 연동, shared docker network 구성
  - 부족한 점: 사용자 인증 토큰, 결제 주문 모델, 웹훅, 운영 모니터링

- `KORION Pay` [오프라인 결제]
  - 상태: 구조만 가능
  - 가능성: `KORION Pay Server`를 별도 서비스로 두고 Ledger를 공유하거나 이벤트로 연동 가능
  - 미구현: QR 결제, POS 승인, 정산 플로우

- `KORION Wallet App` [사용자 지갑 앱]
  - 상태: 백엔드만 부분 지원
  - 구현됨: 지갑 앱이 호출할 수 있는 API 서버 기반 구조, foxya 지갑 발급/등록 흐름과 연결 가능한 deposit monitor
  - 미구현: 앱 인증, 디바이스 등록, 푸시, 사용자 지갑 주소 관리

## 온라인 서비스 확장 가능 여부

- `가능`
  - 이유: API Server, Wallet Core, Internal Ledger DB가 분리되어 있고 Docker/DB 기준 배포 가능
  - 이유: foxya 같은 외부 서비스가 API를 통해 잔액 조회, 입금 반영, 내부 이체, 출금 요청을 붙일 수 있음

- `운영 전 필수 보강`
  - 메인넷 실출금 검증
  - 관리자 인증/인가
  - 멀티시그
  - 결제/정산 서버 분리
