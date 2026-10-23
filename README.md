# Workout Tracker

The workout tracker remains usable offline. Signed-in accounts sync workout plans, complete sessions, exercise progress, streak days, and weigh-ins through Supabase.

## Data and privacy

- Completed sessions sync with each set's weight and reps, workout date, and elapsed duration. Saved exercise values, weekly plans, rest-day images, streak bypass days, and weigh-ins also sync across signed-in devices.
- Streaks are calculated from the saved schedule, completed sessions, and bypass days. Total gym time is calculated from saved session durations.
- When an account syncs for the first time, any already published leaderboard totals are retained as a legacy stats snapshot so history is not silently reduced if some old sessions are missing.
- Account creation stores an email with Supabase Auth and a username in the profiles table.
- A workout is uploaded only after pressing **Share this workout with friends**. Only accepted friends can read it.
- Accepted friends can compare workout-plan summaries and latest body weight. Row-level security limits those records to the owner and accepted friends.
- **Refresh** publishes workout count, lifted volume (kg × reps), total gym time, and current and best streak to the friend leaderboard. Detailed set history remains private to the account.
- To remove a shared workout or stats, use Supabase's table editor (or add a delete control before production use). Deleting the account in Supabase removes related rows through cascading foreign keys.

## Online account setup

The live app is connected to the Supabase project in Central EU (Frankfurt). Its schema and row-level security policies have been applied, and Supabase Authentication is configured for the GitHub Pages URL.

- `cloud-config.js` contains the project URL and a browser-safe publishable key. The publishable key is public by design; never put a secret or `service_role` key in browser code.
- The deployed app is available at https://roguelineageaccmanager.github.io/gymapptest2/.
- Signed-in users sync complete workout history and progress. Private session data is visible only to its owner; accepted friends can read published leaderboard stats and body weight.

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
