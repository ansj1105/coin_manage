# Offline Pay 내부원장 정책

## 1. 목적

이 문서는 `offline_pay`, `coin_front`, `coin_manage`를 연결하면서 굳어진 오프라인 결제 정책을 정리한다.
핵심 목표는 `네트워크 단절 시에도 서비스 연속성을 보장`하면서, 실제 자산 정합성과 내부원장 일관성은 온라인 복귀 후 서버가 보장하는 것이다.

## 2. 가장 중요한 원칙

### 2.1 오프라인 결제는 실출금이 아니다

오프라인 결제는 즉시 체인 전송을 발생시키지 않는다.

- 오프라인에서 생성되는 것은 `전송 요청(intent)` 또는 `spending proof`
- 서버 정합성 판정 성공 후 `coin_manage`에는 `내부원장`만 반영
- `TRC / ETH / BTC / XRP` 실제 출금은 기존 온라인 출금 API/worker로만 진입
- 따라서 `정산 성공 = 자동 실출금`이 아니다

### 2.2 내부원장이 기준이다

오프라인 결제 성공 후 사용자 간 상태는 `coin_manage` 내부원장을 기준으로 판단한다.

- `offline_pay`는 proof 정합성 검증 책임
- `coin_manage`는 canonical ledger 책임
- `fox_coin`은 사용자 거래내역 표시 책임

### 2.3 담보 기반 상태 전이 시스템으로 본다

오프라인 결제는 단순 송금 API가 아니라 아래 세 요소로 본다.

- `Collateral Lock`
- `Hash Chain`
- `Monotonic Counter`

즉 사용자는 오프라인에서 실제 자산을 직접 움직이는 것이 아니라, 서버가 미리 인정한 담보 범위 내에서 spending proof를 생성한다.

## 3. 담보 채우기 / 해제 정책

### 3.1 담보 채우기

`담보 채우기`는 일반 잔액을 바로 쓰는 것이 아니라, 자산 일부를 오프라인 결제 전용 collateral로 잠그는 행위다.

- 온라인 상태에서는 `offline_pay -> coin_manage /internal/offline-pay/collateral/lock`
- 오프라인 상태에서는 `COLLATERAL_TOPUP` intent를 로컬 큐에 저장
- 온라인 복귀 후 서버가 내부원장 기준으로 실제 lock 가능 여부를 다시 판정

클라이언트는 오프라인에서도 topup intent를 만들 수 있지만, 무제한으로 만들면 안 된다.
앱은 `마지막 온라인 시점 내부원장 스냅샷`을 토큰별로 캐시하고, 그 범위 안에서만 topup intent를 허용한다.

### 3.2 담보 해제

`담보 해제`는 아직 사용되지 않은 collateral `remaining_amount`를 일반 사용 가능 상태로 되돌리는 행위다.

- 온라인 상태에서는 `offline_pay -> coin_manage /internal/offline-pay/collateral/release`
- 오프라인 상태에서는 `COLLATERAL_RELEASE` intent를 로컬 큐에 저장
- 온라인 복귀 후 서버가 현재 collateral 상태, pending settlement 여부, remaining amount를 기준으로 최종 판정

### 3.3 클라이언트 제한과 서버 판정은 분리한다

클라이언트는 UX 차원의 1차 제한만 한다.
최종 진실은 서버가 가진다.

- 클라이언트: 마지막 온라인 잔액/담보 스냅샷 기준 1차 제한
- 서버: 실제 내부원장과 collateral 상태 기준 최종 승인/거절

## 4. 오프라인 클라이언트 동작 정책

### 4.1 담보가 없어도 연결은 가능해야 한다

NFC / QR 연결과 인증은 담보가 없어도 시작할 수 있어야 한다.

막아야 하는 시점은 아래뿐이다.

- 실제 전송 확인 시 requested amount > available collateral
- 보안 디바이스 등록 없음
- 로컬 인증 미설정
- 미지원 네트워크

즉 `연결 가능 여부`와 `실제 전송 가능 여부`는 분리한다.

### 4.2 마지막 온라인 정보는 로컬에 보관한다

오프라인 UX에 필요한 값은 마지막 온라인 시점 기준으로 로컬에 캐시한다.

- 사용자 닉네임 / loginId
- deviceRegistrationId
- device alias
- 최근 연결 상대 peer 정보
- collateral snapshot
- 토큰별 마지막 온라인 내부원장 잔액 snapshot

### 4.3 오프라인 큐는 intent 저장소다

오프라인 상태에서 서버 API가 직접 호출되지 않더라도 아래 요청은 로컬 큐에 저장되어야 한다.

- `SETTLEMENT`
- `COLLATERAL_TOPUP`
- `COLLATERAL_RELEASE`

온라인 복귀 후 queue worker가 배치 업로드한다.

## 5. 서버 처리 정책

### 5.1 offline_pay 책임

`offline_pay`는 아래를 검증한다.

- proof schema
- device binding
- signature 가능 시 검증
- duplicate / conflict
- hash chain
- collateral remaining amount
- network / token policy

정산 성공 시 `coin_manage`에는 내부원장 finalize 이벤트만 전달한다.

### 5.2 coin_manage 책임

`coin_manage`는 아래를 강제한다.

- offline collateral lock / release를 내부원장으로 기록
- offline settlement finalized를 내부원장으로 기록
- `proofFingerprint` 재검증
- outbox / audit log 보존
- 실출금은 기존 withdraw 진입점으로만 처리

현재 오프라인 결제는 기본적으로 `internal ledger only`가 맞다.
즉 settlement 성공 후 자동으로 체인 출금시키지 않는다.

### 5.3 is_test 사용자 정책

`coin_system_cloud.users.is_test = 1` 사용자는 mainnet 실출금이 금지되어야 한다.
이 규칙은 요청 시점뿐 아니라 worker 실행 직전에도 재검증해야 한다.

오프라인 결제는 기본적으로 내부원장 반영이라 바로 mainnet 문제로 이어지지 않지만,
추후 withdraw 연계 시에도 동일 정책을 그대로 지켜야 한다.

## 6. 멱등성 / 유일성 / 체이닝 정책

오프라인 결제는 아래 3개를 함께 유지해야 한다.

### 6.1 멱등성

- `batchId`
- `settlementId`
- `referenceId`
- `proofFingerprint`

동일 요청이 다시 와도 서버는 중복 반영하지 않아야 한다.

### 6.2 유일 트랜잭션 체이닝

proof는 이전 상태에 연결되는 체인으로 본다.

`newStateHash = H(prevStateHash + amount + monotonicCounter + deviceId + nonce)`

즉

- 이전 상태 해시가 없으면 다음 상태 생성 불가
- monotonic counter가 증가하지 않으면 reject
- 동일 state/nonce/counter 재사용은 reject

### 6.3 내부원장 정합성 우선

클라이언트 로컬 상태는 참고값일 뿐이다.
최종 확정은 내부원장 기록과 settlement 결과가 일치해야 한다.

## 7. 현재 구현 결론

현재 기준 결론은 아래와 같다.

- 오프라인 결제는 `내부원장 기반 서비스 연속성`을 보장하는 구조다
- settlement 성공 후 자동 실출금은 하지 않는다
- collateral topup/release도 오프라인 intent로 저장 가능하다
- 다만 최종 승인은 온라인 복귀 후 내부원장 기준으로 다시 판정한다
- 클라이언트는 마지막 온라인 snapshot으로 UX를 제공하고, 서버는 실제 정합성을 보장한다

## 8. 후속 구현 우선순위

1. `offline_pay`에서 topup/release batch 이벤트를 별도 타입으로 더 명확히 분리
2. `coin_manage`에서 collateral topup/release 운영 조회 API 추가
3. 관리자 페이지에서 token별 collateral / remaining / pending intent / failed intent 모니터링 추가
4. settlement / collateral 이벤트 reason code를 앱 큐 상태와 완전히 표준화
