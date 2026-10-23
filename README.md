# Workout Tracker

The existing workout tracker remains usable offline. The app adds a dedicated plan editor, a searchable exercise picker, account sync for plans and body weight, friend requests, and a friend-only progress comparison.

## Data and privacy

- Workout logs, timers, and backups remain on this device. Workout plans and weigh-ins sync to Supabase when signed in.
- Account creation stores an email with Supabase Auth and a username in the profiles table.
- A workout is uploaded only after pressing **Share this workout with friends**. Only accepted friends can read it.
- Accepted friends can compare workout-plan summaries and latest body weight. Row-level security limits those records to the owner and accepted friends.
- **Refresh** publishes only workout count and lifted volume (kg × reps) to the friend leaderboard; session details remain on this device.
- To remove a shared workout or stats, use Supabase's table editor (or add a delete control before production use). Deleting the account in Supabase removes related rows through cascading foreign keys.

## Online account setup

The live app is connected to the Supabase project in Central EU (Frankfurt). Its schema and row-level security policies have been applied, and Supabase Authentication is configured for the GitHub Pages URL.

- `cloud-config.js` contains the project URL and a browser-safe publishable key. The publishable key is public by design; never put a secret or `service_role` key in browser code.
- The deployed app is available at https://roguelineageaccmanager.github.io/gymapptest2/.
- Workout history stays in browser storage. Signed-in users sync their workout plans and weigh-ins; only accepted friends can read those synced records.

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
