# KORION EC2 Deployment Guide

## 권장 배치

- 권장 1순위
  - Public Subnet: `ALB`
  - Private Subnet: `EC2 (Ubuntu)`, `Docker Compose`, `PostgreSQL volume`
  - 접속: `AWS Systems Manager Session Manager`

- 간단 배치
  - Public Subnet: `EC2 (Ubuntu)` 단독
  - 접속: `Session Manager` 또는 제한된 `SSH`
  - 주의: 운영은 가능하지만 ALB/사설 서브넷 구성보다 보안 여유가 적음

## 왜 이 구성이 좋은가

- `Session Manager`를 쓰면 SSH 포트를 열지 않아도 됨
- ALB를 두면 EC2에 80/443을 직접 열지 않고도 확장 가능
- 현재 앱은 Docker Compose로 `postgres -> flyway -> app` 순서 기동 가능

## EC2 권장 설정

- OS: `Ubuntu 22.04 LTS` 또는 `Ubuntu 24.04 LTS`
- IAM Role: `AmazonSSMManagedInstanceCore`
- EBS: `gp3`
- Public IP
  - ALB 사용 시: EC2는 불필요
  - 단독 EC2 사용 시: 필요

## 보안 그룹 권장

### A. ALB + Private EC2 권장안

- `sg-alb`
  - Inbound `80/tcp` from `0.0.0.0/0`
  - Inbound `443/tcp` from `0.0.0.0/0`
  - Outbound to `sg-korion-app`

- `sg-korion-app`
  - Inbound `3000/tcp` from `sg-alb`
  - Inbound `22/tcp`: 없음
  - Inbound `5432/tcp`: 없음
  - Outbound: 기본 허용 또는 최소 `443`, `53`, `123`
  - 참고: `Session Manager`를 쓸 경우 SSM/SSMMessages/EC2Messages 통신을 위해 `443` 아웃바운드는 필요

### B. EC2 단독 운영안

- `sg-korion-app`
  - Inbound `80/tcp` from `0.0.0.0/0`
  - Inbound `443/tcp` from `0.0.0.0/0`
  - Inbound `22/tcp`
    - 권장: 없음 (`Session Manager` 사용)
    - 대안: 관리자 고정 IP `/32`만 허용
  - Inbound `3000/tcp`: 없음
  - Inbound `5432/tcp`: 없음
  - Outbound: 기본 허용 또는 최소 `443`, `53`, `123`

## 열면 안 되는 포트

- `3000`: 앱 내부 포트이므로 외부 공개 금지
- `5432`: PostgreSQL 공개 금지
- `22`: 가능하면 열지 말고 `Session Manager` 사용

실행 바인딩 권장:
- `APP_BIND_ADDRESS=0.0.0.0`
  - ALB 또는 Nginx가 앱 포트에 접근해야 할 때
- `DB_BIND_ADDRESS=127.0.0.1`
  - PostgreSQL을 호스트 로컬로만 노출

## Ubuntu 서버 초기 세팅

Docker 공식 문서 기준으로 `apt` 저장소 설치:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"${UBUNTU_CODENAME:-$VERSION_CODENAME}\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ubuntu
```

로그인 다시 한 뒤 확인:

```bash
docker --version
docker compose version
docker run hello-world
```

## 배포 절차

현재 프로젝트는 서버에서 `Node`를 직접 설치할 필요 없이 Docker만 있으면 됨.
서버에서는 `npm run stack:up` 대신 아래를 권장:

```bash
git clone <repo-url> korion
cd korion
cp .env.example .env
```

운영용 `.env` 필수값:

```env
NODE_ENV=production
APP_PORT=3000
APP_BIND_ADDRESS=0.0.0.0
APP_LEDGER_PROVIDER=postgres
APP_TRON_GATEWAY_MODE=mock
JWT_SECRET=strong-random-secret
HOT_WALLET_ADDRESS=TYKL8DPoR99bccujHXxcyBewCV1NimdRc8
HOT_WALLET_PRIVATE_KEY=...
DB_PORT=5432
DB_HOST_PORT=15432
DB_BIND_ADDRESS=127.0.0.1
DB_NAME=korion
DB_USER=korion
DB_PASSWORD=strong-db-password
```

실제 TRC20 송금까지 사용할 경우:

```env
APP_TRON_GATEWAY_MODE=trc20
KORI_TOKEN_CONTRACT_ADDRESS=TPKZnRjJngnxVgxw52pMPSrCp2wGm7iT9W
TRON_FEE_LIMIT_SUN=100000000
```

주의:
- 위 컨트랙트 주소는 현재 테스트넷 기준이다.
- 운영 메인넷 배포 시에는 메인넷 컨트랙트 주소로 분리해야 한다.

실행:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

## 운영 체크

- 헬스 확인
  - `curl http://127.0.0.1:3000/health`
- 마이그레이션 확인
  - `docker compose logs flyway`
- 앱 로그 확인
  - `docker compose logs -f app`

## 추가 권장

- Nginx 또는 ALB 뒤에 두고 `HTTPS` 적용
- `.env`는 절대 git에 커밋하지 않기
- PostgreSQL 볼륨 백업 정책 만들기
- `CloudWatch Agent` 또는 별도 로그 수집 구성
- 운영 전 메인넷 `KORI_TOKEN_CONTRACT_ADDRESS` 확보 후 실출금 검증

## 주의

- Docker 문서 기준으로 Ubuntu에서 방화벽 규칙은 Docker와 상호작용 이슈가 있을 수 있음
- 따라서 인바운드 통제는 `UFW`보다 `AWS Security Group`을 1차로 두는 것을 권장
- AWS 공식 문서 기준으로 `Session Manager`는 인스턴스에 SSH 인바운드 없이 접속 가능하도록 설계됨
