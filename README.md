# Workout Tracker

The existing single-file workout tracker remains usable offline. This update adds an exercise finder and workout builder, plus optional accounts, friend requests, private-to-friends workout sharing, and an opt-in friend leaderboard.

## Data and privacy

- Existing workout logs, body-weight records, timers, and backups remain in this browser's `localStorage` and are never synced by this app.
- Account creation stores an email with Supabase Auth and a username in the profiles table.
- A workout is uploaded only after pressing **Share this workout with friends**. Only accepted friends can read it.
- **Publish my stats** explicitly shares only workout count and lifted volume (kg × reps) with accepted friends. It does not upload session details or body weight.
- To remove a shared workout or stats, use Supabase's table editor (or add a delete control before production use). Deleting the account in Supabase removes related rows through cascading foreign keys.

## Turn on online accounts

1. Create a Supabase project.
2. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. Edit `cloud-config.js` and enter the project's URL and public anon/publishable key. Never use a `service_role` secret in browser code. The file is included with blank values; the anon key is designed to be public in a browser app.
4. In Supabase Authentication settings, set the site's URL and allowed redirect URLs to the deployed app origin. Choose whether email confirmation is required.
5. Deploy the whole folder as a static site over HTTPS. `index.html`, `cloud.js`, and `cloud-config.js` must be served from the same directory.
6. Open **Friends**, create accounts, and exchange usernames to send friend requests.

The credentials in `cloud-config.js` are public browser credentials; database row-level security in `schema.sql` is what protects user data. Review those policies before changing the tables.

## Exercise data attribution

The searchable catalog is fetched from the [wger exercise API](https://wger.de/api/v2/exerciseinfo/?language=2). Exercise records identify their contributors, and wger exercise data is made available under Creative Commons Attribution-ShareAlike (CC BY-SA); the specific license and contributor can vary by record. See the [wger license documentation](https://wger.readthedocs.io/en/latest/) and each record's license metadata. Catalog search requires an internet connection; the included starter movements and the original workout programs remain available offline.

The code changes in this repository do not declare an overall project license. Check the repository owner's license before redistributing the app.

## Deployment

The repository already contains GitHub Pages assets and a GitHub Actions workflow for building the Android package. To publish the website, use the repository's configured GitHub Pages branch/action and check deployment status in GitHub. For account-enabled use, configure Supabase first and set the public project URL and anon key in `cloud-config.js`. A browser app necessarily exposes this key; RLS is mandatory.

No deployment was performed as part of this change: this workspace has no authenticated Git remote credentials, and no Supabase project credentials were provided.

## Verification

Run the repository's static checks with:

```powershell
python -m unittest discover -s tests -v
```

Then verify in a browser: existing logs load; offline mode still works; account sign-up/sign-in; friend request and acceptance; selected workout sharing; opt-in leaderboard publishing; RLS denial for unrelated users; and the wger catalog fallback when offline.
