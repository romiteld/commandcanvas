#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OPS_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
MANAGER="$OPS_DIR/manage-caddy-route.sh"
SNIPPET="$OPS_DIR/caddy/hand-relay.Caddyfile"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_file_equals() {
  local expected="$1"
  local actual="$2"

  cmp --silent "$expected" "$actual" || fail "$actual does not match $expected"
}

assert_contains() {
  local needle="$1"
  local file="$2"

  grep -F --quiet -- "$needle" "$file" || fail "$file does not contain: $needle"
}

assert_not_contains() {
  local needle="$1"
  local file="$2"

  if grep -F --quiet -- "$needle" "$file"; then
    fail "$file unexpectedly contains: $needle"
  fi
}

make_fake_caddy() {
  local destination="$1"

  cp "$SCRIPT_DIR/fixtures/fake-caddy.sh" "$destination"
  chmod 0755 "$destination"
}

run_manager() {
  local action="$1"
  shift

  "$MANAGER" "$action" \
    --config "$TEST_ROOT/Caddyfile" \
    --snippet "$SNIPPET" \
    --caddy "$TEST_ROOT/fake-caddy" \
    --backup-dir "$TEST_ROOT/backups" \
    --access-log "$TEST_ROOT/logs/hand-relay-access.log" \
    "$@"
}

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

make_fake_caddy "$TEST_ROOT/fake-caddy"
export FAKE_CADDY_LOG="$TEST_ROOT/caddy-calls.log"

# Use a fixture without a final newline. Installation must retain every original
# byte as the candidate prefix, not reformat the existing matte virtual host.
printf '%s' 'matte.autolensai.com { reverse_proxy 127.0.0.1:8099 }' > "$TEST_ROOT/Caddyfile"
cp "$TEST_ROOT/Caddyfile" "$TEST_ROOT/original"

run_manager validate
assert_file_equals "$TEST_ROOT/original" "$TEST_ROOT/Caddyfile"
assert_contains 'validate --config' "$FAKE_CADDY_LOG"
assert_not_contains 'reload --config' "$FAKE_CADDY_LOG"

: > "$FAKE_CADDY_LOG"
run_manager install
assert_contains '# BEGIN COMMANDCANVAS HAND RELAY' "$TEST_ROOT/Caddyfile"
assert_contains 'hands.autolensai.com {' "$TEST_ROOT/Caddyfile"
assert_contains 'reload --config' "$FAKE_CADDY_LOG"
assert_contains 'installed' "$TEST_ROOT/backups/state"

# Once the managed route is installed, validation must check the installed
# Caddyfile in place without rebuilding the route or reloading Caddy.
cp "$TEST_ROOT/Caddyfile" "$TEST_ROOT/installed"
: > "$FAKE_CADDY_LOG"
run_manager validate
assert_file_equals "$TEST_ROOT/installed" "$TEST_ROOT/Caddyfile"
assert_contains "validate --config $TEST_ROOT/Caddyfile --adapter caddyfile" "$FAKE_CADDY_LOG"
assert_not_contains 'reload --config' "$FAKE_CADDY_LOG"

original_bytes="$(wc -c < "$TEST_ROOT/original" | tr -d ' ')"
head -c "$original_bytes" "$TEST_ROOT/Caddyfile" > "$TEST_ROOT/installed-prefix"
assert_file_equals "$TEST_ROOT/original" "$TEST_ROOT/installed-prefix"

if run_manager install > "$TEST_ROOT/second-install.out" 2>&1; then
  fail 'a second install unexpectedly succeeded'
fi
assert_contains 'already installed' "$TEST_ROOT/second-install.out"

run_manager status > "$TEST_ROOT/status.out"
assert_contains 'installed' "$TEST_ROOT/status.out"

: > "$FAKE_CADDY_LOG"
run_manager rollback
assert_file_equals "$TEST_ROOT/original" "$TEST_ROOT/Caddyfile"
assert_contains 'reload --config' "$FAKE_CADDY_LOG"
assert_contains 'not-installed' "$TEST_ROOT/backups/state"

run_manager status > "$TEST_ROOT/status.out"
assert_contains 'not installed' "$TEST_ROOT/status.out"

# A failed reload must restore the exact pre-install config and try to reload it.
rm -rf -- "$TEST_ROOT/backups"
: > "$FAKE_CADDY_LOG"
export FAKE_CADDY_FAIL_NEXT_RELOAD=1
if run_manager install > "$TEST_ROOT/failed-install.out" 2>&1; then
  fail 'install unexpectedly succeeded when the first reload failed'
fi
unset FAKE_CADDY_FAIL_NEXT_RELOAD
assert_file_equals "$TEST_ROOT/original" "$TEST_ROOT/Caddyfile"
reload_count="$(grep -F -c -- 'reload --config' "$FAKE_CADDY_LOG")"
[[ "$reload_count" == '2' ]] || fail "expected two reload attempts, got $reload_count"
assert_contains 'restored the pre-install snapshot' "$TEST_ROOT/failed-install.out"

printf 'PASS: Caddy route install, byte preservation, rollback, and reload recovery\n'
