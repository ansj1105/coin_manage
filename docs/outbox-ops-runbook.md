# Outbox Ops Runbook

## 목적

`coin_manage`의 outbox publisher 운영자가 장애를 빠르게 분류하고 대응할 수 있도록 최소 절차를 정리한다.

## 관련 API

- `GET /api/system/outbox`
- `POST /api/system/outbox/replay`
- `POST /api/system/outbox/recover-processing`
- `POST /api/system/outbox/dead-letter/ack`
- `GET /api/system/event-consumers`
- `GET /api/system/audit-logs`

## 상태 의미

- `pending`
  아직 publish 되지 않았고 `availableAt` 이후 다시 시도된다.
- `processing`
  worker가 현재 claim 해서 publish 중이다.
- `published`
  in-process event bus publish 까지 끝난 상태다.
- `dead_lettered`
  최대 재시도 횟수를 넘어 자동 재시도가 중단된 상태다.

## 기본 점검 순서

1. `GET /api/system/outbox?limit=100`으로 `deadLetteredCount`, `deadLetterUnacknowledgedCount`, `oldestPendingCreatedAt`를 확인한다.
2. `dead_lettered` 항목의 `eventType`, `aggregateType`, `aggregateId`, `lastError`를 먼저 본다.
3. `GET /api/system/audit-logs?entityType=system&entityId=outbox&limit=50`로 최근 replay/recovery/ack 이력을 확인한다.

## 장애 유형 분류 기준

- `external_dependency`
  외부 API, callback target, 네트워크 의존성 장애
- `network`
  일시적 네트워크/timeout 성격이 강한 장애
- `state_conflict`
  중복 처리, 이미 완료됨, 상태 전이 충돌
- `validation`
  payload shape, contract mismatch, 필수값 누락
- `unknown`
  원인 미확정

## 대응 절차

### 1. Dead-letter triage

1. `GET /api/system/outbox`로 대상 이벤트 확인
2. 원인 파악 후 `POST /api/system/outbox/dead-letter/ack`
3. payload

```json
{
  "outboxEventIds": ["<outboxEventId>"],
  "actorId": "ops-admin-1",
  "category": "external_dependency",
  "incidentRef": "INC-2026-0319",
  "note": "foxya callback timeout, incident linked"
}
```

### 2. Replay

외부 의존성 복구 후 dead-letter를 다시 publish 큐에 넣는다.

```json
{
  "outboxEventIds": ["<outboxEventId>"],
  "actorId": "ops-admin-1"
}
```

또는 limit 기반 일괄 재주입:

```json
{
  "limit": 20,
  "actorId": "ops-admin-1"
}
```

### 3. Processing stuck recovery

`processing`이 오래 유지되면 stale recovery를 수행한다.

```json
{
  "timeoutSec": 600,
  "actorId": "ops-admin-1"
}
```

주의:
- stale recovery는 아직 publish 완료 기록이 없는 `processing`을 다시 `pending`으로 되돌리는 절차다.
- subscriber 멱등성 보장이 없는 소비자는 중복 side effect 위험이 있다.

### 4. Consumer triage

`withdrawal.state.changed -> foxya_withdrawal_sync` 소비 상태는 아래 API로 확인한다.

1. `GET /api/system/event-consumers?consumerName=foxya_withdrawal_sync&eventType=withdrawal.state.changed&limit=50`
2. `attempts`에서 최근 실패/성공 시퀀스를 본다.
3. `deadLetters`가 있으면 동일 `eventKey`, `aggregateId` 기준으로 outbox/audit를 같이 본다.

해석 기준:
- `attempts.status=failed`는 subscriber 내부 retry 중 실패 기록이다.
- `deadLetters`는 subscriber max attempt 소진 후 중단된 이벤트다.
- `event_consumer_checkpoints`에 성공 checkpoint가 있으면 outbox replay가 와도 동일 consumer는 중복 처리하지 않는다.

## 현재 한계

- consumer summary는 아직 최근 attempt/dead-letter 조회 중심이다.
- subscriber는 여전히 in-process event bus 기반이라 cross-service broker observability는 아니다.
- consumer DLQ ack/replay API는 아직 없고 outbox 운영 API와 audit를 같이 봐야 한다.

## 다음 고도화 권장

- consumer DLQ ack/replay API
- cross-service broker consumer observability
- DLQ category 별 alert routing
- incidentRef 기반 운영 대시보드 연결
