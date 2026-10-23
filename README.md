# Workout Tracker

The existing single-file workout tracker remains usable offline. This update adds an exercise finder and workout builder, plus optional accounts, friend requests, private-to-friends workout sharing, and an opt-in friend leaderboard.

## Data and privacy

- Existing workout logs, body-weight records, timers, and backups remain in this browser's `localStorage` and are never synced by this app.
- Account creation stores an email with Supabase Auth and a username in the profiles table.
- A workout is uploaded only after pressing **Share this workout with friends**. Only accepted friends can read it.
- **Publish my stats** explicitly shares only workout count and lifted volume (kg × reps) with accepted friends. It does not upload session details or body weight.
- To remove a shared workout or stats, use Supabase's table editor (or add a delete control before production use). Deleting the account in Supabase removes related rows through cascading foreign keys.

## Online account setup

The live app is connected to the Supabase project in Central EU (Frankfurt). Its schema and row-level security policies have been applied, and Supabase Authentication is configured for the GitHub Pages URL.

- `cloud-config.js` contains the project URL and a browser-safe publishable key. The publishable key is public by design; never put a secret or `service_role` key in browser code.
- The deployed app is available at https://roguelineageaccmanager.github.io/gymapptest2/.
- Workout logs and body-weight records stay in browser storage. Users choose whether to share a workout or publish aggregate stats.

To connect a different Supabase project, run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor, then replace the URL and publishable key in `cloud-config.js`. Set the Supabase Authentication Site URL and allowed redirect URL to the deployed app address.

## Exercise data attribution

The searchable catalog is fetched from the [wger exercise API](https://wger.de/api/v2/exerciseinfo/?language=2). Exercise records identify their contributors, and wger exercise data is made available under Creative Commons Attribution-ShareAlike (CC BY-SA); the specific license and contributor can vary by record. See the [wger license documentation](https://wger.readthedocs.io/en/latest/) and each record's license metadata. Catalog search requires an internet connection; the included starter movements and the original workout programs remain available offline.

The code changes in this repository do not declare an overall project license. Check the repository owner's license before redistributing the app.

## Deployment

The repository already contains GitHub Pages assets and a GitHub Actions workflow for building the Android package. The website is deployed at https://roguelineageaccmanager.github.io/gymapptest2/. GitHub Pages updates automatically when changes are pushed to `main`; the Android package builds through its GitHub Actions workflow. Row-level security is enabled on all app tables.

## Verification

Run the repository's static checks with:

```powershell
python -m unittest discover -s tests -v
```

Then verify in a browser: existing logs load; offline mode still works; account sign-up/sign-in; friend request and acceptance; selected workout sharing; opt-in leaderboard publishing; RLS denial for unrelated users; and the wger catalog fallback when offline.
