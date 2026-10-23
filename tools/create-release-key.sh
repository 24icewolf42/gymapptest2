#!/usr/bin/env bash
# Creates the Android release key and the signed rotation from the old, public
# debug key (LEGACY_KEYSTORE) to it, and stores both as GitHub secrets via `gh`
# (GH_TOKEN/GH_REPO from the environment). Writes an encrypted backup to $1.
# Used by .github/workflows/android-signing-setup.yml; never run it on a laptop.
set -euo pipefail
out="${1:?usage: create-release-key.sh <backup-file>}"
: "${BACKUP_PASSPHRASE:?}"
: "${LEGACY_KEYSTORE:?}"
APKSIGNER="${APKSIGNER:-$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)}"
GH="${GH:-gh}"
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
pass="$(openssl rand -base64 36 | tr -d '\n=+/')"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$pass"
keytool -genkeypair -noprompt -keystore release.keystore -storetype PKCS12 -alias tracker \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Tracker, O=Tracker" \
  -storepass "$pass" -keypass "$pass" 2>/dev/null
sha="$(keytool -list -v -keystore release.keystore -storepass "$pass" | grep -m1 'SHA256:' | sed 's/.*SHA256: *//')"
# Rotation proof: the old key vouches for the new one; the old key may not roll back.
"$APKSIGNER" rotate --out lineage.bin \
  --old-signer --ks "$LEGACY_KEYSTORE" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --set-rollback false \
  --new-signer --ks release.keystore --ks-key-alias tracker --ks-pass "pass:$pass" --key-pass "pass:$pass"
base64 -w0 release.keystore | $GH secret set ANDROID_KEYSTORE_BASE64
base64 -w0 lineage.bin | $GH secret set ANDROID_SIGNING_LINEAGE_BASE64
printf '%s' "$pass" | $GH secret set ANDROID_KEYSTORE_PASSWORD
printf '%s' "$pass" | $GH secret set ANDROID_KEY_PASSWORD
printf '%s' "tracker" | $GH secret set ANDROID_KEY_ALIAS
$GH variable set ANDROID_CERT_SHA256 --body "$sha"
echo "Release certificate SHA-256: $sha"

# Encrypted backup for the owner (secrets cannot be read back from GitHub).
printf 'alias=tracker\npassword=%s\nsha256=%s\n' "$pass" "$sha" > key-info.txt
tar -czf backup.tgz release.keystore lineage.bin key-info.txt
printf '%s' "$BACKUP_PASSPHRASE" | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass stdin -in backup.tgz -out "$out"
