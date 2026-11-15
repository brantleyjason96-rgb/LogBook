# Logbook for Android: build task list

Audience: coding agents, each taking one task. Read **Shared context** and **Decisions** first, then your task.
Sizes: S = under half a day, M = about a day, L = several days.

## Goal

A native Android app that does everything the Logbook web app (PWA) does: capture, People, Content, Today, Review, Search, Settings. It works offline and syncs with the existing Google Sheet through the Apps Script web app. It adds real local reminders for contacting people.

## Shared context (verified from the repo)

- **Reference web app:** `app.js`, `index.html`, `style.css`, `sw.js`, `manifest.webmanifest` on `main`. One IIFE, no build step, about 78 KB. Treat it as the behavioural spec.
- **Watch app + Apps Script source:** branch `origin/ccr-7516bd10-blm14v`, folder `pebble-logbook/`.
  - `src/pkjs/sheets_config.js` holds the **Apps Script v3 source** in the `APPS_SCRIPT` array.
  - `src/pkjs/names.js` is the watch's copy of the name-matching code. The web app says it is "kept in step" with it.
  - `src/pkjs/index.js` is the watch's phone-side sync (queues, retry, `SHEETS_URL_RE`).
  - `HUB_NOTES.md` is the watch changelog.
- **Sheet layout (v3):**
  - `Events`: `event_id, when, date, kind, entity_ref, title, category, stars, position, note, source, voided`. Append-only. Ids come from clients, so retries are harmless.
  - `Ratings`: `ref, title, category, stars, date`. Latest rating per item.
  - `Entities`: `entity_ref, title, category, first_seen, last_seen, events, avg_stars, latest_stars`. The last five columns are formulas.
  - Views `Today`, `People` and `Summary` are `QUERY` formulas.
- **Event shape on the wire** (POST `{events:[...], rows:[...]}`): `{id, ts, day, kind, ref, title, cat, stars, pos, note, src}`.
  - Kinds: `met`, `rated`, `logged`, `note`, `bookmark`.
  - Phone ids look like `p-<ts36>-<rand>`. Rating ids look like `r-<ref>-<ts>`.
- **Refs:**
  - People are `n:<slug>`, and `n:?` for a new spoken name on the watch.
  - Items from the "Went, ate, did" flow are `x:<slug>`.
  - Catalog items use `m:<tmdb>`, `t:<tmdb>`, `p:<itunes>`, `a:<itunes>`, `s:<itunes>`, `b:<openlibrary work>` and `r:<mealdb>`.
  - **Refs must be byte-identical across clients, or you get duplicate people.** See `slugOf` and `norm` in `app.js`.
- **Auth today:** a shared KEY in the query string, with the web app deployed as "Anyone". Writes are serialised with `LockService`.
- **Today's API:**
  - `GET ?key=&action=ping` or `?since=<ms>` returns `{ok, events, entities, ratings}`.
  - `POST` with `{events, rows}`, `{test:true}`, or `{action:'void'|'rename'|'merge', ...}`.
- **Known defects in v3 that block a native client** (verified in the v3 source):
  1. `readEvents` filters on event time (`when <= since`), not insertion order. Late, backdated or offline-queued events are missed forever by any incremental client.
  2. Voided events are dropped from reads. Rename and merge rewrite old rows in place. A client cannot see either incrementally.
  3. Reads are capped at the latest 10,000 rows. The web app refetches everything each time.
  4. `addEvents` stores 12 columns. The watch sends `track` and `about` (README and 1.17/1.18 notes) and v3 drops them. The deployed script may be newer. Confirm in task A0.
  5. Follow-up "done" state and name aliases live only in each device's `localStorage`.
- **Dev environment:** the container has JDK 21 and Gradle 8.14. **It has no Android SDK.** Pure-Kotlin modules (`:core`) build and test here. The `:app` module needs the SDK, so build it in CI or Android Studio. Do not claim UI behaviour you could not run.

## Decisions (locked; do not re-litigate)

1. **No new server.** The Sheet plus Apps Script stay the system of record, because the Pebble watch writes there and its phone side only accepts `script.google(usercontent).com` URLs.
2. **Offline-first.** The app reads and writes a local Room database and syncs in the background.
3. **Stack:** Kotlin, Jetpack Compose, Room, WorkManager, OkHttp + kotlinx.serialization. Pure logic in a JVM module `:core` with no Android imports.
4. **Layout:** everything under `android/`. Do not modify the PWA or the watch app. The PWA stays as the fallback and laptop client.
5. **Reminders are local** (WorkManager and notifications). An Apps Script email or Calendar digest is optional (task A3).
6. **Privacy:** no analytics or third-party crash SDKs. Secrets are stored encrypted. Disable Android auto-backup of the key. People notes are personal data. Student data must not be entered (FERPA and district policy).
7. **Distribution:** sideloaded APK built by CI. No Play Store.

## Dependency map

```
Wave 0 (user)   A0
Wave 1          A1 (contract first) | B1 | B3 fixtures
Wave 2          A1 impl+tests | B2 | B3 | B4 | B5 | C1
Wave 3          C2 | C3 | D1
Wave 4          D2 D3 D4 D5 D6 D7 D8 (parallel)
Wave 5          D9 | D10 | E1 E2 E3 E4
```

---

## Track A: Apps Script v4 (backend, no server)

### A0: Safety and ground truth (S, USER + agent)

- **User:** make a copy of the Sheet (File, Make a copy). Paste the *deployed* Apps Script into `docs/deployed_script.gs`. Export a scrubbed `events.json` and `entities.json` (names and notes may be replaced, but refs, kinds, timestamps and shapes must stay real) into `android/fixtures/`.
- **Agent:** diff the deployed script against v3 in `sheets_config.js`. Write `docs/script_diff.md` stating whether `track` and `about` are stored, and which columns exist.
- **Done when:** the diff and fixtures are committed and the Sheet backup is confirmed.

### A1: Apps Script v4 with an incremental sync contract (L)

Deliver in this order:

1. **`docs/API_V4.md`, the contract, within the first hour.** Other agents build against it. Proposal:
   - `POST` body (`text/plain` JSON), with the key in the body, never the URL: `{action:'pull', key, evCursor, chCursor, limit}` returns `{ok, v:4, api:3, events:[...with seq...], changes:[...], entities:[full list], evCursor, chCursor, more}`.
   - Push is the existing `{events, rows}` plus `changes:[{id, type, payload}]`, idempotent by `id`.
   - Change types: `void{eventId}`, `rename{ref,name}`, `merge{from,to,title,cat}`, `entityFields{ref,fields}`, `alias{heard,ref}`, `fuDone{key}`.
2. **Schema:**
   - Append to `Events`: `track`, `about`, `place`, `seq`. `seq` is a monotonically increasing integer written under the lock. **Do not use row numbers**, because a manual sort in the Sheet would break them.
   - New append-only tab `Changes`: `seq, id, ts, type, payload_json`.
   - Append to `Entities`: `remind_days`, `snoozed_until`, `retired`, `org`, `role`, `tags`.
   - The migration must be idempotent and run from `setup()`.
3. **Behaviour:**
   - Pull returns events with `seq > evCursor` and changes with `seq > chCursor`, paginated (`more`).
   - Void, rename, merge and field edits are applied as they are today, so the old `GET` and the PWA keep working, **and** appended to `Changes`.
   - `Changes` ids are idempotent, like event ids.
   - **Backward compatibility is a hard requirement.** The watch's `POST {events, rows}`, `{test:true}` and the PWA's `GET` and edit actions must behave identically. Add regression tests for each.
4. **Tests (Node, mock `SpreadsheetApp`, `LockService`, `ContentService`):**
   - Duplicate event ids are ignored.
   - A backdated event with a low `ts` pushed after newer events is still returned by pull.
   - A void or merge before a pull is visible via `changes`.
   - A merge replayed from a cursor equals a full resync (property test).
   - Pagination.
   - The `track` and `about` round-trip.
5. **Deploy notes:** `docs/DEPLOY_V4.md` covers running `setup` again, creating a new deployment version, keeping the URL, and how to roll back.

**Done when:** the tests pass in CI and the contract is frozen at v4.0 (later changes need a version bump).

### A2: People data in the script (S, after A1)

Entity-field edits (`remind_days`, `snoozed_until`, `retired`) and validation: `remind_days` is an integer 1–730 or empty, and dates are ISO. Add them to tests.

### A3: OPTIONAL backup reminder channel (S, after A1)

A daily time-driven trigger computes due people with the same rule as B5 and sends a digest email or creates a Calendar event. **Gate:** it only ships if the account's policy allows triggers and mail. This is the fallback if Android kills background work. Do not block the app on it.

---

## Track B: `:core` (pure Kotlin, JVM tests run in the container)

### B1: Scaffold and CI (M)

- Gradle multi-module with a version catalog: `:core` (kotlin-jvm) and `:app` (Android application, `minSdk 26`, `targetSdk 35`, package `app.logbook`; confirm both with the user).
- GitHub Actions workflow: `gradle :core:test` plus `assembleDebug`, uploading the APK as an artifact. A release job signs with secrets and the user supplies the keystore.
- Add `android/README.md` with build and sideload steps.
- **Done when:** CI is green on a hello-world app and the APK installs.

### B2: Domain model and `model()` port (M)

- Port `allEvents()` and `model()` from `app.js:160-189`:
  - `Event`, `Entity`, `Item`, `isPerson` (`cat == person` or ref starts with `n:`).
  - Merging queued, unsent events.
  - Counting `met` events, first/last times and the newest star rating.
- Category map (`CAT_LABEL`, `catKey`, with `album` mapping to `music`) and kind labels.
- **Done when:** unit tests on `fixtures/events.json` match the JS output for item counts, people lists and `met` counts.

### B3: Name logic, with golden-file parity (M)

- Port `norm`, `slugOf` (including the hash fallback `'u'+base36`, using 32-bit Int overflow like JS `|0`, UTF-16 char codes), `titleCase`, `parseWho`, `sound`, `lev`, `tokMatch`, `nameMatch`, `fuzzyFind` and `findPerson` with the alias map (`app.js:62-157`).
- **Parity harness first:** a Node script that extracts those functions from `app.js` and writes golden JSON for at least 300 names (accents, honorifics, "Ms Gamilah / Miss Jamila", empty, emoji, very long). Kotlin tests must reproduce it exactly.
- Cross-check against the watch's `names.js`. Report any divergence, and do not "fix" either side without telling the user.
- **Done when:** 100% parity on the golden file.

### B4: Analytics port (L)

- Port from `app.js:326-481`: `cadenceOf`, `needsAttention`, `everyText`, `followUps` (**regexes exactly**, with a Java vs JS regex check for `\b` and case folding), `topicsOf`, `themes`, `resumeList`, `streak`, `aWhileBack`, `weekStats`, `notices`, `tasteList`, `narrative`, `suggestions`, `checkInDraft`.
- Also port their helpers (`words`, `snip`, `cap`, `greetName`, `initials`, `median`, `rel`, `daysSince`), which sit in lines not listed here. Read the file.
- **Inject the clock** (`now` as a parameter) so tests are deterministic.
- Golden tests as in B3, using a fixed `now`.
- **Done when:** outputs match the JS for the fixture set.

### B5: Explicit reminders (S)

- Rule: `due = lastMetDay + remindDays`. It is overdue when today is past due, snoozed until `snoozedUntil`, and excluded when retired.
- An explicit interval overrides the inferred cadence in `needsAttention` and in the Home suggestions.
- "Met just now" resets the clock automatically (no stored due date).
- **Done when:** tests cover snooze, retire, no interval, backdated meetings and day boundaries (timezone and DST).

---

## Track C: Data layer and sync (Android)

### C1: Room database (M)

- Tables: `events` (all wire fields plus `seq`, `voided`, `pending`), `entities` (plus the A1 People fields), `outbox` (events, rows and changes), `meta` (cursors, last sync), `aliases`, `fu_done`.
- Migrations from day one, with exported schemas.
- A repository interface in `:core` and a Room implementation in `:app`.
- **Done when:** instrumented or Robolectric tests cover insert, dedup by id and outbox ordering.

### C2: Sync engine (L, after A1 contract and C1)

- **Pull:** loop on cursors until `more` is false. Apply events, then apply changes in `seq` order. A full resync must produce the same local state as the incremental path (test it).
- **Push:** drain the outbox in batches, idempotent by id. Edits (void, rename, merge, field edits, aliases, follow-up done) are **queued like captures**. The PWA requires a connection for these. Do better.
- **Triggers:** after capture, on app foreground, periodic WorkManager, and manual refresh.
- **Failure handling:** exponential backoff, and a distinct state for a wrong key, an old script (detect `v < 4`) and offline.
- **Status pill:** `Not connected / Synced hh:mm / N waiting / Offline`.
- **Tests:** a fake v4 server in Kotlin (or the Node harness over HTTP) covering a flaky network, duplicate delivery, backdated events, late watch events and a merge during an outage.
- **Done when:** all of those pass and no event is lost or duplicated.

### C3: Connection settings and secure storage (S)

- Store URL, key and TMDB key in Keystore-backed encrypted storage. Never log them.
- Import the existing setup link (`#u=<url>&k=<key>&t=<tmdb>`) by deep link and QR scan.
- "Test connection" uses `ping`.
- Disable auto-backup for secrets.

---

## Track D: UI (Compose). Mirror the PWA's behaviour and routes

All screens read state from the repository through ViewModels and use `:core` for derived data. Reuse the colour tokens from `style.css`, with dark mode. TalkBack labels and 48 dp targets are part of "done".

- **D1: Shell and theme (M).** Bottom navigation `Home, People, Capture (centre button), Content, Review`. Top bar with sync pill, search, refresh and settings. Routes: home, capture, today, people, entity, content, search, review, settings.
- **D2: Capture (L).** Four flows from `app.js:644-681`:
  - **Met someone:** name field with matching person chips, "coffee with Maria" parsing, note, **voice dictation** (`SpeechRecognizer`), **an optional date and time picker so a past meeting can be logged**, and a collapsed "More details" with `place` and "remind me every N days/weeks."
  - **A thought:** note plus an optional "about" picker.
  - **Went, ate, did:** name, kind chips (restaurant, coffee, place, event, plus custom), rating, note.
  - **Watched, listened, read:** kind chips, catalog search, half-star rating, and "Just log it".
  - Catalog sources (`app.js:696-720`): TMDB for movie and tv (a key longer than 40 chars is a Bearer token, otherwise an `api_key` param), iTunes for podcast, album and song, Open Library for book, TheMealDB for recipe, games none. Always offer "Add as typed". Cancel retains no draft.
  - Offline: every save goes through the outbox.
- **D3: Home (M).** Greeting block, narrative, quick tiles, "Looks like right now" suggestions, today so far, people worth a message (now including explicit reminders), follow-ups, resume list, this week, "a while back".
- **D4: People (L).**
  - **List:** search, sort (recent, not seen longest, most often, A to Z), and the stale-days flag.
  - **Person page:**
    - Cadence label, stats and the 12-month bars.
    - Topics, open follow-ups with "mark done" (synced via `fuDone`), and the timeline.
    - Check-in draft with Copy and an `ACTION_SEND` or SMS intent. Nothing is sent automatically.
    - Met just now, Add a note, Rename, Merge into, and Remove entry (void).
    - New: place history, reminder interval, snooze (1 week, 1 month), retire.
- **D5: Content (M).** Category filter, sort (recent, stars, A to Z), item detail with the timeline and rename/merge.
- **D6: Today and Review (M).** Day navigation. Week stats against the previous week, narrative, themes with trend tags, notices, taste by category.
- **D7: Search (S).** People, titles and notes; matches as chips plus an entry list.
- **D8: Settings (S).** Connect and test, setup link, device info (entry count, queue length, last sync), clear local copy, disconnect.
- **D9: Android integrations (M).**
  - Share target: text shared from another app becomes a note.
  - Static launcher shortcuts "Met someone" and "Thought".
  - A Glance home-screen widget with quick-capture buttons and a today count.
  - Optional Quick Settings tile.
- **D10: Reminders (M, after B5 and C2).**
  - Notification channel and the Android 13+ `POST_NOTIFICATIONS` flow.
  - A daily WorkManager worker. It re-checks after every sync and reschedules on boot.
  - Notification actions: Open, Snooze a week, Mark contacted (logs a `met` event).
  - A settings screen with "check battery optimisation" guidance, because OEMs kill background work.
  - **Honest acceptance:** this can only be verified on a real device over several days. The agent must say so and provide the test script.

---

## Track E: Quality and release

- **E1: Parity and end-to-end check (M).** Run PWA and Android side by side on the same Sheet copy. Checklist: capture offline, go online and sync; a watch event shows up; a backdated event arrives after newer ones; void, rename and merge from either client show on the other; the 10,000-row limit is gone. Record results in `docs/PARITY_REPORT.md`.
- **E2: Accessibility pass (S).** TalkBack, 200% font scale and contrast in light and dark.
- **E3: Release pipeline (S).** Signed release APK in CI, version scheme, sideload instructions, and an update path.
- **E4: Privacy review (S).** Confirm no network calls except the Apps Script URL and the catalog APIs. Confirm secrets are never logged. Confirm backup exclusions.
- **E5: Docs (S).** Fill out `android/README.md`, `docs/API_V4.md` and `docs/DEPLOY_V4.md`.

## Out of scope

- Any new server, or replacing the Sheet.
- Changes to the Pebble watch app. (If the v4 columns change what the watch should send, that is a follow-up.)
- iOS and the Play Store.
- Student or parent data in People.

## Open questions for the user (block specific tasks)

1. Android version and phone model → sets `minSdk` and the battery-optimisation guidance (B1, D10).
2. The deployed Apps Script text and a scrubbed export (A0). Blocks A1 and all parity tests.
3. Is the Sheet under a school Google account? Blocks A3 only.
4. Package name and app name (B1).
