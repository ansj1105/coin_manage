# Offline Pay Ledger Reconciliation Policy

## Canonical Basis
- 사용자 총자산 기준은 `foxya total KORI`다.
- 오프라인 담보/락/정산 liability 기준은 `coin_manage ledger`다.
- 정합성 보정 worker는 `foxya total KORI`를 읽어 `coin_manage liability`를 맞춘다.

## Worker Rules
- worker는 주기 실행한다.
- 이전 cycle이 끝나지 않았으면 다음 cycle은 건너뛴다.
- 한 cycle은 최대 `cycleLimit`명의 사용자만 검사한다.
- `toleranceAmount` 이하 차이는 보정하지 않는다.
- `maxAdjustmentAmount` 초과 차이는 자동 보정하지 않고 audit/event만 남긴다.

## Adjustment Rules
- `targetLiabilityBalance = foxya canonical totalBalance`
- `deltaAmount = targetLiabilityBalance - current liability`
- `|delta| <= toleranceAmount`
  - `skipped`
- `|delta| > maxAdjustmentAmount`
  - `failed/skipped with audit`
- 그 외
  - `operationsService.reconcileOfflinePayUserBalance(...)` 실행

## Safety Rules
- write path는 `coin_manage` journal/operation service를 통해서만 수행한다.
- foxya DB를 직접 수정하지 않는다.
- worker는 cycle summary를 로그로 남긴다.
- mismatch가 반복되면 관리자/운영 알림으로 escalation한다.

## Ops Guidance
- 배포 후 확인:
  - worker enabled 여부
  - cycle interval
  - tolerance/max adjustment
  - 최근 audit log / reconciliation event
- 운영 중 기준 불일치는 `foxya total KORI`를 우선 기준으로 본다.
