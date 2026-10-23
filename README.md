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
- **With an account,** your plan, workout history, last-used weights and weigh-ins sync to your account so you can use several devices. Only you can read them.
- **Friends** are people whose request you accepted. You find someone by their exact username, so the list of users can't be browsed. Friends can see:
  - your username;
  - gym dates you post, and your replies to their dates;
  - stats you choose to share (workout count and total kg × reps);
  - routines you choose to share;
  - a summary of your plan (number of routines and exercises);
  - your latest weigh-in, **only** if you turn on *Show my weight to friends*. They never see your weigh-in history.
- **Gym dates** are visible only to your friends, or only to the friends you pick. If someone is a friend of your friend but not yours, they appear only as a number ("+2"), never by name.
- **Ending things:** you can decline or cancel requests and remove friends. A removed friend immediately loses access.
- **Deleting your account** (Settings → Delete account) removes your account and everything stored for it in the cloud.
- **Shared phone:** when you sign out you can remove your data from the phone. If a different account signs in, the app asks before mixing anyone's workouts.

All of this is enforced by row-level security in the database, not just by the app. `tests/integration/rls.test.js` checks it against a real database.

## Database setup

**New Supabase project:** paste `supabase/schema.sql` into the SQL Editor and run it.
Then put the project URL and the publishable key in `cloud-config.js`, and set the
Auth Site URL and redirect URL to the deployed web address.

**Existing project (the live app):** run these, in order, in the SQL Editor. Each one is safe to run twice.

1. `supabase/migrations/20261024000000_friendships.sql` closes a security hole and lets people unfriend:
   - It **fixes a hole that let anyone make themselves an accepted friend of any user** and read their data.
   - It adds decline, cancel and unfriend.
   - It removes duplicate requests (where A asked B and B also asked A), keeping the accepted one.
2. `supabase/migrations/20261024000001_privacy.sql` adds the privacy rules described above.
   - Weight sharing starts **off** for everyone.
   - Older app versions can no longer look up usernames to add friends, so deploy the new app together with this migration.
3. `supabase/migrations/20261024000002_gym_dates.sql` adds gym dates.

After step 1, check for friendships created through the hole. In particular, look
for `accepted` rows that nobody remembers accepting:

```sql
select f.created_at, a.username as requester, b.username as target
from friend_requests f join profiles a on a.id = f.requester_id join profiles b on b.id = f.target_id
where f.status = 'accepted' order by f.created_at;
```

The app keeps working before the migrations are applied. Gym dates then show a
"database update needed" message instead.

## Development

```bash
npm ci                  # test tooling only
npm run serve           # http://127.0.0.1:4173
npm run lint
npm test                # unit tests (pure logic + project consistency)
npx supabase start      # local database in Docker
npm run test:db         # row-level security tests against the local database
npm run test:e2e        # browser tests (Pixel 7 viewport) against the local database
npm run test:android    # builds the APK, boots an Android emulator, runs tests/android
```

`npm run test:android` needs the Android SDK (`platform-tools`, `emulator`,
`system-images;android-35;google_apis;x86_64`) and JDK 21. It builds the APK
pointed at the local database, installs it on a headless emulator and drives the
real app through its WebView with Playwright.

After adding a migration, run `npm run schema` to regenerate `supabase/schema.sql`.
After a version bump, change `js/version.js`, `Version` and the `VERSION` in `sw.js`.
`tests/unit/project.test.js` fails if they disagree.

## Android signing

The APK is signed with `android-signing/debug.keystore`, which is in this public
repository. Anyone can therefore sign an app that Android accepts as an update.

The fix is to generate a private release key, store it as a GitHub Actions secret
and sign release builds with it. Every user then has to uninstall and reinstall
once: back up first under Settings → Backup. This is listed in `docs/REVIEW.md`,
finding H5.

## Credits

Inter typeface: see `fonts/LICENSE-Inter.txt`. The repository does not declare a
licence for the app code itself.
