# Tracker

A gym tracker that works offline on your phone, plus friends, a leaderboard and
**gym dates**: post when you're heading to the gym (now, in 30 minutes, or any
time in the next 60 days), and friends can say they're coming and check in once
they're there.

- Web app: https://roguelineageaccmanager.github.io/gymapptest2/
- Android app: built by GitHub Actions and published as the `latest` release

## What's where

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | The page shell and its one stylesheet |
| `js/main.js` | Start-up: loads data and wires up every page |
| `js/core/` | Helpers: safe HTML rendering, storage, dates, tabs and the back button |
| `js/domain/` | Pure logic with no UI: plans, logs, merging, gym dates, backup. This is the unit-tested part. |
| `js/ui/` | One file per screen: today, plan, calendar, stats, crew (friends and gym dates), settings, workout |
| `js/cloud/` | Supabase: account, sync, friends, gym dates |
| `vendor/supabase.js` | Pinned supabase-js, copied in by `npm run vendor`, so no code is loaded from a CDN |
| `sw.js` | Offline support for the web version |
| `supabase/migrations/` | Database changes, in order. `supabase/schema.sql` is generated from them. |
| `tools/build-apk.sh` | Wraps the web app as an Android app (Capacitor) |

The app has **no build step**. Edit a file, reload, done. npm is only needed for tests.

## Data and privacy

- **Without an account,** everything stays on the phone: workouts, plan, weigh-ins and settings.
- **With an account,** your plan, workout history (with each set, date and duration), last-used weights, bypass days and weigh-ins sync to your account so you can use several devices. Only you can read them. Deletions sync too. The format is shared with the previous app version, so old and new versions can be used on the same account.
- **Friends** are people whose request you accepted. You find someone by their exact username, so the list of users can't be browsed. Friends can see:
  - your username;
  - gym dates you post, and your replies to their dates;
  - stats you choose to share: number of workouts, total kg × reps and training time (the database computes these from your synced history), your streak, and how many routines and exercises your plan has;
  - routines you choose to share;
  - your latest weigh-in, **only** if you turn on *Show my weight to friends*. They never see your weigh-in history.
- **Gym dates** are visible only to your friends, or only to the friends you pick. If someone is a friend of your friend but not yours, they appear only as a number ("+2"), never by name.
- **Ending things:** you can decline or cancel requests, remove friends and block people. A removed or blocked person immediately loses access; a blocked person can't find you or send requests again. Username searches are limited to 30 an hour, and friend requests to 20 a day.
- **Age:** creating an account requires confirming you are 14 or older, or that a parent or guardian agreed. The app shows a short privacy notice (Settings → Privacy).
- **Deleting your account** (Settings → Delete account) removes your account and everything stored for it in the cloud.
- **Shared phone:** when you sign out you can remove your data from the phone (only after it reached your account, unless you accept losing what didn't). If a different account signs in, the app asks before mixing anyone's workouts, and nothing syncs until that is answered.
- **Live updates** carry only gym-date changes your friendship allows you to see; who replied to a date is never broadcast.

All of this is enforced by row-level security in the database, not just by the app. `tests/integration/rls.test.js` checks it against a real database.

## Database setup

**New Supabase project:** paste `supabase/schema.sql` into the SQL Editor and run it.
Then put the project URL and the publishable key in `cloud-config.js`, and set the
Auth Site URL and redirect URL to the deployed web address.

**Existing project (the live app):** the workout-sync migrations
`20261023000003_complete_workout_sync.sql` (formerly `20261023_complete_workout_sync.sql`, renamed
so it sorts after the table it alters) and `20261023190000_daily_workout_summaries.sql` are
already live. Then run these, in order, in the SQL Editor. Each one is safe to run twice.

1. `supabase/migrations/20261024000000_friendships.sql` closes a security hole and adds unfriending and blocking:
   - It **fixes a hole that let anyone make themselves an accepted friend of any user** and read their data.
   - It adds decline, cancel, unfriend and block, and a limit of 20 requests a day.
   - It removes duplicate requests (where A asked B and B also asked A), keeping the accepted one.
2. `supabase/migrations/20261024000001_privacy.sql` adds the privacy rules described above.
   - Weight sharing starts **off** for everyone.
   - Friends see plan counts and stats only from people who share stats.
   - Older app versions can no longer look up usernames to add friends, and can no longer read friends' weights directly, so deploy the new app together with this migration.
3. `supabase/migrations/20261024000002_gym_dates.sql` adds gym dates.
4. `supabase/migrations/20261024000003_policy_performance.sql` speeds up the original row-level security policies (no behaviour change).

**Password reset inside the Android app:** the reset email's link opens the web
app. To let people reset inside the app too, add the code to the email template
(Supabase → Authentication → Email Templates → Reset Password), for example
`<p>Your code: {{ .Token }}</p>`. The app then asks for that code.

After step 1, check for friendships created through the hole. In particular, look
for `accepted` rows that nobody remembers accepting:

```sql
select f.created_at, a.username as requester, b.username as target
from friend_requests f join profiles a on a.id = f.requester_id join profiles b on b.id = f.target_id
where f.status = 'accepted' order by f.created_at;
```

The app keeps working before the migrations are applied. Gym dates then show
"Gym dates are not available yet" instead.

## Development

```bash
npm ci                          # test tooling only
npx playwright install chromium # browser for the end-to-end tests (once)
npm run serve                   # http://127.0.0.1:4173 (uses cloud-config.js, i.e. the live project)
npm run lint
npm test                        # unit tests (pure logic + project consistency)
npx supabase start              # local database in Docker
npm run test:db                 # row-level security tests against the local database
npm run test:e2e                # browser tests (Pixel 7 viewport) against the local database
npm run test:android            # builds the APK, boots an Android emulator, runs tests/android
```

The browser and Android tests refuse to run unless the local database is up, so
they can never create test accounts on the live project.

`npm run test:android` needs the Android SDK (`platform-tools`, `emulator`,
`system-images;android-35;google_apis;x86_64`) and JDK 21. It builds the APK
pointed at the local database, installs it on a headless emulator and drives the
real app through its WebView with Playwright.

After adding a migration, run `npm run schema` to regenerate `supabase/schema.sql`.
After a version bump, change `js/version.js`, `Version` and the `VERSION` in `sw.js`.
`tests/unit/project.test.js` fails if they disagree.

## Android signing

Earlier versions were signed with `android-signing/debug.keystore`, which was
committed to this public repository, so anyone could sign an app that Android
accepted as an update. That key is removed and must be treated as compromised.

Releases are now signed with a private key that lives only in GitHub secrets, and
the APK is no longer debuggable. One-time setup by the repository owner:

```bash
keytool -genkeypair -v -keystore release.keystore -alias tracker -keyalg RSA -keysize 4096 -validity 10000
keytool -list -v -keystore release.keystore | grep SHA256   # the certificate fingerprint
base64 -w0 release.keystore                                  # value for ANDROID_KEYSTORE_BASE64
```

Add the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, and the repository variable
`ANDROID_CERT_SHA256` (the fingerprint). Keep an offline copy of the keystore:
without it, no future update can be installed over the app.

Because the key changes, every user reinstalls once. The old app's updater can't
install the new APK; the new app explains the steps if it meets such a mismatch.
Users should back up first (Settings → Backup) or sign in so their data is in
their account. The build also checks every Gradle dependency against
`tools/android/verification-metadata.xml`, and the publish job re-verifies the
APK's checksum and signer before releasing it.

## Credits

Inter typeface: see `fonts/LICENSE-Inter.txt`. The repository does not declare a
licence for the app code itself.
