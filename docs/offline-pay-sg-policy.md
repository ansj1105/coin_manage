# Offline Pay 연동 SG 정책

## 1. 목적

이 문서는 `offline_pay` 서버가 `coin_manage`, `fox_coin`과 내부 연동할 때 필요한 보안그룹(Security Group), 공개 포트, 프록시 경로를 운영 기준으로 정리한다.

이번 확인 기준 결론은 아래와 같다.

- `coin_manage`는 host nginx가 `80 -> 127.0.0.1:3000`으로 프록시한다.
- `fox_coin`은 host nginx가 `api.korion.io.kr:443 -> 127.0.0.1:8080`으로 프록시한다.
- `offline_pay`는 실제 운영에서 아래 두 공개 엔드포인트를 기준으로 붙는 것이 가장 단순하다.
  - `coin_manage`: `http://54.83.183.123`
  - `fox_coin`: `https://api.korion.io.kr`

## 2. 서버 역할

### 2.1 Offline Pay Server

- public IP: `98.91.96.182`
- 역할
  - `offline_pay app-api`
  - `offline_pay app-worker`
  - `offline_pay postgres`
  - `offline_pay redis`
  - `offline_pay nginx`

### 2.2 Korion Server

- public IP: `54.83.183.123`
- private IP: `172.31.21.248`
- 역할
  - `coin_manage app-api`
  - `coin_manage app-ops`
  - `coin_manage app-withdraw-worker`
  - `coin_manage postgres`
  - `coin_manage redis`
  - host nginx

### 2.3 Main Server

- public IP: `52.200.97.155`
- private IP: `172.31.36.110`
- 역할
  - `foxya_coin_service`
  - `coin_csms`
  - `coin_publish`
  - `coin_system_flyway`
  - host nginx

## 3. 실제 라우팅

### 3.1 `coin_manage`

운영 확인 결과 host nginx 설정은 아래 구조다.

- `listen 80`
- `location / { proxy_pass http://127.0.0.1:3000; }`

즉 `offline_pay`가 붙을 엔드포인트는 아래와 같다.

- base URL: `http://54.83.183.123`
- internal path
  - `POST /api/internal/offline-pay/collateral/lock`
  - `POST /api/internal/offline-pay/settlements/finalize`

### 3.2 `fox_coin`

운영 확인 결과 host nginx 설정은 아래 구조다.

- `server_name api.korion.io.kr`
- `location / { proxy_pass http://127.0.0.1:8080; }`

즉 `offline_pay`가 붙을 엔드포인트는 아래와 같다.

- base URL: `https://api.korion.io.kr`
- internal path
  - `POST /api/v1/internal/offline-pay/settlements/history`

## 4. SG 규칙

### 4.1 Offline Pay Server SG

Inbound

- `80/tcp`
  - source: `0.0.0.0/0`
  - 목적: 외부 health check 및 운영 접근
- `22/tcp`
  - source: 운영자 고정 IP만 허용
  - 가능하면 Session Manager로 대체

차단

- `3100/tcp` 직접 공개 금지
- `5432/tcp` 공개 금지
- `6379/tcp` 공개 금지

Outbound

- `80/tcp` -> `54.83.183.123`
  - 목적: `coin_manage` 내부 API 호출
- `443/tcp` -> `52.200.97.155` 또는 `api.korion.io.kr`
  - 목적: `fox_coin` 내부 API 호출
- `53/udp`, `53/tcp`
  - 목적: DNS
- 필요 시 패키지 설치/배포용 일반 outbound 허용

### 4.2 Korion Server SG

Inbound

- `80/tcp`
  - source: `Offline Pay Server SG` 또는 `98.91.96.182/32`
  - 목적: `offline_pay -> coin_manage`
- `22/tcp`
  - source: 운영자 고정 IP만 허용

선택

- `3000/tcp`
  - 외부 직접 공개는 권장하지 않음
  - 반드시 필요한 경우에만 특정 source SG/IP로 제한

차단

- `5432/tcp` 공개 금지
- `6379/tcp` 공개 금지
- `15432/tcp` 공개 금지
- `16379/tcp` 공개 금지

Outbound

- 기본 허용이면 충분
- 최소화하려면 `fox_coin`, 외부 체인 API, DNS, 패키지 저장소 정도만 허용

### 4.3 Main Server SG

Inbound

- `443/tcp`
  - source: `Offline Pay Server SG` 또는 `98.91.96.182/32`
  - 목적: `offline_pay -> fox_coin`
- `80/tcp`
  - source: 일반 웹 트래픽 허용 시 `0.0.0.0/0`
  - 단, `offline_pay` 내부 연동만 생각하면 `443`만 열어도 충분
- `22/tcp`
  - source: 운영자 고정 IP만 허용

선택

- `8080/tcp`
  - 직접 공개는 권장하지 않음
  - 필요 시 특정 source만 허용

차단

- `5432/tcp` 공개 금지
- `6379/tcp` 공개 금지
- `15432/tcp` 공개 금지

Outbound

- 기본 허용이면 충분
- 최소화 시 외부 API, DNS, 배포 저장소로 제한

## 5. `offline_pay` 권장 env

```env
COIN_MANAGE_BASE_URL=http://54.83.183.123
FOX_COIN_BASE_URL=https://api.korion.io.kr
```

API 키는 각 서비스에 설정된 `OFFLINE_PAY_INTERNAL_API_KEY`와 반드시 일치해야 한다.

## 6. 운영 체크리스트

### 6.1 `coin_manage`

- `curl http://127.0.0.1:3000/health`
- `curl -i http://127.0.0.1:3000/api/internal/offline-pay/settlements/finalize -X POST -H 'Content-Type: application/json' -d '{}'`
- 기대 결과
  - health: `200`
  - internal route: `401` 또는 payload validation `400`

### 6.2 `fox_coin`

- `curl http://127.0.0.1:8080/health`
- `curl -k -i https://api.korion.io.kr/api/v1/internal/offline-pay/settlements/history -X POST -H 'Content-Type: application/json' -d '{}'`
- 기대 결과
  - health: `200`
  - internal route: `401` 또는 payload validation `400`

### 6.3 `offline_pay`

- `curl http://127.0.0.1/health`
- `COIN_MANAGE_BASE_URL`, `FOX_COIN_BASE_URL`가 공개 프록시 경로로 맞는지 확인
- `coin_manage`가 timeout이면 Korion Server의 `80/tcp` inbound source를 다시 확인
- `fox_coin`이 timeout이면 Main Server의 `443/tcp` inbound source를 다시 확인

## 7. 정리

현재 운영 구조에서 `offline_pay`는 각 서비스의 app 내부 포트로 직접 붙지 않는다.

- `coin_manage`는 `54.83.183.123:80`
- `fox_coin`은 `api.korion.io.kr:443`

즉 SG는 “공개 포트를 완전히 넓게 여는” 방식이 아니라 아래처럼 좁히는 게 맞다.

- Korion Server `80/tcp`: `Offline Pay Server` source만 허용
- Main Server `443/tcp`: `Offline Pay Server` source만 허용
- DB/Redis 포트는 계속 비공개 유지
