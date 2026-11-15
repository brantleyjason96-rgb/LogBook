# Logbook for Android: build plan for the Margin design

This plan says how to turn the Margin mockup into the Android app, in what order, and how each step is checked. It sits on top of two earlier documents and does not replace their decisions.

- `docs/ANDROID_APP_TASKS.md`: the original task list. Tracks A (script), B (`:core`), C (data and sync) and E (quality) stand as written. Its **Decisions** are locked.
- `docs/ANDROID_DESIGN_BRIEF_MARGIN.md`: the design brief. Done. Its output is `android/design/margin/`.
- `android/design/margin/HANDOFF.md`: screen by screen, the composable, the state it needs, and the components.
- `docs/LOCAL_AI_PLAN.md`: the optional on-device model layer. It sits outside every milestone below; the app works without it.
- `docs/DEPLOY_V4.md`: deploying the v4 Sheet script, which is the one step that turns sync on.

**What this plan changes:** Track D (UI). The Margin design has three tabs instead of five, moves People and Content into the Feed, and adds a Nudges tab. So D1 to D8 are replaced by M1 to M12 below. D9 and D10 keep their content.

## 1. Where things stand

| Piece | State |
|---|---|
| Design direction | Chosen: Margin. |
| Clickable mockup, tokens, handoff, 202 screenshots | Done, in `android/design/margin/`. |
| Android code | `android/` builds: `:core` plus the full app (M1 to M12, D9, D10). 39 core tests and 2 Robolectric smoke tests pass; debug APK 27 MB, minified release APK 3.7 MB, signed with the debug key for sideloading. |
| Apps Script v4 (incremental sync) | Written and committed in `android/script/logbook_v4.gs`; **not deployed**, so the phone stays on its outbox. Steps: `docs/DEPLOY_V4.md`. |
| Build machine | The cloud container now has JDK 21 **and** an Android SDK; `android/local.properties` points at it (gitignored). `./gradlew :core:test :app:testDebugUnitTest :app:assembleDebug` runs here. `assembleRelease` (R8 plus lint-vital) needs its own pass: the shell stops at five minutes. |
| On-device checks | **Not done.** No emulator or phone here, so notifications, the widget, dictation, TalkBack order and the real pixels have only been compiled and, for the shell, exercised under Robolectric. |

## 2. What you need to do before any code (about 30 minutes)

These are the only steps that need you. Everything else can be handed to a coding session.

1. **Back up the Sheet.** File, Make a copy.
2. **Paste the deployed Apps Script** into `docs/deployed_script.gs` (Extensions, Apps Script, select all, copy).
3. **Export a scrubbed sample** of the Events and Entities tabs into `android/fixtures/` (names and notes may be replaced; refs, kinds, timestamps must stay real). A session can write a script that does the scrubbing for you.
4. **Answer four questions:** your phone model and Android version; whether the Sheet is on your school Google account; the app name and package name (default `app.logbook`, "Logbook"); the six design questions at the end of `HANDOFF.md`.
5. **Install Android Studio** on a laptop if you want to run the app from source. Not needed if you only install the APK that GitHub builds.

Steps 2 and 3 block the script work and the parity tests. Steps 4 and 5 block only the tasks named in section 9.

## 3. Milestones

Each milestone ends with an APK you can install and use. Stop at any of them and the app still works.

| Milestone | You can | Tasks |
|---|---|---|
| **M-A: Read-only** | Connect to the Sheet, see the Feed, People, Things, Search, Person, Item, Review, Today. Nothing is written. | A0, A1, B1 to B4, C1, C2 (pull only), C3, M1 to M6, M9, M10, M11 (connect and settings) |
| **M-B: Capture offline** | Log all four kinds with no signal and watch them sync. Mark follow-ups done. Rename, merge, remove. | C2 (push), M8, edits in M9 |
| **M-C: Nudges and reminders** | See who to reach out to, snooze, get a real notification. | A2, B5, M7, M11 (reminders), M12, D10 |
| **M-D: Release** | Signed APK, widget, shortcuts, share target, accessibility and parity reports. | D9, E1 to E5 |

## 4. Order of work

Tasks on the same line can run at the same time in separate sessions. "Container" means a cloud session can build and test it. "SDK" means it needs GitHub Actions or Android Studio to compile.

```
Wave 0  (you)        A0
Wave 1  (container)  A1 contract  |  B1 scaffold + CI  |  B3 fixtures and golden names
Wave 2  (container)  A1 script + tests  |  B2  |  B3  |  B4  |  B5
        (SDK)        M1 theme  |  C1 Room
Wave 3  (SDK)        M2 components  |  C2 sync  |  C3 secure settings
Wave 4  (SDK)        M3 shell and navigation
Wave 5  (SDK)        M4 Feed | M5 People and Things | M6 Search | M9 Person and Item | M10 Review and Today | M11 Settings      → milestone M-A
Wave 6  (SDK)        M8 Capture  |  edits in M9                                                                               → milestone M-B
Wave 7  (SDK)        A2  |  M7 Nudges  |  D10 reminders  |  M12 notification, widget, shortcuts                                → milestone M-C
Wave 8               D9 share target  |  E1  |  E2  |  E3  |  E4  |  E5                                                        → milestone M-D
```

## 5. Project layout

```
android/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml
  core/                                   pure Kotlin, no Android imports (B2 to B5)
    src/main/kotlin/app/logbook/core/
      model/        Event, Entity, Item, Ref, Kind, Category
      names/        norm, slugOf, parseWho, nameMatch, findPerson          (B3)
      analytics/    cadence, followUps, themes, weekStats, narrative,
                    suggestions, checkInDraft, notices, taste, streak      (B4)
      reminders/    dueDate, isDue, snooze                                 (B5)
      text/         followUpSpans(note), matchSpans(note, query)           (new, for the highlighter)
      sync/         wire types for API v4, cursor logic                    (A1 contract)
    src/test/       golden JSON tests against app.js output
  app/                                    Android application module
    src/main/kotlin/app/logbook/
      data/         Room database, DAOs, repository, outbox                (C1)
      sync/         SyncEngine, SyncWorker, SyncState                      (C2)
      settings/     encrypted connection store, setup link, QR             (C3)
      ui/theme/     Color.kt, Type.kt, Shape.kt, Motion.kt, LogbookTheme   (M1)
      ui/components/  one file per Lb component, each with previews        (M2)
      ui/shell/     AdaptiveShell, navigation graph, AccountSheet          (M3)
      ui/feed/  ui/search/  ui/nudges/  ui/review/  ui/day/
      ui/capture/  ui/person/  ui/item/  ui/settings/                      (M4 to M11)
      reminders/    ReminderWorker, notification builder, boot receiver    (D10)
      widget/       Glance widget                                          (M12)
    src/main/res/font/   Instrument Serif, Plus Jakarta Sans, DM Mono (all SIL Open Font License)
    src/main/res/xml/    shortcuts.xml, backup rules that exclude secrets
    src/test/            ViewModel tests, screenshot tests
  fixtures/                               scrubbed events.json and entities.json (A0)
  design/margin/                          the mockup (reference, not shipped)
.github/workflows/android.yml             core tests, assembleDebug, screenshot tests, APK artifact
```

Stack, as locked in the task list: Kotlin, Jetpack Compose with Material 3, Room, WorkManager, OkHttp with kotlinx.serialization. Add: Navigation Compose with typed routes, `material3-adaptive` for the list and detail layout, Glance for the widget, a screenshot test library (Roborazzi runs on the JVM in CI, so no emulator is needed), ML Kit or ZXing for the QR scan, `androidx.security` or the Keystore directly for secrets. No analytics, no crash SDK.

## 6. The Margin tasks

Sizes: S under half a day, M about a day, L several days. Every task ends with previews or tests in light and dark, TalkBack labels, and 48 dp targets.

### M1: Theme from the tokens (S, needs B1)

- Read `android/design/margin/DESIGN_TOKENS.json`. Write `Color.kt` (a Material 3 `ColorScheme` from the `material3` map, plus a `LogbookColors` class for coral, mark, ok, warn, star and the five kind tiles, provided through a `CompositionLocal`), `Type.kt`, `Shape.kt`, `Motion.kt`.
- Bundle the three font families in `res/font`. Keep the licence files.
- Turn dynamic colour off. Dark theme follows the system, with an override in Settings later if wanted.
- Add a unit test that loads the JSON and fails if a Kotlin colour differs from it, so the two cannot drift.
- **Done when:** a preview screen shows every colour and type style and matches `screens/00-components_*.png` by eye.

### M2: Component library (L, needs M1)

- Build every component in the `HANDOFF.md` component table, in `ui/components/`, each with `@Preview` in light, dark and font scale 2.0.
- The highlighter is a function that returns an `AnnotatedString`. It takes ranges from `:core` (`followUpSpans`, `matchSpans`). No regex in UI code.
- At font scale 1.5 and above, switch to the stacked layouts listed under `fontScale` in the tokens. Read the scale from `LocalDensity.current.fontScale`.
- Add screenshot tests for the gallery. Commit the reference images.
- **Done when:** the gallery preview matches the mockup's gallery, and the screenshot tests pass in CI.

### M3: Shell and navigation (M, needs M2, C2 for the sync state)

- Typed routes that match brief section 5: `Feed(filter)`, `Search(q)`, `Nudges`, `Review`, `Day(date)`, `CaptureMet`, `CaptureNote(about)`, `CaptureAny`, `CaptureMedia`, `CaptureRate`, `Person(ref)`, `Item(ref)`, `Settings`, `Reminders`, `Connect`. The speed dial and the account sheet are overlays in the shell, not destinations.
- Three top-level tabs with their own back stacks. `LbNewButton` shows on Feed, Nudges, Review and Day.
- `NavigationSuiteScaffold` gives the bottom bar on phones and the rail at 600 dp and wider. `ListDetailPaneScaffold` puts Person or Item beside the Feed on wide screens.
- Edge-to-edge with insets. Capture screens resize with the keyboard and keep `LbSaveBar` above it.
- First run goes to `Connect` when there is no stored connection. Deep link for the setup link (`#u=…&k=…&t=…`).
- Back goes up one level and never asks about drafts.
- **Done when:** every route opens with placeholder content, back behaves, and the tablet preview matches `screens/15-tablet-feed-person_*.png` in structure.

### M4: Feed (M, needs M3, B2, B4)

- `FeedViewModel` exposes `FeedUiState` (see `HANDOFF.md`). Filters: All, Thoughts, Places, Open loops are the same list with a predicate. People and Things swap the list (M5).
- Week card from `weekStats` and `themes`. Day groups from the repository, newest first, paged if the list is long.
- Follow-up tag toggles done through the repository (queued as a `fuDone` change).
- States: first run empty, sync strip for every non-synced state, pull to refresh.
- **Done when:** ViewModel tests cover each filter on the fixtures, and a screenshot test matches `01-feed`.

### M5: People and Things lists (M, needs M4, B4, B5)

- People: four sorts, status tag, 12-month mini bars, counts. Things: category chips built from the data, three sorts, stars.
- Sort choice is remembered.
- **Done when:** sorting and status tags are tested against the fixtures with a fixed clock.

### M6: Search (S, needs M4)

- Search people, titles and notes in Room. Debounce typing. Results carry match ranges for the highlighter.
- Empty query shows recent searches (stored locally) and this week's themes.
- **Done when:** results, no results and empty query match `04-*`.

### M7: Nudges (M, needs B4, B5, M2)

- Reach out: explicit reminders that are due, then Slipping and Quiet people, minus anyone snoozed or retired. Each card has the reason, the check-in draft, Text (an `ACTION_SENDTO` intent with the draft; the app sends nothing itself), Snooze (1 week, 1 month), Met just now.
- Follow-ups: open ones from the last 60 days with checkbox rows.
- Looks like right now: `suggestions()` from `:core`.
- Badge on the tab. The count rule is open question 1.
- **Done when:** with a fixed clock, the fixtures give the expected cards, snooze removes a card and survives restart, and Met just now logs a `met` event through the outbox.

### M8: Capture (L, needs M3, B3, C1, C2 push)

- Four flows as in the mockup. One `CaptureViewModel` per flow. Nothing survives cancel.
- Met someone: `parseWho` and `findPerson` from `:core` drive the "Reading this as" line and the chips. When: Just now, Earlier today, Yesterday, or a date and time picker. More details: place with recent places, reminder interval.
- Dictation uses `SpeechRecognizer` and needs the microphone permission at first use only.
- Media search: TMDB, iTunes, Open Library, TheMealDB, with the six result states. Always offer "Add as typed".
- Star input: tap, drag, minus and plus, with slider semantics for TalkBack.
- Every save writes to Room and the outbox first, then asks the sync engine to run.
- **Done when:** each flow saves offline in a test, refs match the web app's refs for the same input (uses B3 golden tests), and the keyboard-open layout is checked on a device.

### M9: Person and Item (L, needs M4, B4, B5; edits need C2 push and A2)

- Person: header, three stats, actions, reminder card with its four states (none, set, due, snoozed, retired), 12-month bars, check-in draft with Send as text and Copy, topics (open Search), open follow-ups, places, timeline.
- Overflow: Rename, Merge into, Retire. Long press an entry to remove it, with a TalkBack custom action that does the same.
- Item: the same page without cadence, reminder or draft.
- All edits are queued like captures, so they work offline.
- **Done when:** reminder states are tested with a fixed clock, and a rename, merge and remove each round-trip through the fake server.

### M10: Review and Today (M, needs M4, B4)

- Review: story, four tiles with last week, themes with trend tags, 12-week grid (tap a day to open it), category bars, notices, taste, streak, open follow-ups.
- Today: one day's entries, previous and next, a date picker that marks days with entries.
- **Done when:** numbers match the web app on the fixtures for the same clock.

### M11: Connect, Settings, Reminders (M, needs C3; reminders part needs D10)

- Connect: Scan QR, Paste link, nothing else. Errors for a wrong key and an old script.
- Settings: sync card, connection fields (key masked), Save and test, QR and link for another phone, clear local copy, privacy, version, disconnect with a warning when entries are still waiting.
- Reminders: notification permission, daily check time, battery steps for the phone's maker, list of people with a reminder.
- **Done when:** the setup link from the web app connects the phone, and secrets never appear in logs or backups (E4 checks this again).

### M12: Notification, widget, shortcuts (M, needs D10, M8)

- Notification with Open, Snooze a week, Mark contacted. Mark contacted logs a `met` event.
- Glance widget 4 × 2: Met, Rate, Did, Note, and today's count.
- Static shortcuts: Met someone, A thought.
- **Done when:** each action lands on the right screen on a real phone.

## 7. What Margin needs from `:core` and the script that the old plan did not list

| Need | Where | Why |
|---|---|---|
| `followUpSpans(note): List<IntRange>` and `matchSpans(note, query)` | B4 | The highlighter paints the exact phrase in the note. Today's `followUps()` returns text only. |
| Follow-up keys that are stable across devices | A1 (`fuDone`), B4 | Done state must sync. The web app keys on `eventId:clauseIndex`, which is stable as long as the split rule is identical everywhere. |
| A decision on the "Ask Ms" split (finding F1 in `HANDOFF.md`) | B4, and the web app | The key and the highlight both depend on it. Decide before golden files are made. |
| Place on `met` events | A1 (already proposed as a column) | Person page shows "Where you meet". |
| `remind_days`, `snoozed_until`, `retired` on entities | A2 (already proposed) | Reminder card and Nudges. |
| Counts for the Nudges badge | B5 | One function, so the tab, the widget and the notification agree. |

## 8. How each layer is tested

| Layer | Test | Runs where |
|---|---|---|
| `:core` names and analytics | Golden files made by running the real `app.js` functions in Node on the fixtures, compared in Kotlin. Clock is injected. | Container and CI |
| Apps Script v4 | Node tests with mocked `SpreadsheetApp`. Old `GET` and watch `POST` regression tests. | Container and CI |
| Sync | A fake v4 server. Flaky network, duplicates, backdated events, merge during an outage. Full resync equals incremental. | CI |
| ViewModels | JVM tests on fixtures with a fixed clock. | CI |
| Look | Screenshot tests per component and per screen, light, dark, font scale 2.0. Compared by eye against `android/design/margin/screens/` when first recorded. | CI |
| Behaviour on a phone | A written checklist: keyboard, back, insets, TalkBack, widget, notification actions, reminders over three days, battery settings. | Your phone |
| Parity | Web app and Android side by side on a copy of the Sheet (E1). | You plus a session |

A session must not report phone behaviour it did not run. Anything only checked in a preview is reported as "checked in preview".

## 9. What blocks what

| Open item | Blocks |
|---|---|
| Deployed Apps Script text and scrubbed export (A0) | A1 script, all golden and parity tests. Not the theme, components or shell. |
| Package and app name | B1 only. Default is `app.logbook` and "Logbook". |
| Phone model and Android version | `minSdk` (default 26), battery guidance in M11, device checks. |
| School account or personal | A3 only (optional email digest). |
| Design questions 1 to 6 in `HANDOFF.md` | 1: M7. 2: B4. 3: M1. 4: M3. 5: M9. 6: M10. Each has a default in the mockup, so work can start. |

## 10. Risks

- **Phones that stop background work.** Reminders can arrive late on Samsung, Xiaomi and OnePlus. The app shows battery steps, re-checks after each sync, and Nudges always shows what is due. The optional email digest (A3) is the fallback.
- **Two clients, one rule.** If Kotlin and `app.js` disagree on a slug or a follow-up split, people or follow-ups duplicate. Golden tests in B3 and B4 are the guard. Do not skip them to save time.
- **Old script on the Sheet.** The app must detect a script older than v4 and say so (the "Script is old" state), not fail silently.
- **Design drift.** The mockup is HTML and the app is Compose. Screenshot tests recorded against the mockup keep them close. Small pixel differences in fonts are expected.
- **No Android SDK in the cloud session.** UI tasks are slower to check. Keep logic in `:core` where it can be tested in the container, and keep composables thin.

## 11. Starting the build: prompts to paste

Start each in a new session on this repository.

**Wave 1, scaffold (works today):**

> Read `docs/ANDROID_BUILD_PLAN_MARGIN.md` and `docs/ANDROID_APP_TASKS.md`. Do task B1: create the Gradle project under `android/` with `:core` and `:app`, the version catalog, and a GitHub Actions workflow that runs `:core:test` and `assembleDebug` and uploads the APK. Package `app.logbook`, minSdk 26, targetSdk 35. The container has no Android SDK, so prove `:core` here and let CI prove `:app`. Do not touch the PWA or `android/design/`.

**Wave 2, theme (after B1):**

> Read `docs/ANDROID_BUILD_PLAN_MARGIN.md` section 6 and `android/design/margin/DESIGN_TOKENS.json`. Do task M1. Then start M2 with the first eight components in the `HANDOFF.md` table. Compare your previews with the PNGs in `android/design/margin/screens/`. Say plainly what you could only check in CI.

**Wave 2, logic (after A0):**

> Read `docs/ANDROID_APP_TASKS.md` tasks B3 and B4, and finding F1 in `android/design/margin/HANDOFF.md`. Build the Node golden-file harness from `app.js` first, then port to Kotlin in `android/core` until the golden tests pass. Add `followUpSpans` and `matchSpans` as described in the build plan section 7.
