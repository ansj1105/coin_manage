#!/bin/bash

set -euo pipefail

PROJECT_LABEL="${PROJECT_LABEL:-coin_manage}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
MONITORED_SERVICES="${MONITORED_SERVICES:-app-api app-ops app-withdraw-worker postgres redis}"
EXTRA_CONTAINERS="${EXTRA_CONTAINERS:-ledger-signer}"
APP_ROOT="${APP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_DIR="${STATE_DIR:-${APP_ROOT}/.monitor-state}"
STATE_FILE="${STATE_DIR}/container-watch.state"
LOCK_FILE="${STATE_DIR}/container-watch.lock"
COOLDOWN_SEC="${CONTAINER_MONITOR_COOLDOWN_SEC:-900}"
STARTING_GRACE_SEC="${CONTAINER_MONITOR_STARTING_GRACE_SEC:-180}"
COMPOSE_CONFIG_CACHE="${COMPOSE_CONFIG_CACHE:-}"

mkdir -p "${STATE_DIR}"
exec 9>"${LOCK_FILE}"
flock -n 9 || exit 0

load_env_file() {
    if [ ! -f ".env" ]; then
        return
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            ''|\#*)
                continue
                ;;
        esac

        key="${line%%=*}"
        value="${line#*=}"

        if [ -z "$key" ] || [ "$key" = "$line" ]; then
            continue
        fi

        export "$key=$value"
    done < ./.env
}

compose_cmd() {
    if docker compose version >/dev/null 2>&1; then
        docker compose -f "${COMPOSE_FILE}" "$@"
    else
        docker-compose -f "${COMPOSE_FILE}" "$@"
    fi
}

compose_config() {
    if [ -z "${COMPOSE_CONFIG_CACHE}" ]; then
        COMPOSE_CONFIG_CACHE="$(compose_cmd config 2>/dev/null || true)"
    fi
    printf '%s\n' "${COMPOSE_CONFIG_CACHE}"
}

resolve_service_container_name() {
    local service="${1:-}"
    compose_config | awk -v svc="${service}" '
        BEGIN { in_services = 0; in_target = 0 }
        /^services:/ { in_services = 1; next }
        in_services && /^[^[:space:]]/ { in_services = 0 }
        !in_services { next }
        $0 ~ "^  " svc ":$" { in_target = 1; next }
        in_target && $0 ~ "^  [^[:space:]][^:]*:$" { in_target = 0 }
        in_target && match($0, /^    container_name: (.+)$/, arr) {
            print arr[1]
            exit
        }
    '
}

resolve_monitored_container_id() {
    local service="${1:-}"
    local container_id=""
    container_id="$(compose_cmd ps -q "${service}" 2>/dev/null | head -n 1)"
    if [ -n "${container_id}" ]; then
        printf '%s' "${container_id}"
        return
    fi

    local container_name=""
    container_name="$(resolve_service_container_name "${service}")"
    if [ -n "${container_name}" ]; then
        container_id="$(docker ps -aq --filter "name=^${container_name}$" | head -n 1)"
        if [ -n "${container_id}" ]; then
            printf '%s' "${container_id}"
            return
        fi
    fi

    container_id="$(docker ps -aq --filter "label=com.docker.compose.service=${service}" | head -n 1)"
    printf '%s' "${container_id}"
}

telegram_send() {
    local title="${1:-}"
    local body="${2:-}"

    if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
        return
    fi

    local message
    message="${title}"
    if [ -n "${body}" ]; then
        message="${message}\n${body}"
    fi

    curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"${message}\",\"disable_web_page_preview\":true}" >/dev/null
}

inspect_container_issue() {
    local label="${1:-}"
    local container_id="${2:-}"

    if [ -z "${container_id}" ]; then
        echo "${label}=missing"
        return
    fi

    local status
    status="$(docker inspect -f '{{.State.Status}}' "${container_id}" 2>/dev/null || echo missing)"
    local created_at
    created_at="$(docker inspect -f '{{.Created}}' "${container_id}" 2>/dev/null || true)"
    local age_sec="999999"
    if [ -n "${created_at}" ]; then
        age_sec="$(( $(date +%s) - $(date -d "${created_at}" +%s 2>/dev/null || date +%s) ))"
    fi
    if [ "${status}" != "running" ]; then
        if { [ "${status}" = "created" ] || [ "${status}" = "restarting" ]; } && [ "${age_sec}" -lt "${STARTING_GRACE_SEC}" ]; then
            return
        fi
        echo "${label}=status:${status}"
        return
    fi

    local health
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
    if [ -n "${health}" ] && [ "${health}" != "healthy" ]; then
        if [ "${health}" = "starting" ] && [ "${age_sec}" -lt "${STARTING_GRACE_SEC}" ]; then
            return
        fi
        echo "${label}=health:${health}"
        return
    fi
}

inspect_runtime_invariants() {
    local issues=()
    local app_ops_id=""
    app_ops_id="$(resolve_monitored_container_id "app-ops")"
    if [ -z "${app_ops_id}" ]; then
        printf '%s\n' "${issues[@]}" | sed '/^$/d'
        return
    fi

    if ! docker exec "${app_ops_id}" node - <<'NODE' >/dev/null 2>&1
const net = require('net');
const host = process.env.FOXYA_DB_HOST;
const port = Number(process.env.FOXYA_DB_PORT || 15432);
if (!host || !port) process.exit(0);
const socket = net.connect({ host, port, timeout: 1500 });
socket.on('connect', () => { socket.end(); process.exit(0); });
socket.on('timeout', () => { socket.destroy(); process.exit(1); });
socket.on('error', () => process.exit(1));
NODE
    then
        issues+=("foxya-db-bridge=unreachable")
    fi

    if ! docker exec "${app_ops_id}" node - <<'NODE' >/dev/null 2>&1
const raw = process.env.FOXYA_INTERNAL_API_URL;
if (!raw) process.exit(0);
const url = new URL(raw);
const target = `${url.origin}/api/health`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 2000);
fetch(target, { signal: controller.signal }).then((response) => {
  clearTimeout(timer);
  process.exit(response.ok ? 0 : 1);
}).catch(() => {
  clearTimeout(timer);
  process.exit(1);
});
NODE
    then
        issues+=("foxya-api-health=down")
    fi

    printf '%s\n' "${issues[@]}" | sed '/^$/d'
}

collect_issues() {
    local issues=()
    local service

    for service in ${MONITORED_SERVICES}; do
        local container_id
        container_id="$(resolve_monitored_container_id "${service}")"
        local issue
        issue="$(inspect_container_issue "${service}" "${container_id}")"
        if [ -n "${issue}" ]; then
            issues+=("${issue}")
        fi
    done

    for service in ${EXTRA_CONTAINERS}; do
        local container_id
        container_id="$(docker ps -aq --filter "name=^${service}$" | head -n 1)"
        local issue
        issue="$(inspect_container_issue "${service}" "${container_id}")"
        if [ -n "${issue}" ]; then
            issues+=("${issue}")
        fi
    done

    while IFS= read -r issue; do
        [ -n "${issue}" ] && issues+=("${issue}")
    done < <(inspect_runtime_invariants)

    printf '%s\n' "${issues[@]}" | sed '/^$/d' | sort
}

read_state() {
    LAST_SIGNATURE=""
    LAST_SENT_AT="0"

    if [ ! -f "${STATE_FILE}" ]; then
        return
    fi

    # shellcheck disable=SC1090
    source "${STATE_FILE}"
}

write_state() {
    local signature="${1:-}"
    local sent_at="${2:-0}"
    cat > "${STATE_FILE}" <<EOF
LAST_SIGNATURE='${signature}'
LAST_SENT_AT='${sent_at}'
EOF
}

main() {
    cd "${APP_ROOT}"
    load_env_file

    local hostname
    hostname="$(hostname)"
    local now
    now="$(date +%s)"

    read_state

    mapfile -t issues < <(collect_issues)
    local signature=""
    if [ "${#issues[@]}" -gt 0 ]; then
        signature="$(printf '%s|' "${issues[@]}")"
    fi

    if [ -n "${signature}" ]; then
        local elapsed=$((now - ${LAST_SENT_AT:-0}))
        if [ "${signature}" != "${LAST_SIGNATURE:-}" ] || [ "${elapsed}" -ge "${COOLDOWN_SEC}" ]; then
            telegram_send \
                "[KORION] Container Down Alert" \
                "project=${PROJECT_LABEL}\nhost=${hostname}\nissues=$(printf '%s, ' "${issues[@]}" | sed 's/, $//')"
            write_state "${signature}" "${now}"
        fi
        return
    fi

    if [ -n "${LAST_SIGNATURE:-}" ]; then
        telegram_send \
            "[KORION] Container Recovered" \
            "project=${PROJECT_LABEL}\nhost=${hostname}\nmessage=all monitored containers are healthy"
    fi
    write_state "" "0"
}

main "$@"
