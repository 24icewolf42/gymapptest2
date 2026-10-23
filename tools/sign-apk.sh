#!/usr/bin/env bash
# Signs an unsigned release APK in a job that runs no third-party build code.
#   tools/sign-apk.sh <unsigned.apk> <signed.apk>
# Env: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,
#      ANDROID_KEY_PASSWORD, ANDROID_SIGNING_LINEAGE_BASE64, ANDROID_CERT_SHA256,
#      LEGACY_KEYSTORE (path to the old, public debug keystore).
#
# The old app was signed with a debug key that was public in this repository.
# Android 9+ follows a signed key rotation (APK signature v3 lineage) from that
# key to the private release key, so installed apps update without a reinstall,
# and the old key loses the right to sign further updates on those phones.
# Android 6-8 cannot rotate; there the app asks for a one-time reinstall.
set -euo pipefail
in="$1"; out="$2"
APKSIGNER="${APKSIGNER:-$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
umask 077
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$work/release.keystore"
printf '%s' "$ANDROID_SIGNING_LINEAGE_BASE64" | base64 -d > "$work/lineage.bin"
"$APKSIGNER" sign \
  --ks "$LEGACY_KEYSTORE" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --next-signer --ks "$work/release.keystore" --ks-key-alias "$ANDROID_KEY_ALIAS" --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD \
  --lineage "$work/lineage.bin" --rotation-min-sdk-version 28 \
  --out "$out" "$in"
"$APKSIGNER" verify --verbose --print-certs "$out" > "$work/verify.txt"
want="$(printf '%s' "$ANDROID_CERT_SHA256" | tr -d ' :' | tr 'A-F' 'a-f')"
grep -q "Verified using v3 scheme (APK Signature Scheme v3): true" "$work/verify.txt" || { echo "ERROR: v3 signature missing" >&2; exit 1; }
grep -i 'certificate SHA-256 digest' "$work/verify.txt" | tr -d ' :' | grep -qi "$want" || { echo "ERROR: APK is not signed with the release key" >&2; exit 1; }
sha256sum "$out" | cut -d' ' -f1 > "$out.sha256"
echo "Signed $(basename "$out") ($(cat "$out.sha256"))"
