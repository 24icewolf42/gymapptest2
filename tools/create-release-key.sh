#!/usr/bin/env bash
# Creates the Android release key and the signed rotation from the old, public
# debug key (LEGACY_KEYSTORE) to it, and stores both as GitHub secrets via `gh`
# (GH_TOKEN/GH_REPO from the environment) in the "production" environment.
# Writes a backup to $1, encrypted to the owner's certificate (BACKUP_CERT, PEM),
# so only the holder of the matching private key can open it.
# Used by .github/workflows/android-signing-setup.yml; never run it on a laptop.
set -euo pipefail
out="${1:?usage: create-release-key.sh <backup-file>}"
: "${BACKUP_CERT:?}"
: "${LEGACY_KEYSTORE:?}"
APKSIGNER="${APKSIGNER:-$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)}"
GH="${GH:-gh}"
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
pass="$(openssl rand -base64 36 | tr -d '\n=+/')"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$pass"
# An EC (P-256) key, not RSA; the keystore and the key are protected by a
# random password that exists only in the environment secrets and the backup.
keytool -genkeypair -noprompt -keystore release.keystore -storetype PKCS12 -alias tracker \
  -keyalg EC -groupname secp256r1 -sigalg SHA256withECDSA -validity 10000 -dname "CN=Tracker, O=Tracker" \
  -storepass "$pass" -keypass "$pass" 2>/dev/null
keytool -list -v -keystore release.keystore -storepass "$pass" | grep -q 'Signature algorithm name: SHA256withECDSA' || { echo "ERROR: the release key is not EC" >&2; exit 1; }
sha="$(keytool -list -v -keystore release.keystore -storepass "$pass" | grep -m1 'SHA256:' | sed 's/.*SHA256: *//')"
# Rotation proof: the old key vouches for the new one. The old key is public, so
# it keeps only what an update needs and loses rollback, shared user id and
# account authentication. It must keep the permission capability: the app
# declares a signature permission (from androidx), and without it Android
# refuses the update with INSTALL_FAILED_DUPLICATE_PERMISSION (tested on API 35).
"$APKSIGNER" rotate --out lineage.bin \
  --old-signer --ks "$LEGACY_KEYSTORE" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --set-installed-data true --set-permission true --set-rollback false --set-shared-uid false --set-auth false \
  --new-signer --ks release.keystore --ks-key-alias tracker --ks-pass "pass:$pass" --key-pass "pass:$pass"
# Environment secrets: only jobs that run in "production" (with its approval
# and branch rules) can read them. The fingerprint is public.
base64 -w0 release.keystore | $GH secret set --env production ANDROID_KEYSTORE_BASE64
base64 -w0 lineage.bin | $GH secret set --env production ANDROID_SIGNING_LINEAGE_BASE64
printf '%s' "$pass" | $GH secret set --env production ANDROID_KEYSTORE_PASSWORD
printf '%s' "$pass" | $GH secret set --env production ANDROID_KEY_PASSWORD
printf '%s' "tracker" | $GH secret set --env production ANDROID_KEY_ALIAS
$GH variable set ANDROID_CERT_SHA256 --body "$sha"
echo "Release certificate SHA-256: $sha"

# Backup for the owner (secrets cannot be read back from GitHub), encrypted to
# their EC certificate; opening it needs the owner's password-protected private key.
printf '%s\n' "$BACKUP_CERT" > owner.pem
openssl x509 -in owner.pem -noout -text | grep -q 'id-ecPublicKey' || { echo "ERROR: the backup certificate must be EC (not RSA)" >&2; exit 1; }
printf 'alias=tracker\npassword=%s\nsha256=%s\n' "$pass" "$sha" > key-info.txt
tar -czf backup.tgz release.keystore lineage.bin key-info.txt
openssl cms -encrypt -binary -aes256 -outform DER -in backup.tgz -out "$out" owner.pem
