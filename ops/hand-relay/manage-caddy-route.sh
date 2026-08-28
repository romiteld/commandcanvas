#!/usr/bin/env bash

set -euo pipefail

BEGIN_MARKER='# BEGIN COMMANDCANVAS HAND RELAY'
END_MARKER='# END COMMANDCANVAS HAND RELAY'

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

ACTION="${1:-}"
if [[ -n "$ACTION" ]]; then
  shift
fi

CONFIG='/home/romiteld/matte-service/ops/caddy/Caddyfile'
SNIPPET="$SCRIPT_DIR/caddy/hand-relay.Caddyfile"
CADDY_BIN='/home/romiteld/bin/caddy'
BACKUP_DIR='/home/romiteld/matte-service/ops/caddy/commandcanvas-backups'
ACCESS_LOG="$REPO_ROOT/var/log/caddy/hand-relay-access.log"

usage() {
  printf '%s\n' \
    'Usage: manage-caddy-route.sh ACTION [options]' \
    '' \
    'Actions:' \
    '  validate   Build and validate a candidate without changing the live config.' \
    '  install    Snapshot, validate, install, and reload the Caddy config.' \
    '  rollback   Restore the exact pre-install snapshot and reload Caddy.' \
    '  status     Report whether the managed route marker is present.' \
    '' \
    'Options:' \
    '  --config PATH       Existing Caddyfile to preserve and extend.' \
    '  --snippet PATH      CommandCanvas virtual-host snippet.' \
    '  --caddy PATH        Caddy executable.' \
    '  --backup-dir PATH   Snapshot and state directory.' \
    '  --access-log PATH   Dedicated hand-relay access log.'
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --config)
      (($# >= 2)) || die '--config requires a path'
      CONFIG="$2"
      shift 2
      ;;
    --snippet)
      (($# >= 2)) || die '--snippet requires a path'
      SNIPPET="$2"
      shift 2
      ;;
    --caddy)
      (($# >= 2)) || die '--caddy requires a path'
      CADDY_BIN="$2"
      shift 2
      ;;
    --backup-dir)
      (($# >= 2)) || die '--backup-dir requires a path'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --access-log)
      (($# >= 2)) || die '--access-log requires a path'
      ACCESS_LOG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

case "$ACTION" in
  validate|install|rollback|status)
    ;;
  '')
    usage >&2
    exit 2
    ;;
  *)
    die "unknown action: $ACTION"
    ;;
esac

STATE_FILE="$BACKUP_DIR/state"
CANDIDATE=''
STAGED=''

cleanup() {
  if [[ -n "$CANDIDATE" && -e "$CANDIDATE" ]]; then
    rm -f -- "$CANDIDATE"
  fi
  if [[ -n "$STAGED" && -e "$STAGED" ]]; then
    rm -f -- "$STAGED"
  fi
}
trap cleanup EXIT

has_managed_route() {
  grep -F --quiet -- "$BEGIN_MARKER" "$CONFIG"
}

require_common_files() {
  [[ -f "$CONFIG" ]] || die "Caddy config does not exist: $CONFIG"
  [[ -f "$SNIPPET" ]] || die "hand-relay snippet does not exist: $SNIPPET"
  [[ -x "$CADDY_BIN" ]] || die "Caddy executable is not executable: $CADDY_BIN"
}

build_candidate() {
  has_managed_route && die 'CommandCanvas hand-relay route is already installed'

  CANDIDATE="$(mktemp "${TMPDIR:-/tmp}/commandcanvas-caddy-candidate.XXXXXX")"
  cp -- "$CONFIG" "$CANDIDATE"

  {
    printf '\n%s\n' "$BEGIN_MARKER"
    while IFS= read -r line || [[ -n "$line" ]]; do
      printf '%s\n' "$line"
    done < "$SNIPPET"
    printf '%s\n' "$END_MARKER"
  } >> "$CANDIDATE"

  local original_bytes
  original_bytes="$(wc -c < "$CONFIG" | tr -d ' ')"
  if ! cmp --silent --bytes="$original_bytes" "$CONFIG" "$CANDIDATE"; then
    die 'candidate construction changed bytes in the existing Caddy config'
  fi
}

validate_file() {
  local candidate="$1"
  local log_dir

  log_dir="$(dirname -- "$ACCESS_LOG")"
  mkdir -p -- "$log_dir"
  export COMMANDCANVAS_HAND_RELAY_ACCESS_LOG="$ACCESS_LOG"
  "$CADDY_BIN" validate --config "$candidate" --adapter caddyfile
}

reload_config() {
  export COMMANDCANVAS_HAND_RELAY_ACCESS_LOG="$ACCESS_LOG"
  "$CADDY_BIN" reload --config "$CONFIG" --adapter caddyfile
}

replace_config_atomically() {
  local source="$1"
  local config_dir

  config_dir="$(dirname -- "$CONFIG")"
  STAGED="$(mktemp "$config_dir/.commandcanvas-caddy.XXXXXX")"
  cp -- "$source" "$STAGED"
  chmod --reference="$CONFIG" "$STAGED"
  chown --reference="$CONFIG" "$STAGED" 2>/dev/null || true
  mv -- "$STAGED" "$CONFIG"
  STAGED=''
}

write_state() {
  local status="$1"
  local snapshot="$2"
  local installed_sha="$3"
  local temp_state

  mkdir -p -- "$BACKUP_DIR"
  temp_state="$(mktemp "$BACKUP_DIR/.state.XXXXXX")"
  {
    printf 'status=%s\n' "$status"
    printf 'snapshot=%s\n' "$snapshot"
    printf 'installed_sha256=%s\n' "$installed_sha"
  } > "$temp_state"
  chmod 0600 "$temp_state"
  mv -- "$temp_state" "$STATE_FILE"
}

read_state_value() {
  local key="$1"

  [[ -f "$STATE_FILE" ]] || return 1
  sed -n "s/^${key}=//p" "$STATE_FILE" | head -n 1
}

make_snapshot() {
  local label="$1"
  local timestamp
  local snapshot

  mkdir -p -- "$BACKUP_DIR"
  chmod 0700 "$BACKUP_DIR" 2>/dev/null || true
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  snapshot="$BACKUP_DIR/${timestamp}-$$-${label}.Caddyfile"
  cp --preserve=mode,ownership,timestamps -- "$CONFIG" "$snapshot"
  printf '%s\n' "$snapshot"
}

install_route() {
  local snapshot
  local candidate_sha

  build_candidate
  validate_file "$CANDIDATE"
  snapshot="$(make_snapshot pre-install)"
  candidate_sha="$(sha256sum "$CANDIDATE" | cut -d ' ' -f 1)"
  replace_config_atomically "$CANDIDATE"

  if ! reload_config; then
    replace_config_atomically "$snapshot"
    if reload_config; then
      write_state 'not-installed' "$snapshot" ''
      die "Caddy rejected the reload; restored the pre-install snapshot: $snapshot"
    fi
    die "Caddy reload and automatic recovery both failed; inspect $CONFIG and $snapshot"
  fi

  write_state 'installed' "$snapshot" "$candidate_sha"
  printf 'Installed hands.autolensai.com; pre-install snapshot: %s\n' "$snapshot"
}

rollback_route() {
  local snapshot
  local installed_sha
  local current_sha
  local pre_rollback

  has_managed_route || die 'CommandCanvas hand-relay route is not installed'
  snapshot="$(read_state_value snapshot || true)"
  installed_sha="$(read_state_value installed_sha256 || true)"
  [[ -n "$snapshot" && -f "$snapshot" ]] || die 'pre-install snapshot is missing'
  [[ -n "$installed_sha" ]] || die 'installed config checksum is missing'

  current_sha="$(sha256sum "$CONFIG" | cut -d ' ' -f 1)"
  [[ "$current_sha" == "$installed_sha" ]] || die \
    'live Caddy config changed after install; refusing to overwrite it during rollback'

  validate_file "$snapshot"
  pre_rollback="$(make_snapshot pre-rollback)"
  replace_config_atomically "$snapshot"

  if ! reload_config; then
    replace_config_atomically "$pre_rollback"
    if reload_config; then
      die "rollback reload failed; restored the installed config: $pre_rollback"
    fi
    die "rollback reload and automatic recovery both failed; inspect $CONFIG"
  fi

  write_state 'not-installed' "$snapshot" ''
  printf 'Rolled back CommandCanvas route from snapshot: %s\n' "$snapshot"
}

status_route() {
  [[ -f "$CONFIG" ]] || die "Caddy config does not exist: $CONFIG"
  if has_managed_route; then
    printf 'CommandCanvas hand-relay route: installed\n'
  else
    printf 'CommandCanvas hand-relay route: not installed\n'
  fi
  if [[ -f "$STATE_FILE" ]]; then
    printf 'State file: %s\n' "$STATE_FILE"
  fi
}

case "$ACTION" in
  validate)
    require_common_files
    build_candidate
    validate_file "$CANDIDATE"
    printf 'Candidate is valid; live config was not changed.\n'
    ;;
  install)
    require_common_files
    install_route
    ;;
  rollback)
    require_common_files
    rollback_route
    ;;
  status)
    status_route
    ;;
esac
