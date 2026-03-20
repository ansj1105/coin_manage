# Primary DB 장애 대응 정책

## 1. 목적

이 문서는 `primary DB 불능`, `db-proxy가 standby에 잘못 붙는 상황`, `앱이 read-only DB를 바라보는 상황`에 대한 운영 정책을 정리한다.

이번 실제 장애에서 확인된 패턴은 아래와 같았다.

- 원격 primary가 붙지 않음
- `db-proxy`가 backup standby로 자동 하강
- 앱 로그인/가입/결제 등 쓰기 경로가 `read-only transaction`으로 실패

이 문서의 목적은 같은 장애가 다시 나와도:

1. standby 승격 기준이 명확하고
2. 알림이 빠르게 오고
3. `db-proxy`가 read-only 경로로 서비스 트래픽을 받지 않도록
운영 기준을 고정하는 것이다.

## 2. 장애 유형 정의

### 2.1 Primary 연결 실패

조건

- `DB_PRIMARY_HOST:DB_PRIMARY_PORT` TCP 연결 실패
- `db-proxy` health check에서 primary down

예시

- `connect ECONNREFUSED`
- `connect ETIMEDOUT`

### 2.2 Primary는 살아 있으나 쓰기 불가

조건

- primary 연결은 되지만 `transaction_read_only = on`
- `INSERT/UPDATE/DELETE` probe 실패

예시

- `cannot execute INSERT in a read-only transaction (25006)`

### 2.3 db-proxy의 잘못된 fallback

조건

- primary가 죽어서 `db-proxy`가 standby로 내려감
- 그런데 앱은 여전히 쓰기 요청을 계속 보냄

이 경우 읽기 쿼리는 살아 보여도 쓰기 기능은 전부 장애가 된다.

## 3. 운영 원칙

### 3.1 앱 서비스는 read-only DB를 절대 primary처럼 쓰면 안 된다

원칙

1. `db-proxy` 뒤 현재 연결 노드가 `pg_is_in_recovery() = true`면 쓰기 서비스로 사용 금지
2. `transaction_read_only = on`이면 로그인, 가입, 결제, 출금 요청 API는 장애 상태로 판단
3. "일단 살아 있으니 서비스 유지" 방식으로 standby에 앱을 붙여두지 않는다

### 3.2 primary 불능 시 정책은 "읽기 유지"가 아니라 "쓰기 경로 복구"다

우선순위

1. 현재 primary 복구 가능 여부 확인
2. 복구가 지연되면 standby 승격
3. `db-proxy`를 새 primary 기준으로 재설정
4. 앱 write probe 성공 후에만 서비스 정상 판정

### 3.3 앱은 항상 `db-proxy`만 본다

원칙

- 앱 서비스는 직접 primary/standby IP를 바라보지 않음
- 운영자가 전환할 때는 `.env`의 `DB_PRIMARY_HOST`, `DB_STANDBY_HOST`, `DB_ADMIN_HOST`만 바꿈
- 앱 `DB_HOST`는 계속 `db-proxy`

### 3.4 standby와 backup은 같은 것이 아니다

원칙

1. standby는 HA/failover용이다
2. backup은 사용자 실수, 잘못된 배치, 데이터 오염, 장시간 장애 복구용이다
3. 운영 기준은 `primary + standby + backup` 3축을 같이 설계한다
4. `coin_manage`처럼 출금 원장 정본을 가진 DB는 replica만 두고 backup을 생략하면 안 된다

## 4. 장애 대응 정책

### 4.1 1차 대응

1. `db-proxy`가 현재 어느 노드를 primary로 보고 있는지 확인
2. 실제 연결된 DB의 `pg_is_in_recovery()` 확인
3. write probe 실행

점검 기준 예시

```sql
show transaction_read_only;
select pg_is_in_recovery();
begin;
create temporary table rw_probe(id int);
insert into rw_probe values (1);
rollback;
```

### 4.2 primary가 불능이고 standby가 최신이면

정책

1. standby 승격 허용
2. `.env`의 `DB_PRIMARY_HOST`를 새 primary로 변경
3. 이전 primary는 `DB_STANDBY_HOST`로 내려서 나중에 failback 대상으로 둠
4. `db-proxy` 재기동
5. 앱 health + write probe 성공 확인

### 4.3 standby 승격 조건

승격 전에 최소 확인

1. standby가 정상 기동
2. 마지막 복제 상태가 심각하게 뒤처지지 않음
3. 운영자가 split-brain 가능성을 이해하고 기존 primary를 격리했음

### 4.4 승격 이후

필수 작업

1. 앱 로그인/가입/출금 요청 등 대표 write API 확인
2. `DB_ADMIN_HOST`를 새 primary 기준으로 수정
3. Flyway/백업도 새 primary로만 실행
4. 이전 primary는 즉시 다시 앱 트래픽에 넣지 않음

## 5. Telegram 알림 정책

### 5.1 즉시 알림 대상

다음 조건이면 즉시 Telegram 발송

1. `db-proxy`가 primary 연결 실패
2. 앱 write probe 실패
3. `transaction_read_only = on` 상태가 앱 서비스 경로에서 감지됨
4. standby promote 실행
5. failback 완료

### 5.2 알림 메시지 예시

```text
[DB FAILOVER ALERT]
service=foxya
event=primary_unreachable
primary=172.31.89.103:15432
proxy=db-proxy
action=standby_fallback_detected
write_blocked=true
```

```text
[DB FAILOVER ACTION]
service=foxya
event=standby_promoted
new_primary=postgres:5432
old_primary=172.31.89.103:15432
proxy_reloaded=true
write_probe=ok
```

### 5.3 알림 억제

원칙

1. 같은 장애 키로 1~5분 쿨다운
2. 장애 중복 발송 방지
3. 복구 알림은 별도로 1회 발송

## 6. db-proxy 정책

### 6.1 현재 문제

기본 HAProxy 구성은 primary down이면 backup standby로 연결을 내릴 수 있다.
하지만 PostgreSQL standby는 기본적으로 read-only다.

즉 단순 TCP health check만으로는 "앱이 붙어도 되는 노드인지" 보장하지 못한다.

### 6.2 정책

1. 쓰기 서비스용 `db-proxy`는 read-only standby를 자동 primary 대체로 사용하지 않는다
2. standby는 수동 승격 이후에만 새 primary로 등록한다
3. 자동 fallback은 "읽기 전용 서비스"가 따로 있을 때만 허용

### 6.3 권장 설정 방향

운영 write path 기준 권장 방식

- `server primary ... check`
- `server standby ... check disabled` 또는 관리자가 승격 후 enable

즉 standby는 backup으로 항상 열어두지 않고, 승격 시점에만 primary로 교체하는 구조가 더 안전하다.

### 6.4 최소 보호 정책

자동 fallback을 유지해야 한다면 최소한 아래 중 하나가 필요하다.

1. 앱 startup/health check에서 write probe 강제
2. `db-proxy` health check를 PostgreSQL role-aware 체크로 변경
3. `pg_is_in_recovery() = false` 노드만 write path에 포함

## 7. 장애 복구 표준 절차

### 7.1 Primary down 감지

1. Telegram 알림 수신
2. 운영자 점검
3. current primary TCP/DB 상태 확인

### 7.2 복구 분기

- 빠르게 복구 가능
	- 기존 primary 복구
	- `db-proxy` 정상화
	- write probe 확인
- 빠르게 복구 불가
	- standby promote
	- `.env` 갱신
	- `db-proxy` 재기동
	- write probe 확인

### 7.3 서비스 정상 판정 조건

아래를 모두 만족해야 정상 복구로 본다.

1. 앱 health `UP`
2. `transaction_read_only = off`
3. `pg_is_in_recovery() = false`
4. write probe 성공
5. 대표 write API 성공

## 8. failback 정책

원칙

1. 장애 중 임시 primary가 된 노드는 계속 primary로 유지
2. 옛 primary는 새 standby로 재구성
3. 복제 정상화 후에만 원래 구조 복귀 검토

즉 "기존 primary가 살아났다"만으로 바로 되돌리지 않는다.

## 9. 현재 운영에 바로 적용할 항목

즉시 적용 권장

1. `ExternalAlertMonitor` 또는 별도 DB watcher에서 write probe 기반 Telegram 알림 추가
2. `db-proxy` write path에서 standby 자동 fallback 금지
3. 장애 시 운영자가 수정할 `.env` 기준값 표준화
4. 장애 직후 확인용 명령어 Runbook 고정
5. `coin_manage` 전용 postgres에도 primary/standby 구조 적용
6. standby와 별도로 base backup / WAL archive / snapshot 정책 확정

## 10. coin_manage 적용 메모

적용 이유

- `coin_manage`는 출금 lifecycle state의 canonical write model이다
- `app-api`, `app-withdraw-worker`, `app-ops`가 모두 같은 postgres 정본에 의존한다
- 이 DB가 단독 장애로 내려가면 신규 출금 승인/dispatch/reconcile이 모두 멈춘다

권장 구조

1. primary는 `Korion Server`에 둔다
2. standby는 `Standby Server`에 둔다
3. 앱은 직접 두 노드를 보지 않고 고정 DB endpoint 또는 proxy만 본다
4. standby는 승격 전까지 read-only로 유지한다
5. backup은 standby와 별도로 보관한다

## 11. 작성 요약

정책의 핵심은 단순하다.

1. primary가 안 붙으면 Telegram으로 즉시 알린다
2. standby가 read-only면 앱을 계속 붙여두지 않는다
3. 필요하면 standby를 승격한 뒤에만 새 primary로 사용한다
4. `db-proxy`는 read-only standby로 자동 하강해 앱 write 트래픽을 받지 않게 설계한다
5. 서비스 정상 판정은 health가 아니라 "실제 write 성공"으로 한다
6. standby는 HA용이고 backup은 복구용이므로 둘 다 필요하다
