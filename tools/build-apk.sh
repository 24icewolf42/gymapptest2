#!/usr/bin/env bash
# Builds an installable Android APK from the web app in this repo (Capacitor wrapper).
# Runs on GitHub Actions (see .github/workflows/build-apk.yml). Set SKIP_GRADLE=1 to only prepare the project.
set -euo pipefail

APP_NAME="Rat Tracker"
APP_ID="com.roguelineage.rattracker"
ROOT="$(pwd)"
OUT="$ROOT/build-apk"

rm -rf "$OUT" && mkdir -p "$OUT/www"
cp index.html manifest.json Version rest.png snake-loading.gif icon-192.png icon-512.png icon-192-maskable.png icon-512-maskable.png "$OUT/www/"

cd "$OUT"
cat > package.json <<'JSON'
{ "name": "rat-tracker-apk", "version": "1.0.0", "private": true }
JSON
npm install --no-audit --no-fund @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7

cat > capacitor.config.json <<JSON
{
  "appId": "$APP_ID",
  "appName": "$APP_NAME",
  "webDir": "www",
  "backgroundColor": "#000000",
  "android": { "backgroundColor": "#000000", "adjustMarginsForEdgeToEdge": "auto" },
  "server": { "androidScheme": "https" }
}
JSON

npx cap add android
npx cap sync android

RES="android/app/src/main/res"

# --- Black launch screen + black window (no white flash) ---
cat > "$RES/values/styles.xml" <<'XML'
<?xml version="1.0" encoding="utf-8" ?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="android:windowBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
    </style>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">#000000</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
        <item name="android:background">#000000</item>
    </style>
</resources>
XML
cat > "$RES/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#000000</color>
</resources>
XML

# --- Launcher icons from the app's own icons ---
python3 -m venv .venv
.venv/bin/pip install --quiet pillow
.venv/bin/python - <<'PY'
from PIL import Image
import os
res = "android/app/src/main/res"
legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
fore = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
icon = Image.open("www/icon-512.png").convert("RGBA")
mask_icon = Image.open("www/icon-512-maskable.png").convert("RGBA")
for d in legacy:
    folder = os.path.join(res, "mipmap-" + d)
    os.makedirs(folder, exist_ok=True)
    icon.resize((legacy[d], legacy[d]), Image.LANCZOS).save(os.path.join(folder, "ic_launcher.png"))
    icon.resize((legacy[d], legacy[d]), Image.LANCZOS).save(os.path.join(folder, "ic_launcher_round.png"))
    mask_icon.resize((fore[d], fore[d]), Image.LANCZOS).save(os.path.join(folder, "ic_launcher_foreground.png"))
print("icons written")
PY

# --- Stable signing key so new builds install over the old app (keeps your data) ---
# Gradle's default debug key lives in ~/.android and gets regenerated if it isn't picked up,
# so point the debug signing config at the key stored in this repo explicitly.
KEYSTORE="$ROOT/android-signing/debug.keystore"
mkdir -p "$HOME/.android"
cp "$KEYSTORE" "$HOME/.android/debug.keystore"
python3 - "$KEYSTORE" <<'PY'
import re, sys
path = "android/app/build.gradle"
src = open(path).read()
block = '''android {
    signingConfigs {
        debug {
            storeFile file("%s")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
''' % sys.argv[1]
new, n = re.subn(r"^android \{\n", lambda m: block, src, count=1, flags=re.M)
assert n == 1, "could not find the android { block in build.gradle"
open(path, "w").write(new)
print("debug signing config now points at", sys.argv[1])
PY

# --- Version numbers: versionCode goes up with every build ---
APP_VER="$(grep -o 'APP_VERSION = "[^"]*"' "$ROOT/index.html" | head -1 | sed 's/.*"\(.*\)"/\1/')"
CODE="${GITHUB_RUN_NUMBER:-1}"
sed -i "s/versionCode [0-9]*/versionCode $CODE/; s/versionName \"[^\"]*\"/versionName \"$APP_VER\"/" android/app/build.gradle
grep -n "versionCode\|versionName" android/app/build.gradle

if [ "${SKIP_GRADLE:-0}" = "1" ]; then echo "SKIP_GRADLE set, stopping before the Android build"; exit 0; fi

cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon --console=plain
cp app/build/outputs/apk/debug/app-debug.apk "$OUT/rat-tracker.apk"
ls -la "$OUT/rat-tracker.apk"

# --- Safety check: never publish an APK signed with anything but the repo key ---
# (a different key would make the next update refuse to install over the old app)
want="$(keytool -list -v -keystore "$KEYSTORE" -storepass android 2>/dev/null | grep -m1 'SHA256:' | tr -d ' ')"
have="$(keytool -printcert -jarfile "$OUT/rat-tracker.apk" 2>/dev/null | grep -m1 'SHA256:' | tr -d ' ')"
echo "repo key : $want"
echo "apk key  : $have"
if [ -z "$want" ] || [ "$want" != "$have" ]; then
  echo "ERROR: APK is not signed with android-signing/debug.keystore" >&2
  exit 1
fi
echo "signing key check passed"
