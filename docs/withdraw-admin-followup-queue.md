# 출금 관리자 후속 작업 큐

기준일: 2026-03-15

## 목표

`coin_manage`에 정리한 새 출금 상태 머신을 기존 관리자 체계(`coin_csms`, `coin_front`, 필요시 `coin_system_flyway`)에 반영한다.

핵심 원칙:

- 상태 원본은 DB
- 관리자 승인 전에는 온체인 브로드캐스트 금지
- 관리자 화면은 `단순 승인/거절`이 아니라 `상태 추적 + 실패 재처리 + 운영 복구`까지 보여야 함

## 현재 확인된 차이

### 1. 관리자 프론트 (`/Users/an/work/coin_front`)

- 출금 화면은 [AdminWithdrawalRequest.tsx](/Users/an/work/coin_front/src/pages/admin/AdminWithdrawalRequest.tsx) 기준으로 동작
- 상태값이 `REVIEW | REJECTED | APPROVED | ALL` 로 고정
- 상태 변경 API도 `APPROVED | REJECTED` 만 전송
- 현재 가정:
  - 승인되면 끝
  - 브로드캐스트, 컨펌대기, 재시도, 실패복구는 화면 모델에 없음

### 2. 관리자 API (`/Users/an/IdeaProjects/coin_csms`)

- 목록/상태변경 API 존재:
  - `GET /api/v2/admin/withdrawal/requests`
  - `PATCH /api/v2/admin/withdrawal/requests/:id/status`
- 구현은 [AdminFundsRepository.java](/Users/an/IdeaProjects/coin_csms/src/main/java/com/csms/admin/repository/AdminFundsRepository.java) 에서 `external_transfers.status` 직접 변경
- 허용 상태도 `APPROVED`, `REJECTED` 만 허용
- OpenAPI 역시 동일한 계약으로 고정

### 3. 플라이웨이 (`/Users/an/work/coin_system_flyway`)

- `external_transfers.status` 는 초기 설계 기준 `PENDING, PROCESSING, SUBMITTED, CONFIRMED, FAILED, CANCELLED`
- 관리자 승인 구간과 재시도/운영 상태를 별도 컬럼으로 표현하는 구조는 아직 없음
- 현재 `coin_csms`는 이 테이블을 관리자 출금 원본으로 사용

## 추천 구현 순서

### 1. `coin_csms` API 선행

관리자 프론트는 `csms` 계약을 따라가므로 여기부터 바꾼다.

필수 변경:

- 출금 목록 응답에 새 상태 체계 반영
- 상태 변경 API를 `승인/거절` 명령형으로 분리하거나 action 기반으로 변경
- 실패 job / 복구 요청 API 추가
- 화면 표시용 운영 필드 추가:
  - `approvedBy`
  - `approvedAt`
  - `txHash`
  - `lastError`
  - `retryCount`
  - `reviewRequiredAt`
  - `completedAt`
  - `failedAt`

권장 API 초안:

- `GET /api/v2/admin/withdrawal/requests`
- `POST /api/v2/admin/withdrawal/requests/{id}/approve`
- `POST /api/v2/admin/withdrawal/requests/{id}/reject`
- `GET /api/v2/admin/withdrawal/jobs/failed`
- `POST /api/v2/admin/withdrawal/jobs/recover`

권장 상태 표시값:

- `PENDING_APPROVAL`
- `APPROVED`
- `BROADCASTING`
- `BROADCASTED`
- `COMPLETED`
- `FAILED`
- `REJECTED`
- `RETRY_WAIT`

주의:

- `PATCH status` 로 임의 문자열을 덮어쓰는 방식은 운영 사고 위험이 큼
- 승인/거절은 command endpoint 로 분리하는 편이 안전함

### 2. `coin_system_flyway` 필요 여부 확정

`csms`가 기존 `external_transfers`를 계속 원본으로 쓴다면, 아래 중 하나를 택해야 한다.

옵션 A. 기존 `status` 확장

- 장점: 변경량 적음
- 단점: 관리자 승인 상태와 체인 처리 상태가 한 컬럼에 섞임

옵션 B. 운영 컬럼 추가 권장

- `admin_status`
- `admin_approved_by`
- `admin_approved_at`
- `review_required_at`
- `last_error`
- `retry_count`
- `completed_at`
- `failed_at`

권장 판단:

- 장기적으로는 옵션 B
- 단기 호환이 급하면 옵션 A + 일부 메타 컬럼 추가

### 3. `coin_front` 관리자 화면 반영

`csms` 계약이 바뀐 뒤 반영한다.

필수 변경:

- 상태 필터 enum 확장
- 행 단위 액션을 `승인/거절` 중심으로 재정의
- `승인 완료` 이후에도 `브로드캐스트중/완료/실패/재시도대기` 상태 배지 표시
- 실패건에 `재처리` 또는 `복구 요청` 버튼 추가
- 상세 컬럼 추가:
  - tx hash
  - 승인자/승인시각
  - 마지막 에러
  - 재시도 횟수

화면 메모:

- 목록 기본 필터는 `PENDING_APPROVAL` 우선
- 고액/재시도 누적 실패건은 시각적으로 분리
- 버튼 비활성 조건을 상태별로 명확히 둔다

## 바로 다음 액션

1. `coin_csms` OpenAPI 및 DTO를 새 출금 운영 모델로 개편
2. 필요한 경우 `coin_system_flyway` 마이그레이션 추가
3. `coin_front` 관리자 출금 페이지/타입/API 클라이언트 반영

## 검토 메모

- `coin_manage` 내부 운영 API와 `csms` 운영 API가 역할 중복될 수 있음
- 실제 운영에서는 `csms`가 `coin_manage`의 운영 API를 프록시할지, 동일 DB를 직접 조회할지 먼저 결정해야 함
- 이 결정이 안 나면 프론트 구현이 다시 흔들릴 수 있음
