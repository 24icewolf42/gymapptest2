#!/usr/bin/env bash
# Runs the iPhone (WebKit) tests. Where Playwright's WebKit can't run on the
# host (e.g. Fedora), they run in Playwright's container against the local
# Supabase stack, which must be running (`npx supabase start`). Results go to
# test-results-ios/, so this can run next to the web tests.
set -euo pipefail
cd "$(dirname "$0")/.."
if npx playwright test --project=ios --list >/dev/null 2>&1 && [ "${IOS_E2E_DOCKER:-0}" != "1" ] && node -e "require('playwright').webkit.launch().then(b=>b.close()).catch(()=>process.exit(1))" 2>/dev/null; then
  exec npx playwright test --project=ios --output test-results-ios "$@"
fi
VERSION="$(node -p "require('@playwright/test/package.json').version")"
STATUS="$(npx supabase status -o env 2>/dev/null)"
exec docker run --rm --security-opt label=disable --network host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e E2E_PORT="${E2E_PORT:-4176}" -e SUPABASE_STATUS_ENV="$STATUS" \
  -v "$PWD":/work -w /work "mcr.microsoft.com/playwright:v$VERSION-noble" \
  npx playwright test --project=ios --output test-results-ios "$@"
