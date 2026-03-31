#!/usr/bin/env bash

set -euo pipefail

MODE="${1:---check}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-korion}"
DB_USER="${DB_USER:-korion}"

psql_query() {
  local sql="$1"
  ${COMPOSE_CMD} exec -T "${DB_SERVICE}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -F '|' -c "${sql}"
}

read_settings() {
  psql_query "
    SELECT
      COALESCE(current_setting('synchronous_commit', true), ''),
      COALESCE(current_setting('synchronous_standby_names', true), ''),
      COALESCE((SELECT COUNT(*)::text FROM pg_stat_replication WHERE state = 'streaming'), '0'),
      COALESCE((SELECT COUNT(*)::text FROM pg_stat_replication WHERE state = 'streaming' AND sync_state IN ('sync', 'quorum')), '0');
  " | tail -n 1
}

print_stuck_sessions() {
  psql_query "
    SELECT
      pid,
      state,
      COALESCE(wait_event_type, ''),
      COALESCE(wait_event, ''),
      COALESCE(age(now(), query_start)::text, ''),
      regexp_replace(query, '[[:space:]]+', ' ', 'g')
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND (
        wait_event = 'SyncRep'
        OR query LIKE 'select pg_advisory_xact_lock%'
      )
    ORDER BY query_start ASC;
  "
}

terminate_stuck_sessions() {
  psql_query "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND (
        wait_event = 'SyncRep'
        OR query LIKE 'select pg_advisory_xact_lock%'
      );
  " >/dev/null
}

repair_sync_standby() {
  ${COMPOSE_CMD} exec -T "${DB_SERVICE}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "ALTER SYSTEM RESET synchronous_standby_names;" >/dev/null
  ${COMPOSE_CMD} exec -T "${DB_SERVICE}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT pg_reload_conf();" >/dev/null
}

main() {
  local settings
  settings="$(read_settings)"
  local synchronous_commit synchronous_standby_names attached_replica_count healthy_sync_replica_count
  IFS='|' read -r synchronous_commit synchronous_standby_names attached_replica_count healthy_sync_replica_count <<<"${settings}"

  echo "synchronous_commit=${synchronous_commit:-}"
  echo "synchronous_standby_names=${synchronous_standby_names:-}"
  echo "attached_replica_count=${attached_replica_count:-0}"
  echo "healthy_sync_replica_count=${healthy_sync_replica_count:-0}"

  if [[ -n "${synchronous_standby_names}" && "${attached_replica_count:-0}" == "0" ]]; then
    echo "WARNING: synchronous standby is configured, but no streaming replica is attached."
    echo "This state can block commits in SyncRep and stall offline-pay collateral lock/release flows."

    if [[ "${MODE}" == "--repair" ]]; then
      echo "Repairing synchronous_standby_names..."
      repair_sync_standby
      echo "Repair complete."
      read_settings
      return 0
    fi

    if [[ "${MODE}" == "--repair-and-terminate" ]]; then
      echo "Repairing synchronous_standby_names..."
      repair_sync_standby
      echo "Terminating stuck SyncRep/advisory sessions..."
      terminate_stuck_sessions
      echo "Repair and termination complete."
      read_settings
      return 0
    fi

    echo
    echo "Suggested actions:"
    echo "  ./scripts/db-sync-standby-guard.sh --repair"
    echo "  ./scripts/db-sync-standby-guard.sh --repair-and-terminate"
    echo
    echo "Potentially stuck sessions:"
    print_stuck_sessions
    exit 2
  fi

  echo "OK: synchronous standby configuration is not blocking writes."
}

main "$@"
