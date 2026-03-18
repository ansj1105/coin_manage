# 지갑 서비스 운영 갭 분석

## 목적

이 문서는 현재 `coin_manage` 중심의 입금/출금 구현 범위를 정리하고, 운영 가능한 지갑 서비스로 가기 위해 남은 부족 영역을 우선순위별로 정리한다.

핵심 관점은 아래와 같다.

- 입금/출금 구현은 기능의 시작점이다.
- 지갑 서비스 완성은 정산, 보안, 추적, 운영, 장애대응까지 포함한다.
- 사용자는 보내고 받기만 보지만, 운영자는 그 뒤의 정합성과 통제를 만들어야 한다.

## 운영 관점 계층

### 1. 사용자 기능층

- 지갑 생성
- 입금 주소 발급
- 출금 요청
- 잔액 조회
- 거래내역 조회

### 2. 자산 정합성층

- 온체인 잔액
- 내부 원장
- 처리중 금액
- 수수료
- 컨펌 수
- 입출금 상태 머신

### 3. 보안/운영층

- 출금 승인 정책
- 핫월렛/콜드월렛 분리
- 키 관리
- 이상거래 탐지
- 장애 복구
- 재처리
- 감사 로그

## 현재 구현 범위

### 사용자 기능층

구현됨

- 가상지갑 발급 및 활성화 흐름
- 입금 주소 관리
- 출금 요청 API
- 잔액 조회 API
- 출금 상세 및 승인 조회 API

부족함

- 사용자용 통합 거래내역 API
- 사용자 친화적 출금 상태 표현
- 입금 가능 상태를 바로 이해할 수 있는 표시 모델

평가

- 진행률: 높음
- 운영 완성도: 중간

### 자산 정합성층

구현됨

- 출금 원장 reserve
- locked balance 반영
- 출금 상태 머신
- 온체인 입금 모니터링
- 입금 reconcile
- 출금 broadcast 후 confirm reconcile
- sweep plan, queue, broadcast, confirm

부족함

- 수수료 회계 모델
- 실제 네트워크 비용의 원장 반영
- 일일 단위 정합성 스냅샷과 운영 리포트

평가

- 진행률: 높음
- 운영 완성도: 중상

### 보안/운영층

구현됨

- 외부 인증 후 관리자 승인 흐름
- 관리자 API key 보호
- 출금 요청 API key 보호
- hot wallet signer health 체크
- hot wallet bandwidth/energy/TRX readiness 체크
- 수동 broadcast 경로까지 동일 readiness 적용
- 감사 로그 적재
- failed withdraw job 조회 및 recover
- system status, monitor, reconcile 계열 운영 API

부족함

- cold wallet / offline signing
- 고도화된 이상거래 탐지
- blacklist/whitelist 운영 정책
- 운영 대시보드의 집계/가시화
- 장애 유형별 운영 런북

평가

- 진행률: 중간
- 운영 완성도: 중간 이하

## 현재 부족 영역 정리

## 인스턴스간 연동 / 아키텍처 갭

### 현재 구조

- `foxya_coin_service`는 `coin_manage`에 출금 요청만 브리지한다.
- 브리지 성공 시 `coin_manage withdrawalId`를 `foxya external_transfers`에 저장한다.
- 입금 쪽은 `coin_manage -> foxya` 내부 API 호출이 존재한다.
- 출금 쪽은 `coin_manage -> foxya` 상태 역전파 경로가 현재 약하다.

### 확인된 갭

- 출금 연동이 사실상 단방향 요청 구조다.
- `foxya`는 `coin_manage`의 최종 `COMPLETED` 또는 `FAILED`를 push 기반으로 받지 않는다.
- 따라서 장기적으로는 아래 둘 중 하나가 필요하다.

구현 후보

- `coin_manage -> foxya` 상태 callback API
- 또는 `foxya -> coin_manage` polling/reconcile API

### 클러스터링 / 운영 관점 갭

- `foxya`는 `app/app2` 이중 인스턴스라 새 env를 둘 다 받아야 한다.
- `coin_manage`는 `app-api/app-withdraw-worker/app-ops` 3역할 분리라 새 env와 정책 로직이 세 컨테이너에 동일하게 전달되어야 한다.
- 새 runtime env를 추가할 때 code, env parser, docker compose passthrough가 동시에 맞지 않으면 일부 노드만 다른 동작을 하게 된다.
- 클러스터링은 가용성 문제를 해결하지만 상태 동기화 자체를 해결하지 않는다.
- 출금 상태 정본은 `coin_manage` DB로 두고 `callback + polling fallback` 전략으로 `foxya`와 수렴시키는 것이 권장된다.

### 1. 사용자 기능층

#### 부족한 점

- 거래내역이 사용자 관점으로 통합되어 있지 않다.
- withdrawal 상태가 운영 상태머신 중심이라 최종 사용자에게 바로 이해되기 어렵다.
- 입금 주소의 활성화 필요 여부를 일관된 UI 모델로 제공하지 않는다.

#### 구현 방향

- `wallet timeline API` 추가
- 입금/출금/정산 영향 이벤트를 사용자 표시용 상태로 재매핑
- 입금 주소 응답에 `depositReady`, `activationStatus`, `needsTrxActivation` 명시

### 2. 자산 정합성층

#### 부족한 점

- 수수료가 내부 회계에서 별도 항목으로 추적되지 않는다.
- 온체인 비용과 원장 이벤트가 분리되어 있다.
- ledger, wallet table, on-chain 상태를 운영자가 한 번에 검증하기 어렵다.

#### 구현 방향

- journal type에 `withdraw_network_fee`, `sweep_network_fee`, `withdraw_service_fee` 추가
- confirm 시 실제 수수료와 자원 사용량을 저장
- 일일 reconciliation snapshot 생성

### 3. 출금 통제/리스크

#### 부족한 점

- 현재 risk score는 단순 룰 기반이다.
- 주소 blacklist/whitelist 정책이 없다.
- 신규 기기, 반복 실패 주소, 비정상 패턴에 대한 통제가 약하다.

#### 구현 방향

- request admission 단계의 `withdraw policy engine`
- 즉시 차단 조건과 추가 승인 조건을 분리
- risk event 적재 및 운영 조회 API 제공

### 4. 키 관리/서명 보안

#### 부족한 점

- hot wallet 단일 운영 의존도가 높다.
- cold wallet 서명 체계가 없다.
- 승인과 실제 서명 분리가 충분하지 않다.

#### 구현 방향

- hot wallet 일상 출금 한도 제한
- 고액 출금은 cold queue로 분리
- 장기적으로 signer service 분리 또는 HSM/MPC 검토

### 5. 장애 대응/운영성

#### 부족한 점

- 지금도 recover/reconcile은 가능하지만 운영 시나리오별 런북이 없다.
- 운영자가 “왜 출금이 막혔는지”를 한 화면에서 보기 어렵다.

#### 구현 방향

- 장애 유형별 대응 문서화
- status/overview API 확장
- failed jobs, pending approvals, readiness, signer health 집계

### 6. 감사/추적

#### 부족한 점

- audit log는 쌓이지만 운영자 조회성이 아직 약하다.
- 승인 사유 구조가 자유 텍스트 중심이다.

#### 구현 방향

- `actorId`, `withdrawalId`, `action`, `time range` 기준 필터 강화
- approval reason을 코드화
- export 기능 또는 운영용 조회 API 추가

## 우선순위

### 1순위

- Withdraw Policy Engine
- Ops Dashboard / Status 확장
- Fee Ledger

### 2순위

- 사용자용 거래내역 API
- 감사 로그 구조화

### 3순위

- Cold wallet / offline signing

## 권장 구현 순서

### 1. Withdraw Policy Engine

목표

- 잘못된 출금 요청은 저장 전에 차단한다.

최소 범위

- 주소 blacklist/blocked 정책
- request admission gate
- risk event 적재

### 2. Ops Dashboard / Status 확장

목표

- 운영자가 출금 가능 여부와 장애 원인을 한 번에 본다.

최소 범위

- withdraw readiness
- pending approval count
- failed withdraw jobs
- broadcast pending count

### 3. Fee Ledger

목표

- 실제 네트워크 비용과 서비스 수수료를 회계적으로 분리한다.

최소 범위

- 네트워크 비용 저장
- journal 반영
- 운영 조회 API

## 각 영역별 다음 액션

### Withdraw Policy Engine

- 주소 정책 테이블 추가
- policy service 추가
- request 단계 선차단
- 관리자 운영 API 추가

### Ops Dashboard

- `/api/system/status` 확장
- withdraw overview 집계 추가
- 관리자 프론트 연동

### Fee Ledger

- receipt 기반 fee 수집
- fee journal 반영
- 일별 합계 조회

## 현재 판단

현재 시스템은 단순 입출금 기능 수준은 이미 넘어섰다.

하지만 운영 완성형 지갑 서비스라고 보기에는 아래가 남아 있다.

- 수수료 회계
- 리스크 정책 엔진
- 운영 대시보드
- cold wallet 체계

따라서 현재 상태 평가는 다음과 같다.

- 사용자 기능층: 높음
- 자산 정합성층: 높음
- 보안/운영층: 중간

즉, 다음 단계의 본질은 기능 추가보다 운영 통제 강화다.
