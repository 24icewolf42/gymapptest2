# Handover

What changed, and the steps to take it over. Everything is in pull request
https://github.com/roguelineageaccmanager/gymapptest2/pull/2 (from the
`modernize` branch of https://github.com/24icewolf42/gymapptest2). Your
Supabase project, your app id and your `cloud-config.js` are unchanged.

## What you get

- **Gym dates:** plan a gym session (also "now" or "in 30 min"), friends reply
  Going / Maybe / Can't and check in when they are there.
- **Friends:** decline, cancel, unfriend and block; who sees what is
  explained in Settings → Privacy.
- **Security fixes:** anyone could make themselves your friend and read your
  data (fixed in the database), shared routines could run code in the app,
  and the Android signing key was public.
- **New look:** dark theme, bottom tabs, swipe between tabs, sheets instead of
  browser pop-ups, works with a keyboard and a screen reader.
- **Your v2.12.x changes are kept:** drag to reorder exercises (by the grip
  on the left; the arrows still work), auto-scroll while dragging, and no tab
  swipe from rows that scroll sideways.
- **Tests:** every push runs about 250 automated tests (logic, database
  rules, the app in a browser).
- The code is split into small files under `js/` instead of one big
  `index.html`. `docs/REVIEW.md` lists every problem found and how it was fixed.

## Steps (about 30 minutes)

Steps 1 and 2 come **before** the merge, the rest right after it.

### 1. Create the `production` environment

In your repo: **Settings → Environments → New environment** → name it
`production`.

- Tick **Required reviewers** and add yourself.
- Under **Deployment branches**, allow only `main`.
- Add these to the environment (not to the repository):

| Name | Kind | Where to get it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Secret | supabase.com → Account → Access Tokens → Generate |
| `SUPABASE_DB_PASSWORD` | Secret | Your database password (Supabase → Project Settings → Database; reset it there if you forgot it) |
| `SUPABASE_PROJECT_REF` | Variable | `aiiyombsmvlbhifxgkhp` |

### 2. Prepare the Android key backup

1. On your computer, **outside the repo folder**, make a backup certificate.
   It asks for a pass phrase: choose a strong one and write it down
   somewhere other than the key. Keep `backup-key.pem` safe and offline (for
   example on a USB stick):

   ```bash
   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout backup-key.pem -out backup-cert.pem -days 3650 -subj /CN=Tracker-backup
   ```

2. In the `production` environment add:
   - Variable `KEYSTORE_BACKUP_CERT`: the whole text of `backup-cert.pem`.
   - Secret `ADMIN_GH_TOKEN`: GitHub → Settings → Developer settings →
     Fine-grained tokens → only this repository, with **Environments**,
     **Secrets** and **Variables** set to read and write.

### 3. Merge

Open the pull request, wait for the green **Tests** check, then **Merge**.

Right after the merge, an automatic **Build Android APK** run asks for
approval to sign. **Reject it**: the key does not exist yet (step 5), so it
would only fail. Nothing is published.

### 4. Approve the database update

**Actions → Deploy database and email templates** waits for your approval.
Approve it. It applies the database changes in order and sets the
password-reset email. If it stops with a list of extra rules or functions it
did not expect (for example ones added in the dashboard), drop them, then run
it again.

Then run this in the Supabase SQL Editor and look for accepted friendships
nobody remembers accepting (made through the old hole):

```sql
select f.created_at, a.username as requester, b.username as target
from friend_requests f join profiles a on a.id = f.requester_id join profiles b on b.id = f.target_id
where f.status = 'accepted' order by f.created_at;
```

### 5. Create the Android release key (once)

1. **Actions → Set up Android release signing (run once) → Run workflow.**
   Approve it when GitHub asks. It creates the key (EC, with a random
   password) inside GitHub; it never exists on anyone's computer.
2. Download the `release-key-backup` artifact from that run and keep it with
   `backup-key.pem`. Don't unpack it: it opens only with your pass phrase, and
   unpacked it would be the key without protection.
3. Delete the artifact (on the run's page) and the `ADMIN_GH_TOKEN` secret.

**Without this backup, no update can ever be installed over the app again**
if the GitHub secrets are lost.

### 6. Publish the app

**Actions → Build Android APK → Run workflow** on `main`. Approve the signing
step when asked. It builds, signs and publishes the `latest` release. Phones
that already have the app update normally; they don't need a reinstall. Check
on your phone: Settings → Check for updates.

From now on every push to `main` does this by itself after the tests pass.

## Day to day

- Open the web app or run the tests locally: see "Development" in `README.md`.
- When you change a file the app loads, run `npm run sw-hash` (otherwise
  installed copies keep the old file). The tests remind you.
- For a new version, change `js/version.js`, `Version` and `VERSION` in
  `sw.js` together.
- New database changes go in a new file in `supabase/migrations/`; merging it
  to `main` starts the deploy (with your approval).
