# KORION 구현 현황

## 트리 기준 점검

- `Withdraw Core` [출금 서버]
  - 상태: 부분 구현
  - 구현됨: 출금 요청, 한도 체크, 승인, 브로드캐스트, 확정, 실패 복구, idempotency, PostgreSQL Ledger 반영
  - 구현됨: `mock` 게이트웨이와 `TRC20` 게이트웨이 분기
  - 미구현: 관리자 인증, 다중 승인, 멀티시그, 출금 감사로그, 운영자 권한 분리

- `Deposit Core` [입금 감지]
  - 상태: 부분 구현
  - 구현됨: 입금 스캔 API, 추적 지갑 필터, `txHash` 중복 방지, Ledger 반영
  - 미구현: 실시간 블록 스캔, TRC20 `Transfer` 이벤트 자동 파싱, 재기동 후 마지막 블록 이어받기

- `Wallet Core` [잔액/송금관리]
  - 상태: 구현
  - 구현됨: 계정 잔액, locked balance, 내부 이체, 출금 lock/unlock, PostgreSQL 영속 Ledger
  - 구현됨: Docker 재기동 이후에도 DB 기준 데이터 유지
  - 미구현: 외부 사용자 인증 연동, 거래내역 조회 API 확장, 정산용 계정 모델

- `Blockchain Monitor` [TRON Node / API]
  - 상태: 미구현
  - 현재: `TRON_API_URL` 기반 게이트웨이 호출만 있음
  - 필요: 블록 폴링, 노드 헬스체크, fallback node, last scanned block 저장

- `Hot Wallet` [Sign & Send]
  - 상태: 부분 구현
  - 구현됨: private key 주소 일치 검증, TronWeb 기반 TRC20 `transfer()` 브로드캐스트 코드
  - 구현됨: 테스트넷 `KORI_TOKEN_CONTRACT_ADDRESS` 반영
  - 미구현: 실제 운영 송금 검증 완료
  - 이유: 메인넷 컨트랙트 주소 및 실환경 검증 미완료

- `Internal Ledger DB` [앱 내부 잔액 장부]
  - 상태: 구현
  - 구현됨: `accounts`, `transactions`, `deposits`, `withdrawals`, `tx_jobs`
  - 구현됨: Flyway 마이그레이션, PostgreSQL 저장소, Kysely query builder 적용
  - 미구현: 정산 전용 테이블, 결제 주문/가맹점/정산 집계 테이블

- `TRON Blockchain` [KORI Token]
  - 상태: 부분 연동
  - 구현됨: TRON 네트워크 호출 구조, 출금 receipt 조회, TRC20 전송 경로
  - 구현됨: 테스트넷 컨트랙트 주소 기준 설정 가능
  - 미구현: 메인넷 실송금 검증, 입금 이벤트 모니터

- `KORION Pay Server` [결제 정산 서버]
  - 상태: 미구현
  - 필요: 주문, 승인, 취소, 정산 배치, 가맹점 정산 Ledger, 외부 결제 연동

- `Application Server` [Wallet App Backend / API Server]
  - 상태: 구현
  - 구현됨: Express API, Clean Architecture 분리, container/factory 기반 의존성 조립, Docker Compose 배포 경로
  - 미구현: 인증/인가, 관리자 API, rate limit, observability

- `Foxyya Platform` [온라인 서비스]
  - 상태: 연동 가능
  - 근거: API 서버와 내부 Ledger가 분리되어 있어 온라인 서비스에서 잔액 조회/입금 반영/출금 요청/내부이체 호출 가능
  - 부족한 점: 사용자 인증 토큰, 결제 주문 모델, 웹훅, 운영 모니터링

- `KORION Pay` [오프라인 결제]
  - 상태: 구조만 가능
  - 가능성: `KORION Pay Server`를 별도 서비스로 두고 Ledger를 공유하거나 이벤트로 연동 가능
  - 미구현: QR 결제, POS 승인, 정산 플로우

- `KORION Wallet App` [사용자 지갑 앱]
  - 상태: 백엔드만 부분 지원
  - 구현됨: 지갑 앱이 호출할 수 있는 API 서버 기반 구조
  - 미구현: 앱 인증, 디바이스 등록, 푸시, 사용자 지갑 주소 관리

## 온라인 서비스 확장 가능 여부

- `가능`
  - 이유: API Server, Wallet Core, Internal Ledger DB가 이미 분리되어 있고 Docker/DB 기준 배포 가능
  - 이유: Foxyya Platform 같은 외부 온라인 서비스가 API를 통해 잔액 조회, 입금 반영, 내부 이체, 출금 요청을 붙일 수 있음

- `운영 전 필수 보강`
  - 메인넷 `KORI_TOKEN_CONTRACT_ADDRESS` 반영 후 실출금 검증
  - 블록체인 입금 모니터 자동화
  - 인증/인가
  - 관리자 승인/멀티시그
  - 결제/정산 서버 분리
  - 모니터링/알람
