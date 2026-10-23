#!/usr/bin/env bash
# Builds the APK against the local Supabase stack, boots an Android emulator,
# installs the app and runs tests/android with Playwright.
#   npx supabase start && npm run test:android
# ANDROID_E2E_SKIP_EMULATOR=1 uses an emulator/device that is already running (CI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
# Gradle for Capacitor 7 needs JDK 21.
if ! java -version 2>&1 | grep -q '"21'; then
  for j in "$HOME"/.local/jdk/jdk-21*; do [ -d "$j" ] && export JAVA_HOME="$j" && export PATH="$j/bin:$PATH"; done
fi

ANON_KEY="$(npx supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"/\1/p')"
[ -n "$ANON_KEY" ] || { echo "Local Supabase is not running. Start it with: npx supabase start" >&2; exit 1; }

# The emulator reaches the host's Supabase through `adb reverse`, so the app
# talks to http://localhost:54321 (localhost is allowed from the https app origin).
GYM_CLOUD_URL="http://localhost:54321" GYM_CLOUD_KEY="$ANON_KEY" bash tools/build-apk.sh

STARTED=""
if [ "${ANDROID_E2E_SKIP_EMULATOR:-0}" != "1" ]; then
  AVD="tracker-e2e"
  if ! avdmanager list avd -c | grep -qx "$AVD"; then
    echo no | avdmanager create avd -n "$AVD" -k "system-images;android-35;google_apis;x86_64" -d pixel_7 --force
  fi
  mkdir -p .android-e2e
  emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu "${ANDROID_E2E_GPU:-swangle_indirect}" > .android-e2e/emulator.log 2>&1 &
  STARTED=$!
  trap 'adb emu kill >/dev/null 2>&1 || kill $STARTED 2>/dev/null || true' EXIT
fi

adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb reverse tcp:54321 tcp:54321
adb install -r -t build-apk/rat-tracker.apk

npx playwright test --project=android "$@"
