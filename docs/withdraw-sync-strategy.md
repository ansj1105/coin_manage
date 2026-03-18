# 출금 상태 동기화 전략

## 목적

`foxya_coin_service`와 `coin_manage` 사이의 출금 처리를 요청 제출 수준이 아니라 전체 생명주기 기준으로 정렬한다.

핵심 목표는 아래 3가지다.

- 출금 상태의 정본을 하나로 고정한다.
- 여러 인스턴스가 떠 있어도 상태 불일치가 나지 않게 한다.
- 장애 시 재처리 경로를 운영자가 명확히 이해할 수 있게 한다.

## 현재 구조

- `foxya_coin_service`는 사용자 출금 요청을 받아 `coin_manage`로 전달한다.
- `coin_manage`는 원장 reserve, 외부인증, 관리자 승인, broadcast, confirm을 담당한다.
- `foxya_coin_service`는 `coin_manage_withdrawal_id`를 저장하지만 최종 상태 동기화는 약하다.

즉 현재는 `request bridge`는 있으나 `lifecycle sync`는 부족하다.

## 정본 원칙

출금 상태의 정본은 `coin_manage` DB로 둔다.

이유는 아래와 같다.

- 실제 상태 머신이 `coin_manage`에서 돈다.
- 승인, broadcast, confirm, fail 감사로그가 `coin_manage`에 쌓인다.
- 온체인 결과와 내부 원장 정합성 판단도 `coin_manage`가 담당한다.

`foxya_coin_service`는 사용자 요청 접수와 사용자 표시 모델을 담당하는 read-side에 가깝게 유지한다.

## Redis 사용 원칙

Redis는 사용할 수 있지만 정본 저장소로 쓰면 안 된다.

허용되는 용도

- 분산 락
- 작업 큐
- 일시적 이벤트 전달
- 재시도 지연 큐

정본으로 부적합한 이유

- 재시작과 만료 정책에 따라 상태 유실 위험이 있다.
- 감사 추적과 회계 정합성의 기준으로 삼기 어렵다.
- 최종 상태 합의가 아니라 전달 최적화에 더 적합하다.

## 클러스터링 관점

노드를 여러 개 띄우는 것은 가용성과 처리량 문제를 푸는 수단이다.

- `coin_manage`: `app-api`, `app-withdraw-worker`, `app-ops`
- `foxya_coin_service`: `app`, `app2`

하지만 클러스터링만으로 상태 동기화가 해결되지는 않는다.

필요한 것은 아래 두 가지다.

- 정본 상태를 쓰는 단일 write model
- 타 인스턴스에 상태를 반영하는 명시적 contract

## 권장 동기화 방식

1차 권장안은 `coin_manage -> foxya` 상태 callback이다.

이유

- 출금 상태 전이가 일어나는 쪽에서 바로 통지할 수 있다.
- `foxya`가 polling 없이 사용자 표시 상태를 빠르게 갱신할 수 있다.
- 실패/재시도 정책을 callback delivery 계층으로 분리할 수 있다.

보완책으로 `foxya -> coin_manage` polling/reconcile API도 둔다.

이유

- callback 유실이나 일시 장애가 있어도 최종 수렴이 가능하다.
- 운영자가 수동 복구 없이 상태를 다시 맞출 수 있다.

즉 추천은 `callback + polling fallback` 조합이다.

## 권장 상태 전파 계약

최소 계약 필드

- `schemaVersion`
- `withdrawalId`
- `externalTransferId` 또는 `foxya transferId`
- `status`
- `txHash`
- `failedReason`
- `updatedAt`

상태 맵핑 예시

- `LEDGER_RESERVED`, `PENDING_ADMIN`, `ADMIN_APPROVED` -> `PROCESSING`
- `TX_BROADCASTED` -> `SENT`
- `COMPLETED` -> `COMPLETED`
- `FAILED` -> `FAILED`

`foxya`는 내부 사용자 표시 상태를 따로 가져가되, 원본 상태 코드와 마지막 동기화 시각을 함께 저장하는 것이 좋다.

## 운영 규칙

- 신규 runtime env는 모든 관련 컨테이너에 동일하게 전달한다.
- callback은 멱등해야 하며 같은 상태 재수신을 허용해야 한다.
- callback 실패는 audit log와 retry queue에 남긴다.
- polling은 최종 수렴용이므로 짧은 주기보다 안정성이 우선이다.

## 다음 구현 순서

1. `coin_manage` 출금 상태 callback contract 정의
2. `foxya` 내부 callback 수신 API와 멱등 업데이트 구현
3. callback 실패 retry queue 또는 outbox 설계
4. `foxya -> coin_manage` reconcile/polling 보조 경로 추가
