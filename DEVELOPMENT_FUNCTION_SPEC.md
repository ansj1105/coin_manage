# KORION 개발기능 정의서

## 1. 목적

- 본 문서는 현재 `KORION KORI Backend` 프로젝트의 구현 범위와 개발 기능을 정의한다.
- 기준 소스는 현재 저장소의 `Node.js + Express + PostgreSQL + Flyway + Docker Compose` 구성이다.
- 문서 목적은 다음과 같다.
	- 구현된 기능과 미구현 기능을 구분한다.
	- 운영 배포 전 필요한 보강 항목을 명확히 한다.
	- Wallet App, Pay Server, 외부 온라인 서비스 연동 가능 범위를 정리한다.

## 2. 시스템 구성 범위

### 2.1 구성요소

- `Application Server`
	- Express 기반 API 서버
	- 입금 반영, 잔액 조회, 내부 이체, 출금 요청/승인/브로드캐스트/확정 API 제공

- `Internal Ledger DB`
	- PostgreSQL 기반 내부 장부 저장소
	- Flyway 스키마 관리
	- Kysely query builder 기반 저장소 구현

- `Blockchain Gateway`
	- `mock` 모드
		- 개발/테스트용 블록체인 응답 대체 구현
	- `trc20` 모드
		- TronWeb 기반 TRC20 전송 및 receipt 조회 구현

- `Container / Factory`
	- 런타임 의존성 조립 담당
	- `Ledger`, `Tron Gateway`, `Service` 구현체 선택

### 2.2 배포 구성

- Docker Compose 기준 기본 실행 순서
	- `postgres`
	- `flyway migrate`
	- `app`

- 현재 배포 단위
	- 단일 서버 배포 가능
	- EC2 1대에 `app + postgres` 동시 배치 가능

## 3. 아키텍처 정의

### 3.1 계층 구조

- `domain`
	- 값 객체, 도메인 규칙, 도메인 에러

- `application`
	- 유스케이스 서비스
	- 저장소/블록체인/이벤트 포트 인터페이스

- `container`
	- factory/container 기반 의존성 조립
	- 런타임 구현체 선택

- `infrastructure`
	- PostgreSQL Ledger 구현
	- In-memory Ledger 구현
	- Mock / TronWeb Gateway 구현

- `interfaces`
	- HTTP route
	- request validation
	- error handling

### 3.2 의존성 규칙

- `interfaces -> application`
- `application -> domain + ports`
- `container -> application + infrastructure + config`
- `infrastructure -> ports + domain`
- `domain`은 외부 계층에 의존하지 않는다.

## 4. 기능 정의

### 4.1 Withdraw Core [출금 서버]

#### 구현 위치

- `src/application/services/withdraw-service.ts`
- `src/interfaces/http/routes/withdraw-routes.ts`
- `src/infrastructure/blockchain/tronweb-trc20-gateway.ts`

#### 구현 내용

- 출금 요청 생성
- `Idempotency-Key` 기반 중복 요청 방지
- 1회 출금 한도 체크
- 1일 누적 출금 한도 체크
- 출금 승인 처리
- 승인된 출금의 블록체인 브로드캐스트 처리
- 브로드캐스트 후 확정 처리
- pending 출금 재처리 대상 제공

#### 현재 상태

- `부분 구현`

#### 미구현 항목

- 관리자 인증/인가
- 다중 승인
- 멀티시그
- 출금 감사 로그
- 운영자 역할 분리

### 4.2 Deposit Core [입금 감지]

#### 구현 위치

- `src/application/services/deposit-service.ts`
- `src/interfaces/http/routes/deposit-routes.ts`

#### 구현 내용

- 입금 감지 API 수신
- 지정된 재단/입금/핫월렛 주소 필터링
- `txHash` 기준 중복 방지
- 내부 Ledger에 입금 반영

#### 현재 상태

- `부분 구현`

#### 미구현 항목

- 블록체인 실시간 스캔
- TRC20 `Transfer` 이벤트 자동 수집
- 마지막 스캔 블록 저장 및 재개

### 4.3 Wallet Core [잔액/송금관리]

#### 구현 위치

- `src/application/services/wallet-service.ts`
- `src/interfaces/http/routes/wallet-routes.ts`

#### 구현 내용

- 사용자 잔액 조회
- locked balance 조회
- 내부 계정 간 송금
- 출금 시 잔액 lock / unlock

#### 현재 상태

- `구현`

#### 미구현 항목

- 거래내역 조회 API
- 사용자 인증 연동
- 정산용 계정 분리

### 4.4 Blockchain Monitor [TRON Node / API]

#### 구현 위치

- 현재 전용 모니터 컴포넌트는 없음

#### 현재 상태

- `미구현`

#### 필요 기능

- 블록 폴링
- 노드 헬스체크
- fallback node
- 마지막 스캔 블록 영속화

### 4.5 Hot Wallet [Sign & Send]

#### 구현 위치

- `src/infrastructure/blockchain/tronweb-trc20-gateway.ts`
- `src/config/env.ts`

#### 구현 내용

- private key와 지갑 주소 일치 검증
- TronWeb 기반 TRC20 `transfer()` 호출
- transaction receipt 조회

#### 현재 상태

- `부분 구현`

#### 미구현 항목

- 메인넷 `KORI_TOKEN_CONTRACT_ADDRESS` 기준 실송금 검증 완료
- 네트워크 장애 시 재시도 정책

### 4.6 Internal Ledger DB [앱 내부 잔액 장부]

#### 구현 위치

- `src/infrastructure/persistence/postgres/postgres-ledger-repository.ts`
- `flyway/sql/V1__init_korion_schema.sql`

#### 구현 내용

- 계정 잔액 저장
- 거래 원장 저장
- 입금/출금 테이블 저장
- pending 작업 저장
- PostgreSQL advisory lock 기반 동시성 제어

#### 현재 상태

- `구현`

#### 저장 테이블

- `accounts`
- `transactions`
- `deposits`
- `withdrawals`
- `tx_jobs`
- `flyway_schema_history`

### 4.7 TRON Blockchain [KORI Token]

#### 현재 상태

- `부분 연동`

#### 구현 내용

- TRON API URL 기반 호출 구조 존재
- TRC20 브로드캐스트 코드 존재
- receipt 조회 코드 존재
- 테스트넷 컨트랙트 주소 기준 설정 가능

#### 미구현 항목

- 실제 메인넷 KORI 컨트랙트 주소 기준 운영 검증
- 입금 이벤트 자동 모니터링

### 4.8 KORION Pay Server [결제 정산 서버]

#### 현재 상태

- `미구현`

#### 필요 기능

- 주문 생성
- 결제 승인
- 결제 취소
- 정산 배치
- 가맹점 정산 원장

### 4.9 Application Server [Wallet App Backend / API Server]

#### 구현 위치

- `src/app.ts`
- `src/index.ts`
- `src/container/create-app-dependencies.ts`

#### 구현 내용

- Express API 서버
- route / validation / error handling
- Clean Architecture 계층 분리
- container/factory 기반 구현체 조립
- Docker 배포 경로 제공

#### 현재 상태

- `구현`

#### 미구현 항목

- 인증/인가
- rate limit
- metrics / tracing / alerting

### 4.10 Foxyya Platform [온라인 서비스]

#### 현재 상태

- `연동 가능`

#### 연동 가능 범위

- 잔액 조회
- 내부 이체
- 입금 반영
- 출금 요청

#### 추가 필요 항목

- 사용자 인증 토큰
- 주문 모델
- 웹훅 또는 이벤트 연동
- 운영 모니터링

### 4.11 KORION Pay [오프라인 결제]

#### 현재 상태

- `구조 확장 가능`

#### 추가 필요 항목

- QR 결제
- POS 승인
- 오프라인 정산 플로우

### 4.12 KORION Wallet App [사용자 지갑 앱]

#### 현재 상태

- `백엔드 일부 지원`

#### 현재 지원 범위

- 잔액 조회 API
- 출금 요청 API
- 내부 이체 API

#### 추가 필요 항목

- 사용자 계정 인증
- 디바이스 등록
- 푸시 알림
- 사용자별 온체인 지갑 관리

## 5. API 기능 정의

### 5.1 제공 API

- `GET /health`
- `POST /api/deposits/scan`
- `GET /api/wallets/:userId/balance`
- `POST /api/wallets/transfer`
- `POST /api/withdrawals`
- `GET /api/withdrawals/:withdrawalId`
- `POST /api/withdrawals/:withdrawalId/approve`
- `POST /api/withdrawals/:withdrawalId/broadcast`
- `POST /api/withdrawals/:withdrawalId/confirm`
- `POST /api/scheduler/retry-pending`

### 5.2 계약 기준

- OpenAPI 문서: `openapi.yaml`
- 입력 검증: `zod`
- 출금/내부이체는 `Idempotency-Key` 필수

## 6. 데이터 및 운영 기준

### 6.1 데이터 저장 기준

- 개발/테스트
	- `memory` Ledger 가능

- 운영
	- `postgres` Ledger 사용 필수

### 6.2 마이그레이션 기준

- Flyway 사용
- schema 변경은 SQL migration으로 관리
- rollback SQL 별도 보관

### 6.3 운영 환경 변수

- `JWT_SECRET`
- `HOT_WALLET_PRIVATE_KEY`
- `DB_*`
- `APP_LEDGER_PROVIDER=postgres`
- `APP_TRON_GATEWAY_MODE=mock | trc20`
- `KORI_TOKEN_CONTRACT_ADDRESS`

## 7. 보안 및 운영 요구사항

- `HOT_WALLET_PRIVATE_KEY`는 git 추적 금지
- PostgreSQL은 외부 공개 금지
- 운영 서버는 `Session Manager` 우선 사용
- `3000`, `5432` 포트는 외부 공개하지 않는다.
- 출금 기능은 운영 전 관리자 승인/권한 분리 보강이 필요하다.

## 8. 운영 전 필수 보강 항목

- 메인넷 `KORI_TOKEN_CONTRACT_ADDRESS` 반영 후 실출금 검증
- Blockchain Monitor 구현
- 인증/인가 구현
- 관리자 승인 흐름 강화
- 모니터링/알람 구성
- 주문/정산 서버 분리 여부 확정

## 9. 결론

- 현재 프로젝트는 `입금 반영 + 내부 장부 + 출금 처리 API`까지는 동작 가능한 상태다.
- 현재 프로젝트는 `온라인 서비스 연동용 Wallet Backend`로 확장 가능하다.
- 단, 운영형 서비스로 보려면 블록체인 모니터, 인증/인가, 관리자 보안, 실출금 검증이 추가되어야 한다.
