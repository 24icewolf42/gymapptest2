#!/usr/bin/env bash
# Builds an installable Android APK from the web app in this repo (Capacitor wrapper).
# Runs on GitHub Actions (see .github/workflows/build-apk.yml). Set SKIP_GRADLE=1 to only prepare the project.
set -euo pipefail

APP_NAME="Tracker"
APP_ID="com.roguelineage.rattracker"
ROOT="$(pwd)"
OUT="$ROOT/build-apk"

rm -rf "$OUT" && mkdir -p "$OUT/www"
cp index.html plan.js cloud.js cloud-config.js manifest.json Version rest.png snake-loading.gif icon-192.png icon-512.png icon-192-maskable.png icon-512-maskable.png "$OUT/www/"
cp -r fonts "$OUT/www/fonts"

cd "$OUT"
cat > package.json <<'JSON'
{ "name": "rat-tracker-apk", "version": "1.0.0", "private": true }
JSON
npm install --no-audit --no-fund @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7 @capacitor/app@7

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

# --- In-app updater: downloads the new APK from this repo's release and opens Android's installer ---
PKG_DIR="android/app/src/main/java/$(echo "$APP_ID" | tr . /)"
test -f "$PKG_DIR/MainActivity.java" || { echo "ERROR: MainActivity.java not found in $PKG_DIR" >&2; exit 1; }

cat > "$PKG_DIR/ApkUpdaterPlugin.java" <<'JAVA'
package com.roguelineage.rattracker;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    // Only ever download this app's own release asset; a prefix check would accept
    // "../" paths that GitHub normalizes into another repository's releases.
    private static final String ALLOWED_URL = "https://github.com/roguelineageaccmanager/gymapptest2/releases/download/latest/rat-tracker.apk";

    @PluginMethod
    public void install(final PluginCall call) {
        final String url = call.getString("url");
        if (!ALLOWED_URL.equals(url)) {
            call.reject("Update URL not allowed");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    File dir = new File(getContext().getCacheDir(), "updates");
                    if (!dir.exists()) dir.mkdirs();
                    File out = new File(dir, "rat-tracker.apk");
                    if (out.exists()) out.delete();

                    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("User-Agent", "RatTracker-Updater");
                    int code = conn.getResponseCode();
                    if (code != 200) throw new Exception("Download failed (HTTP " + code + ")");

                    InputStream in = conn.getInputStream();
                    FileOutputStream fos = new FileOutputStream(out);
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
                    fos.close();
                    in.close();
                    conn.disconnect();

                    if (out.length() < 1000000) throw new Exception("Downloaded file is too small to be the app");

                    Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage() == null ? "Update failed" : e.getMessage());
                }
            }
        }).start();
    }
}
JAVA

cat > "$PKG_DIR/MainActivity.java" <<'JAVA'
package com.roguelineage.rattracker;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }
}
JAVA

# the installer intent needs this permission, and a file provider path that covers the cache folder
MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q "REQUEST_INSTALL_PACKAGES" "$MANIFEST"; then
  sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#&\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />#' "$MANIFEST"
fi
grep -q "REQUEST_INSTALL_PACKAGES" "$MANIFEST" || { echo "ERROR: could not add REQUEST_INSTALL_PACKAGES to the manifest" >&2; exit 1; }
grep -q "fileprovider" "$MANIFEST" || { echo "ERROR: manifest has no fileprovider" >&2; exit 1; }
mkdir -p android/app/src/main/res/xml
cat > android/app/src/main/res/xml/file_paths.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
</paths>
XML

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
