#!/usr/bin/env bash

set -euo pipefail

[[ -n "${FAKE_CADDY_LOG:-}" ]] || {
  printf 'FAKE_CADDY_LOG is required\n' >&2
  exit 2
}

printf '%s\n' "$*" >> "$FAKE_CADDY_LOG"

case "${1:-}" in
  validate)
    exit 0
    ;;
  reload)
    if [[ "${FAKE_CADDY_FAIL_NEXT_RELOAD:-0}" == '1' ]]; then
      marker="${FAKE_CADDY_LOG}.reload-failed"
      if [[ ! -e "$marker" ]]; then
        : > "$marker"
        exit 1
      fi
    fi
    exit 0
    ;;
  *)
    printf 'unexpected fake caddy command: %s\n' "${1:-<empty>}" >&2
    exit 2
    ;;
esac
