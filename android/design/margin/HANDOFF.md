# Margin mockup: handoff to the Compose build

This folder is the design reference for the Logbook Android app in the "Margin" direction. It is a browser mockup, not the app. The build order lives in `docs/ANDROID_BUILD_PLAN_MARGIN.md`.

## What is here

| File | What it is |
|---|---|
| `index.html`, `css/margin.css`, `js/app.js`, `js/data.js` | The clickable mockup. Open `index.html` in a browser. No build step. The only network use is Google Fonts. |
| `DESIGN_TOKENS.json` | Colour (light and dark), type, shape, sizes, motion, font-scale rules, Material 3 mapping. |
| `screens/` | 202 PNGs: 48 screens and states at 360 × 800 and 411 × 914, light and dark, plus Feed, Person and Capture at 200% text, one tablet frame and the component gallery. |
| `tools/shoot.js` | Re-takes every screenshot and reports console errors, cut-off text and anything past the right edge. |
| `tools/contrast.js` | WCAG contrast check for the tokens. |
| `tools/build-artifact.js` | Joins the page into one file for publishing. |

URL parameters for a fixed state: `?theme=light|dark&sync=synced|waiting|offline|none|wrongkey|oldscript&fs=1|1.3|2&device=360|411|tablet&bare=1`, then the route in the hash, for example `index.html?theme=dark&sync=offline#capture/met?demo=1`.

## Where the brief and the plan disagree

The brief (`docs/ANDROID_DESIGN_BRIEF_MARGIN.md`) wins for navigation and visuals. The plan (`docs/ANDROID_APP_TASKS.md`) wins for everything else.

| # | Plan says | Brief and mockup do | Effect on the build |
|---|---|---|---|
| C1 | D1: five bottom tabs (Home, People, Capture, Content, Review) and a top bar with sync pill, search, refresh, settings. | Three tabs (Feed, Nudges, Review), a floating New button, a permanent search field, and an avatar that carries sync state and opens the account sheet. | D1 is rewritten. No refresh button: use pull-to-refresh on tabs and Sync now in the sheet. |
| C2 | D3: a Home screen with greeting, narrative, quick tiles, suggestions, today, people worth a message, follow-ups, resume, week, a while back. | Home is split. Today and the week go to **Feed**. Suggestions, people worth a message and follow-ups go to **Nudges**. The narrative goes to **Review**. | D3 becomes two tasks (Feed, Nudges). "Quick tiles" become the speed dial. "A while back" has no home in Margin (open question Q6). |
| C3 | D4 and D5: People and Content are their own screens. | They are filters on the Feed (`feed?filter=people`, `feed?filter=things`). | One Feed ViewModel with a filter, or child ViewModels per filter. Routes stay `person/<ref>` and `item/<ref>`. |
| C4 | Sync pill states: Not connected, Synced, N waiting, Offline. | Six states: adds Wrong key and Script is old (the plan lists these as failure states in C2 but not as pill states), plus a transient Syncing. | `SyncState` is a sealed type with seven cases. |
| C5 | "Reuse the colour tokens from `style.css`." | Tokens are replaced by `DESIGN_TOKENS.json`. No dynamic colour. | Theme task reads the JSON only. |
| C6 | Routes: home, capture, today, people, entity, content, search, review, settings. | Routes in brief section 5. `entity` splits into `person` and `item`. | Navigation graph follows the brief. |

## Things found while building (read before porting)

- **F1. The follow-up rule cuts names with titles.** `followUps()` in `app.js` splits notes on full stops, so "Ask Ms. Gamilah about WIDA sentence frames" becomes the follow-up "Ask Ms". The mockup protects `Ms.`, `Mr.`, `Mrs.` and `Dr.` so the whole phrase is highlighted. Task B4 says "port the regexes exactly". Decide whether Android fixes this (and the web app with it) or copies the bug for parity. Recommended: fix both, with a golden test.
- **F2. The sample follow-up list is shorter than the rule gives.** The brief lists 3 follow-ups. The same sample notes produce 6 under the real rule (it also catches "Ask how the interview goes", "Try the cardamom latte again" and "Bring the kit Monday"). The mockup shows 6, because the highlighter must match the rule.
- **F3. Sample numbers that could not all be true at once.** The brief says Priya was last met "4 days ago" and Ms. Gamilah "6 days ago", but also lists Priya under yesterday. The mockup works out "last met" from the entries (Priya yesterday, Ms. Gamilah 2 days ago). `perDay` was `[0,3,4,4,5,4,3]` but today has 4 entries and yesterday 3, so the mockup uses `[0,3,4,4,5,3,4]` (still 23). "6 people met" cannot be true with 5 sample people, two of them not seen this week: the week has 6 meetings with 3 people, so the tile says "meetings". The real app counts distinct people (`weekStats().people`); the label should be "people met" there.
- **F4. `star` in light fails 3:1.** `#D18A00` on `page` is 2.77:1. The mockup always prints the number next to the stars, so the rating never depends on the colour. If you want the glyphs to pass on their own, `#B37400` gives about 3.7:1 (open question Q3).
- **F5. `ok` is for dots only.** `#1B9E6A` on white is 3.4:1, fine for a dot and too light for 11 sp text. The mockup writes "Synced 4:12" in `ink2` with a green dot. Never set words in `ok`.
- **F6. The 48 dp rule and chips.** Chips are 34 dp tall. In Compose use `Modifier.minimumInteractiveComponentSize()` or a 48 dp touch wrapper. Chip rows need 14 dp vertical gaps so touch areas do not overlap.
- **F7. Font scale needs a second layout, not just bigger text.** At 200% the entry row cannot keep a time column. See `fontScale` in the tokens: at 1.5 and above the time moves above the entry and stat tiles stack.
- **F8. Nudge badge.** The brief does not define the count. The mockup counts people to reach out to (2), not follow-ups, so the badge can reach zero. Follow-ups have their own count on the Open loops chip (open question Q1).

## Screens

State types are proposals for the ViewModel's `UiState`. Derived data comes from `:core` (tasks B2 to B5). Task IDs are from `docs/ANDROID_APP_TASKS.md`; M-numbers are the Margin tasks in the build plan.

| # | Screen (route) | Composable | ViewModel state | Tasks | Screenshots |
|---|---|---|---|---|---|
| 1 | Feed (`feed`) | `FeedScreen` | `FeedUiState(filter, sync: SyncState, week: WeekCard?, days: List<DayGroup>, openLoopCount, peopleCount, isEmpty, isRefreshing)`; `DayGroup(date, title, entries: List<EntryUi>)`; `EntryUi(id, time, kind, title, link: Ref?, label, note: AnnotatedNote?, stars, followUp: FollowUpState, isNewest)` | M4, D3, B2, B4 | `01-*`, `03-feed-thoughts`, `03-feed-places`, `03-feed-loops` |
| 2 | Feed, People (`feed?filter=people`) | `FeedScreen` with `PeopleList` | `PeopleListState(sort: PeopleSort, rows: List<PersonRowUi>)`; `PersonRowUi(ref, name, initials, metCount, lastMetLabel, noteCount, status: PersonStatus, months: List<Int>)` | M5, D4 list, B4, B5 | `02-feed-people` |
| 3 | Feed, Things (`feed?filter=things`) | `FeedScreen` with `ThingsList` | `ThingsListState(category, categories, sort: ThingSort, rows: List<ThingRowUi>)`; `ThingRowUi(ref, title, category, entryCount, lastLabel, stars, stoppedAt)` | M5, D5 | `03-feed-things` |
| 4 | Search (`search?q=`) | `SearchScreen` | `SearchUiState(query, recent: List<String>, themes: List<ThemeChip>, people: List<PersonChip>, things: List<ThingChip>, entries: List<EntryUi>, count)` with match ranges in `AnnotatedNote` | M6, D7 | `04-*` |
| 5 | Nudges (`nudges`) | `NudgesScreen` | `NudgesUiState(reachOut: List<NudgeUi>, followUps: List<FollowUpUi>, suggestions: List<SuggestionUi>, sync)`; `NudgeUi(ref, name, reason, status, draft)`; `FollowUpUi(key, text, source, whenLabel, done)`; `SuggestionUi(title, why, actionLabel, action)` | M7, D3, D4, B4, B5 | `05-*` |
| 6 | New speed dial (`capture`) | `NewSpeedDial` over the current tab | `expanded: Boolean` in the shell | M3, D2 | `06-speed-dial` |
| 7 | Met someone (`capture/met`) | `CaptureMetScreen` | `CaptureMetState(nameText, parse: ParseResult(activity, person: Ref?, isNew), matches: List<PersonChip>, note, isDictating, whenChoice, customWhen, moreOpen, place, recentPlaces, remind: RemindChoice, nextReminderLabel, sync, nameError)` | M8, D2, B3, B5, C1, C2 | `07-*` |
| 8a | A thought (`capture/note`) | `CaptureThoughtScreen` | `CaptureThoughtState(note, about: Ref?, aboutOptions, noteError)` | M8, D2 | `08-capture-thought` |
| 8b | Went, ate, did (`capture/any`) | `CaptureDidScreen` | `CaptureDidState(name, suggestions, kind, customKind, stars, note, nameError)` | M8, D2 | `08-capture-went` |
| 8c | Watched, listened, read (`capture/media`) | `CaptureMediaScreen` | `CaptureMediaState(kind, query, results: CatalogState)`; `CatalogState = Idle, Loading, Results(list), NoResults, NoTmdbKey, Offline, NoCatalog` | M8, D2 | `08-capture-media*` |
| 8d | Rate it (`capture/media/rate`) | `CaptureRateScreen` | `CaptureRateState(picked: CatalogItem, stars, note)` | M8, D2 | `08-capture-rate` |
| 9 | Person (`person/<ref>`) | `PersonScreen` | `PersonUiState(header(name, initials, firstLogged, metCount, status), usualGapDays, sinceDays, openFollowUps: List<FollowUpUi>, reminder: ReminderUi(intervalDays?, dueDate?, pastDays?, snoozedUntil?, retired), months: List<Int>, draft, topics, places: List<PlaceCount>, timeline: List<EntryUi>)` | M9, D4, B4, B5, A2 | `09-*` |
| 10 | Item (`item/<ref>`) | `ItemScreen` | `ItemUiState(title, category, entryCount, stars, sinceDays, stoppedAt, timeline)` | M9, D5 | `10-*` |
| 11 | Review (`review`) | `ReviewScreen` | `ReviewUiState(story, tiles: List<StatTile(value, label, before)>, themes: List<ThemeUi(word, trend, count, who, share)>, grid: List<DayCount>, categories: List<CategoryCount>, notices: List<Notice>, taste: List<Taste>, streakDays, openFollowUps)` | M10, D6, B4 | `11-review` |
| 12 | Today (`today/<date>`) | `DayScreen` | `DayUiState(date, title, relativeLabel, entries, hasNext, pickerOpen, daysWithEntries)` | M10, D6 | `12-*` |
| 13a | Account sheet (`account`) | `AccountSheet` | `AccountUiState(sync, queueCount, entryCount, remindersSummary)` | M3, C2 | `13-account*` |
| 13b | Settings (`settings`) | `SettingsScreen` | `SettingsUiState(sync, url, keyMasked, tmdbMasked, entryCount, queueCount, lastSync, version, error: ConnectionError?)` | M11, D8, C3, E3, E4 | `13-settings*` |
| 13c | Reminders (`settings/reminders`) | `RemindersScreen` | `RemindersUiState(notificationsAllowed, checkTime, people: List<ReminderRow>)` | M11, D10 | `13-reminders` |
| 13d | Connect (`connect`) | `ConnectScreen` | `ConnectUiState(pasteOpen, link, scanning, error: ConnectionError?)` | M11, C3 | `13-connect*` |
| 14a | Reminder notification | `ReminderNotification` (a `NotificationCompat` builder, not a composable) | `ReminderPayload(ref, name, sinceDays, intervalLabel)` | M12, D10 | `14-notification` |
| 14b | Widget 4 × 2 | `LogbookWidget` (Glance) | `WidgetState(todayCount)` | M12, D9 | `14-widget` |
| 14c | Launcher shortcuts | `shortcuts.xml` | none | M12, D9 | `14-shortcuts` |
| 15 | Tablet, Feed with Person | `AdaptiveShell` (`NavigationSuiteScaffold` + `ListDetailPaneScaffold`) | shell holds `selectedRef` | M3 | `15-tablet-feed-person` |

Sheets and menus that hang off these screens: reminder interval, rename, merge into, remove entry, disconnect, clear local copy, show QR, scan QR, pick date and time, sort menus, snooze menu, person and item overflow menus. Each is in the mockup; use the index panel or the buttons to reach them.

## Components

One composable each, in `ui/components/`, with a `@Preview` in light and dark. Names match `data-component` in the mockup. The gallery (`#components`) shows them all.

| Component | Proposed parameters |
|---|---|
| `LbTopBar` | `sync: SyncState, onSearch, onAccount` |
| `LbSearchField` | `query, onQueryChange, focused, onBack?, onClear?` |
| `LbAvatarButton` | `initial, sync: SyncState, onClick` (content description includes the sync words) |
| `LbSyncPill` | `state: SyncState` |
| `LbSyncStrip` | `state: SyncState, message, action?: Pair<label, onClick>` |
| `LbFilterChip` | `label, selected, count?: Int, onClick` |
| `LbChip` | `label, selected = false, leadingIcon?, count?, onClick` |
| `LbButton` | `label, style: Primary, Outline, Needs, Danger; icon?, enabled, fullWidth, onClick` |
| `LbStatusTag` | `status: PersonStatus` (OnTrack, New, Noted, Slipping, Quiet, ReminderDue, Snoozed) |
| `LbKindTile` | `tile: KindTile, icon, size = 30.dp` |
| `LbDayHeader` | `title, subtitle?, count` |
| `LbEntryRow` | `entry: EntryUi, context: Feed, Timeline, Search; onOpen, onFollowUpToggle, onLongPress?` |
| `LbHighlight` | not a composable: a `SpanStyle` builder that paints `mark` behind ranges of an `AnnotatedString`; struck through when done |
| `LbFollowUpTag` | `done, onToggle` |
| `LbStarRating` | `stars: Float` (always prints the number) |
| `LbStarInput` | `value: Float, onChange` (tap, drag, minus and plus, slider semantics) |
| `LbWeekCard` | `entries, before, perDay: List<Int>, summary, themes, onOpen` |
| `LbMiniBars` | `values: List<Int>, contentDescription` |
| `LbPersonRow` | `row: PersonRowUi, onClick` |
| `LbThingRow` | `row: ThingRowUi, onClick` |
| `LbNudgeCard` | `nudge: NudgeUi, onOpen, onText, onSnooze(days), onMetNow` |
| `LbFollowUpRow` | `followUp: FollowUpUi, onToggle` |
| `LbSuggestionCard` | `suggestion: SuggestionUi, onAction` |
| `LbField` | `label, value, onValueChange, error?, multiline, leadingIcon?, trailing?, keyboardOptions` |
| `LbParseLine` | `result: ParseResult` (live region) |
| `LbSaveBar` | `note, primary, secondary?` (pinned, moves with the keyboard) |
| `LbCatalogResult` | `item: CatalogItem, onPick` |
| `LbStatTile` | `value, label, emphasis = false` |
| `LbMonthBars` | `months: List<Int>` |
| `LbReminderCard` | `reminder: ReminderUi, onChange, onSnooze(days), onBringBack` |
| `LbDraftCard` | `draft, onSend, onCopy` |
| `LbThemeRow` | `theme: ThemeUi, onClick` |
| `LbMeter` | `fraction, color = cobalt` |
| `LbActivityGrid` | `days: List<DayCount>, onDayClick` |
| `LbCategoryBar` | `label, count, fraction, color` |
| `LbCalendar` | `month, selected, daysWithEntries, maxDate, onPick` (or Material 3 `DatePicker` themed to match) |
| `LbSettingsRow` | `title, subtitle?, leadingIcon?, onClick` |
| `LbEmptyState` | `tile, icon, title, text, action?` |
| `LbBottomNav` | `selected: Tab, nudgeCount, onSelect` |
| `LbNavRail` | same, for 600 dp and wider |
| `LbNewButton` | `expanded, onClick` |
| `LbSpeedDial` | `onPick(kind), onDismiss` |
| `LbSheet` | `title, onDismiss, content` (bottom sheet on phones, dialog on tablets) |
| `LbMenu` | `items: List<MenuItem>, onDismiss` |
| `LbSnackbar` | `message` |
| `LbWidget`, `LbShortcutMenu`, `LbReminderNotification` | platform surfaces, see screens 14a to 14c |

## What was checked, and what was not

Checked in headless Chromium on 15 Nov 2026:

- All 48 screens and states render in light and dark at 360 × 800 and 411 × 914 with no console errors.
- The script found no cut-off text and nothing past the right edge on any screenshot, including the three at 200% text.
- I looked at contact sheets of the screenshots and fixed what I saw: time labels wrapping in the margin, a line break in the week card, the star picker wrapping, a parse line overlapped by chips at 200%, and the avatar samples overflowing in the gallery.
- Contrast: every text pair passes 4.5:1 in both themes. Kind tile glyphs pass 3:1. One failure: `star` in light (see F4).
- All six sync states, plus Syncing, are reachable from the panel and change the avatar dot, the strip under the search field, the account sheet, Settings and Connect.

Not checked, and not claimed:

- Nothing ran on an Android device or emulator. Insets, the real keyboard, TalkBack, the system font scale, notification and widget rendering, and battery behaviour are untested.
- The fonts come from Google Fonts in the browser. Bundled font metrics in Compose can differ by a pixel or two.
- Touch target sizes are drawn to the rule but were not measured element by element.
- The mockup's logic is a stand-in for `:core`. Do not copy its JavaScript as the behaviour spec. `app.js` at the repo root is the spec.
- Long press was tested with a mouse only.

## Open questions for the user

1. **Nudges badge.** Count people to reach out to (mockup), or people plus open follow-ups? (M7)
2. **Follow-up rule.** Fix the "Ask Ms" cut in both the web app and Android, or keep them identical to today? (B4)
3. **Star colour in light.** Keep `#D18A00` with the number beside it, or darken to about `#B37400`? (theme)
4. **Avatar letter.** The mockup shows "J". Should it be an initial you set in Settings, or just a person icon? (M3)
5. **Custom reminder interval.** The mockup offers Off, 1 week, 2 weeks, 4 weeks, 2 months and Custom. Is a number-of-days field enough for Custom? (M9, A2)
6. **"A while back".** The web app's Home shows an entry from a month, three months or a year ago. Margin has no slot for it. Put it at the bottom of Review, or drop it? (M10)
7. Still open from the plan: phone model and Android version, the deployed Apps Script text, whether the Sheet is under a school account, package name and app name.
