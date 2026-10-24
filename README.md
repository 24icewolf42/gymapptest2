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
  - gym dates you post;
  - your replies and check-ins at any gym date they can see (a friend's date you reply to is seen by the host's other friends too: by name if they are your friends as well, otherwise only as a number);
  - stats you choose to share: number of workouts, total kg × reps and training time (the database computes these from your synced history, so they update after every synced workout and show when you trained and for how long), your streak, and how many routines and exercises your plan has;
  - routines you choose to share;
  - your latest weigh-in, **only** if you turn on *Show my weight to friends*. They never see your weigh-in history.
- **Gym dates** are visible only to your friends, or only to the friends you pick. A date can be cancelled but not changed, so a reply always refers to the time and place it was given for. If someone is a friend of your friend but not yours, they appear only as a number ("+2"), never by name.
- **Ending things:** you can decline or cancel requests, remove friends and block people. A removed or blocked person immediately loses access, and their replies to your gym dates (and yours to theirs) are removed; a blocked person can't find you or send requests again. Username searches are limited to 30 an hour, and friend requests to 20 a day. A blocked person gets no error message: their requests just never arrive (they could still notice that nothing happens).
- **Age:** creating an account requires confirming you are 14 or older, or that a parent or guardian agreed. The app shows a short privacy notice (Settings → Privacy).
- **Deleting your account** (Settings → Delete account) removes your account, everything stored for it in the cloud, and its entries in the sign-in audit log.
- **Limits:** each account can store up to 1 MB of plan, 8 MB of workout history, 20,000 weigh-ins and 50 shared routines, and post 20 gym dates a day (30 upcoming at once), far more than real use.
- **Signing in** happens only through the app's own form (or the code in a reset email). A link with someone else's session is ignored. Workouts on the phone that belong to no account join the account you sign in to through the form; if they belong to another account, or the sign-in did not come from the form, the app names the account and asks first.
- **Shared phone:** when you sign out you can remove your data from the phone (only after it reached your account, unless you accept losing what didn't). If a different account signs in, the app asks before mixing anyone's workouts, and nothing syncs until that is answered.
- **Live updates** carry only gym-date changes your friendship allows you to see; who replied to a date is never broadcast.

All of this is enforced by row-level security in the database, not just by the app. `tests/integration/rls.test.js` checks it against a real database.

**Hosting limit:** the web app is served from `roguelineageaccmanager.github.io`, an
origin shared by every GitHub Pages site of that account. Any other page published
there can read the web app's stored data, including the sign-in token. Publish
nothing else under that account, or move the app to its own domain. The Android
app is not affected.

## Database setup

**New Supabase project:** paste `supabase/schema.sql` into the SQL Editor and run it.
Then put the project URL and the publishable key in `cloud-config.js`, and set the
Auth Site URL and redirect URL to the deployed web address.

**Existing project (the live app):** migrations are applied by GitHub Actions, not
by hand. `.github/workflows/supabase-deploy.yml` runs on every push to `main` that
changes `supabase/migrations/` or `supabase/templates/`, and can be started by hand
with *dry run* to see what it would do. It:

1. links the project and reads which migrations it has already recorded;
2. records the migrations that were applied by hand before this workflow existed
   (`supabase/applied-before-ci.txt`) and forgets the old name of the renamed one
   (`supabase/renamed-migrations.txt`), so nothing is applied twice;
3. applies the remaining migrations in order (`supabase db push`, via
   `tools/deploy-db.sh`);
4. sets the password-reset email (`supabase/templates/recovery.html`, which
   contains the code the Android app asks for) through the Management API.

One-time setup by the project owner: create a GitHub environment called
`production` (Settings → Environments), add required reviewers, limit it to the
`main` branch, and add these **to the environment**, not to the repository, so
only approved jobs can read them:

| Name | Kind | Value |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | secret | A personal access token (Supabase → Account → Access tokens) |
| `SUPABASE_DB_PASSWORD` | secret | The database password |
| `SUPABASE_PROJECT_REF` | variable | `aiiyombsmvlbhifxgkhp` |

The seven new migrations, applied in this order:

1. `20261024000000_friendships.sql` closes a security hole and adds unfriending and blocking:
   - It **fixes a hole that let anyone make themselves an accepted friend of any user** and read their data.
   - It adds decline, cancel, unfriend and block, and a limit of 20 requests a day.
   - It removes duplicate requests (where A asked B and B also asked A), keeping the accepted one.
2. `20261024000001_privacy.sql` adds the privacy rules described above.
   - Weight sharing starts **off** for everyone.
   - Friends see plan counts and stats only from people who share stats.
   - New accounts need the age confirmation, which the new app sends.
   - Older app versions can no longer look up usernames to add friends, create accounts, or read friends' weights directly, so release the new app together with this migration.
3. `20261024000002_gym_dates.sql` adds gym dates.
4. `20261024000003_policy_performance.sql` speeds up the original row-level security policies and removes table rights the app never uses.
5. `20261024000004_storage_limits.sql` limits how much one account can store (existing rows are not checked).
6. `20261024000005_plain_text.sql` keeps markup from other people away from the original app, which shows names unescaped: shared routines containing `< > " \`` are refused (existing ones are deleted; the owner's own routine stays), and a rest picture that is not image data is dropped. Your own routine and workout names stay exactly as typed, because both apps identify routines and workouts by name. This app also turns markup into look-alikes (such as ‹ ›) in routines it shares, and, when this phone's data may come from someone else (after a sign-out, a restored backup file, or data that belonged to no account or to another one), defuses tag-like markup ("<" before a letter) in every routine, exercise, workout and lift that is not exactly as the account already has it. Names like "Arms <3" and quotes stay, and what the account already has is left alone. Deletion records are never taken from a backup file.
7. `20261024000006_verify_access.sql` checks once, on the deploy that applies it, that the live database has no row-level security policies (by name), API-callable functions (by signature), API-readable views or live-update tables beyond those these migrations define, for example ones added in the dashboard. If it finds any it stops and lists them: drop them, or add them to the migration on purpose, then run the deploy again. Changes made in the dashboard later are not checked.

After the first deploy, check for friendships created through the hole. In
particular, look for `accepted` rows that nobody remembers accepting:

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
After changing any file the app loads, run `npm run sw-hash` so installed copies re-cache it. After a version bump, change `js/version.js`, `Version` and the `VERSION` in `sw.js`.
`tests/unit/project.test.js` fails if they disagree.

## Android signing

Earlier versions were signed with `android-signing/debug.keystore`, which was
committed to this public repository, so anyone could sign an app that Android
accepted as an update. That key is removed and treated as compromised.

Releases are now signed with a private key that exists only in GitHub secrets,
and the APK is no longer debuggable. The new key is introduced by **APK signature
key rotation**: the old key signs a statement that the new key replaces it, so
installed apps update without a reinstall, and on Android 9 and newer the old key
can no longer sign updates afterwards. In the rotation the old key keeps only
what an update needs: it loses rollback, shared user id and account
authentication. It keeps the permission capability, because the app declares a
signature permission (added by androidx) and Android refuses the update without
it (tested on Android 15). So an app signed with the public key could still be
granted that one permission, which guards only androidx's internal,
non-exported receivers.

Android 6 to 8 do not understand rotation: there the APK still carries the old
key's signature, so updates keep working, but so would a forged update signed
with the public key. That residual risk ends only when those phones are retired.

One-time setup by the repository owner:

1. Create a certificate for the backup on your own computer and keep the private
   key offline:
   `openssl req -x509 -newkey rsa:4096 -keyout backup-key.pem -out backup-cert.pem -days 3650 -subj /CN=Tracker-backup`
2. In the `production` environment (see Database setup) add:
   - secret `ADMIN_GH_TOKEN`: a fine-grained token for this repository with
     *Environments*, *Secrets* and *Variables* read/write, used once to store the key;
   - variable `KEYSTORE_BACKUP_CERT`: the contents of `backup-cert.pem`.
3. Run **Actions → Set up Android release signing (run once)**. It creates the
   key and the rotation proof (`tools/create-release-key.sh`), stores them as the
   `production` secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` and `ANDROID_SIGNING_LINEAGE_BASE64`
   and the repository variable `ANDROID_CERT_SHA256` (the public fingerprint), and
   uploads a backup encrypted to your certificate as a 1-day artifact. It refuses
   to run again unless *replace existing* is ticked.
4. Download the backup, then delete the artifact and `ADMIN_GH_TOKEN`. Decrypt it
   with `openssl cms -decrypt -binary -inform DER -in release-key-backup.p7m -inkey backup-key.pem -out backup.tgz`.
   Without the key no future update can be installed over the app.

Each release then runs in three jobs: an unprivileged job builds an unsigned APK
(every Gradle dependency checked against `tools/android/verification-metadata.xml`,
the Gradle download against its checksum); the signing job (`production`
environment) signs it with `tools/sign-apk.sh`; the publish job re-checks the
signer and uploads the `latest` release. Releases start only after the Tests
workflow passed on `main`.

## Credits

Inter typeface: see `fonts/LICENSE-Inter.txt`. The repository does not declare a
licence for the app code itself.
