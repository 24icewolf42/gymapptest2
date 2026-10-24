#!/usr/bin/env bash
# Builds the Android app (Capacitor wrapper around the web app).
#
# Default: a debug build (tests, local use) in build-apk/rat-tracker.apk, signed
# with this machine's own debug key; it never installs over the published app.
# ANDROID_UNSIGNED_RELEASE=1: a non-debuggable release build, left unsigned in
# build-apk/rat-tracker-unsigned.apk. Signing happens in a separate CI job
# (tools/sign-apk.sh) that never runs any of the build's third-party code.
#
# GYM_CLOUD_URL / GYM_CLOUD_KEY point a test build at another Supabase project.
# SKIP_GRADLE=1 stops after preparing the Android project.
set -euo pipefail

APP_NAME="Tracker"
APP_ID="com.roguelineage.rattracker"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build-apk"
RELEASE="${ANDROID_UNSIGNED_RELEASE:-0}"

cd "$ROOT"
rm -rf "$OUT" && mkdir -p "$OUT/www"
cp index.html Version manifest.json cloud-config.js rest.png snake-loading.gif icon-192.png icon-512.png icon-192-maskable.png icon-512-maskable.png "$OUT/www/"
cp -r css js vendor fonts "$OUT/www/"

# Test builds can point the app at another Supabase project (e.g. the local one).
# The page's Content-Security-Policy is widened to that address only.
if [ -n "${GYM_CLOUD_URL:-}" ]; then
  node - "$OUT/www" <<'NODE'
const fs = require('fs'), path = require('path');
const dir = process.argv[2], url = process.env.GYM_CLOUD_URL, key = process.env.GYM_CLOUD_KEY || '';
fs.writeFileSync(path.join(dir, 'cloud-config.js'), `window.GYM_CLOUD_CONFIG = ${JSON.stringify({ url, anonKey: key })};\n`);
const ws = url.replace(/^http/, 'ws');
const file = path.join(dir, 'index.html');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/connect-src 'self'/, `connect-src 'self' ${url} ${ws}`));
console.log('cloud-config.js ->', url);
NODE
fi

# Only the Android app checks GitHub for a newer APK, so only its page may connect there.
sed -i "s|connect-src 'self'|connect-src 'self' https://api.github.com|" "$OUT/www/index.html"

# Plain-http backends (the local test database) need cleartext; other builds never allow it.
CLEARTEXT=false
case "${GYM_CLOUD_URL:-}" in http://*) CLEARTEXT=true ;; esac
DEBUGGABLE=true
if [ "$RELEASE" = 1 ]; then DEBUGGABLE=false; CLEARTEXT=false; fi

cd "$OUT"
# Exact versions from a committed lockfile; install scripts are not needed.
cp "$ROOT/tools/android/package.json" "$ROOT/tools/android/package-lock.json" .
npm ci --no-audit --no-fund --ignore-scripts

cat > capacitor.config.json <<JSON
{
  "appId": "$APP_ID",
  "appName": "$APP_NAME",
  "webDir": "www",
  "backgroundColor": "#0d0e10",
  "android": { "backgroundColor": "#0d0e10", "adjustMarginsForEdgeToEdge": "auto", "webContentsDebuggingEnabled": $DEBUGGABLE },
  "server": { "androidScheme": "https", "cleartext": $CLEARTEXT }
}
JSON

npx cap add android
npx cap sync android

RES="android/app/src/main/res"

# --- Dark launch screen + window (no white flash) ---
cat > "$RES/values/styles.xml" <<'XML'
<?xml version="1.0" encoding="utf-8" ?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="android:windowBackground">#0d0e10</item>
        <item name="android:statusBarColor">#0d0e10</item>
        <item name="android:navigationBarColor">#0d0e10</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">#0d0e10</item>
        <item name="android:statusBarColor">#0d0e10</item>
        <item name="android:navigationBarColor">#0d0e10</item>
    </style>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">#0d0e10</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
        <item name="android:background">#0d0e10</item>
    </style>
</resources>
XML
cat > "$RES/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0d0e10</color>
</resources>
XML

# --- Launcher icons (pre-rendered from icon-512*.png, committed in tools/android/res) ---
cp -r "$ROOT/tools/android/res/." "$RES/"

# --- In-app updater: downloads the new APK from this repo's release and opens Android's installer ---
PKG_DIR="android/app/src/main/java/$(echo "$APP_ID" | tr . /)"
test -f "$PKG_DIR/MainActivity.java" || { echo "ERROR: MainActivity.java not found in $PKG_DIR" >&2; exit 1; }

cat > "$PKG_DIR/ApkUpdaterPlugin.java" <<'JAVA'
package com.roguelineage.rattracker;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
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
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    // Only ever download this app's own release asset; a prefix check would accept
    // "../" paths that GitHub normalizes into another repository's releases.
    private static final String ALLOWED_URL = "https://github.com/roguelineageaccmanager/gymapptest2/releases/download/latest/rat-tracker.apk";
    private static final long MIN_BYTES = 1_000_000L;
    private static final long MAX_BYTES = 200_000_000L;

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
                    String type = conn.getContentType() == null ? "" : conn.getContentType();
                    if (type.startsWith("text/")) throw new Exception("The download is not an app file");
                    long declared = conn.getContentLengthLong();
                    if (declared > MAX_BYTES) throw new Exception("The download is too large");

                    long total = 0;
                    InputStream in = conn.getInputStream();
                    FileOutputStream fos = new FileOutputStream(out);
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_BYTES) { fos.close(); in.close(); out.delete(); throw new Exception("The download is too large"); }
                        fos.write(buf, 0, n);
                    }
                    fos.close();
                    in.close();
                    conn.disconnect();
                    if (total < MIN_BYTES) throw new Exception("The download is incomplete");

                    // Android would refuse an update signed with another key anyway; checking
                    // first gives a clear message (e.g. after the release key changes).
                    if (!sameSigner(out)) {
                        out.delete();
                        call.reject("This update needs a one-time reinstall", "SIGNATURE_MISMATCH");
                        return;
                    }

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

    // Accepts the same signer, or a newer key that the installed key rotated to
    // (APK signature scheme v3 lineage).
    private boolean sameSigner(File apk) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        String self = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= 28) {
            PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNING_CERTIFICATES);
            PackageInfo installed = pm.getPackageInfo(self, PackageManager.GET_SIGNING_CERTIFICATES);
            if (downloaded == null || downloaded.signingInfo == null || !self.equals(downloaded.packageName)) return false;
            Set<String> current = signatureSet(installed.signingInfo.getApkContentsSigners());
            Set<String> next = signatureSet(downloaded.signingInfo.getApkContentsSigners());
            if (next.equals(current)) return true;
            if (downloaded.signingInfo.hasMultipleSigners()) return false;
            Set<String> history = signatureSet(downloaded.signingInfo.getSigningCertificateHistory());
            return history.containsAll(current);
        }
        PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNATURES);
        PackageInfo installed = pm.getPackageInfo(self, PackageManager.GET_SIGNATURES);
        if (downloaded == null || downloaded.signatures == null || !self.equals(downloaded.packageName)) return false;
        return signatureSet(downloaded.signatures).equals(signatureSet(installed.signatures));
    }

    private static Set<String> signatureSet(Signature[] signatures) {
        Set<String> out = new HashSet<>();
        if (signatures != null) for (Signature s : signatures) out.add(Arrays.toString(s.toByteArray()));
        return out;
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

# The installer intent needs this permission, and a file provider for the cache folder only.
MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q "REQUEST_INSTALL_PACKAGES" "$MANIFEST"; then
  sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#&\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />#' "$MANIFEST"
fi
grep -q "REQUEST_INSTALL_PACKAGES" "$MANIFEST" || { echo "ERROR: could not add REQUEST_INSTALL_PACKAGES to the manifest" >&2; exit 1; }
grep -q "fileprovider" "$MANIFEST" || { echo "ERROR: manifest has no fileprovider" >&2; exit 1; }
mkdir -p "$RES/xml"
cat > "$RES/xml/file_paths.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="updates" path="updates/" />
</paths>
XML

# --- No cloud or device-to-device backup: the WebView storage holds the session and health data ---
cat > "$RES/xml/data_extraction_rules.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup><exclude domain="root" /><exclude domain="file" /><exclude domain="database" /><exclude domain="sharedpref" /><exclude domain="external" /></cloud-backup>
    <device-transfer><exclude domain="root" /><exclude domain="file" /><exclude domain="database" /><exclude domain="sharedpref" /><exclude domain="external" /></device-transfer>
</data-extraction-rules>
XML
sed -i 's#android:allowBackup="true"#android:allowBackup="false" android:dataExtractionRules="@xml/data_extraction_rules"#' "$MANIFEST"
grep -q 'android:allowBackup="false"' "$MANIFEST" || { echo "ERROR: could not turn off backups in the manifest" >&2; exit 1; }

# --- Version numbers: versionCode goes up with every CI build ---
APP_VER="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version)" "$ROOT/Version")"
# Local builds use minutes since 2026 so `adb install -r` always works on test devices.
CODE="${GITHUB_RUN_NUMBER:-$(( ( $(date +%s) - 1767225600 ) / 60 ))}"
sed -i "s/versionCode [0-9]*/versionCode $CODE/; s/versionName \"[^\"]*\"/versionName \"$APP_VER\"/" android/app/build.gradle
grep -n "versionCode\|versionName" android/app/build.gradle

# Dependency checksums: Gradle refuses artifacts whose SHA-256 differs from the
# committed list, and the wrapper refuses a Gradle download with another checksum.
mkdir -p android/gradle
cp "$ROOT/tools/android/verification-metadata.xml" android/gradle/verification-metadata.xml
read -r DIST_NAME DIST_SHA < "$ROOT/tools/android/gradle-distribution.sha256"
WRAPPER=android/gradle/wrapper/gradle-wrapper.properties
grep -q "distributions/$DIST_NAME" "$WRAPPER" || { echo "ERROR: Gradle wrapper is not $DIST_NAME; update tools/android/gradle-distribution.sha256" >&2; exit 1; }
sed -i '/^distributionSha256Sum=/d' "$WRAPPER"
echo "distributionSha256Sum=$DIST_SHA" >> "$WRAPPER"

if [ "${SKIP_GRADLE:-0}" = "1" ]; then echo "SKIP_GRADLE set, stopping before the Android build"; exit 0; fi

cd android
chmod +x gradlew
if [ "$RELEASE" = 1 ]; then
  ./gradlew assembleRelease --no-daemon --console=plain
  cp app/build/outputs/apk/release/app-release-unsigned.apk "$OUT/rat-tracker-unsigned.apk"
  ls -la "$OUT/rat-tracker-unsigned.apk"
else
  ./gradlew assembleDebug --no-daemon --console=plain
  cp app/build/outputs/apk/debug/app-debug.apk "$OUT/rat-tracker.apk"
  ls -la "$OUT/rat-tracker.apk"
fi
