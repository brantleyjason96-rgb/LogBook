# Brief: full interactive mockup of Logbook for Android ("Margin" direction)

Paste this whole file into a new session. It is written for one agent to follow end to end.

## 0. What to produce

Build a **clickable, full-fidelity mockup** of the Logbook Android app in the "Margin" visual direction. It is a design artifact, not the app. It will later be turned into a Jetpack Compose app in Android Studio by other agents, so structure it for that handoff.

Write everything under `android/design/margin/`. Do not modify the PWA (`app.js`, `index.html`, `style.css`, `sw.js`) or the watch app.

Deliver:

1. `index.html` plus any `css/` and `js/` files. A single page that shows the app in a 360 × 800 dp phone frame (1 dp = 1 CSS px). It works with no build step and no network except Google Fonts. Every screen in section 6 is reachable by tapping, with hash routes that match the Android routes in section 5.
2. A **light and dark** toggle that changes the whole app (system, light, dark).
3. An **Offline** toggle that switches the sync pill and the queue states (section 7) so each state can be seen.
4. `DESIGN_TOKENS.json`: colours (light and dark), type, shape, spacing, motion.
5. `HANDOFF.md`: for each screen, the Compose composable name, the ViewModel state it needs, the plan task IDs it covers, and any open question. Also the component list with proposed parameters.
6. `screens/`: PNG screenshots of every screen, light and dark, at 360 × 800 and also at 411 × 914, plus one at 200% font size for the Feed, Person and Capture screens.

Do not write Kotlin. Write the HTML so that each reusable piece is a clearly named component (`data-component="LbEntryRow"`), because each will become one composable.

## 1. Read these first

- `docs/ANDROID_APP_TASKS.md` on branch `origin/claude/blissful-tesla-bhfpyg`. This is the build plan. The **Decisions** section is locked, so do not re-argue it. This brief changes the navigation and the visuals (plan tasks D1 to D8), and nothing else.
- `app.js` on `main`. This is the behaviour spec. Section 9 lists the rules you must respect. Read `viewHome`, `viewReview`, `viewPerson`, `viewCapture`, `flowHtml`, `cadenceOf`, `followUps`, `suggestions`, `checkInDraft`.
- `style.css` on `main`. The old tokens. They are replaced by section 4, but note how the categories are coloured.

If a file is missing, say so and continue from this brief.

## 2. The app in one paragraph

Logbook is a personal log of what you did and who you saw. You capture four kinds of entry: **met someone**, **a thought**, **went, ate, did**, and **watched, listened, read**. The app turns the log into a daily feed, a person page for each contact (how often you meet, what you talk about, open follow-ups, a check-in draft), a weekly review, and reminders to contact people. It works offline and syncs to a Google Sheet. The user is a teacher and grad student. No student data is ever entered. Use made-up sample data only (section 8).

## 3. Design direction: Margin

One chronological feed, like a notebook with a wide margin. **People and things are filters on the feed, not separate destinations.** Search is always visible. Follow-up phrases are highlighted in the text where they were written. Calm, sharp, confident: white page, ink text, one cobalt accent, one coral for "needs you", and a yellow highlighter.

Rules that define the look:

- Time stays in the left margin. Content sits to its right. Dates are in a serif display face.
- Each entry has a small rounded-square icon coloured by kind (person, thought, media, place, book).
- The highlighter is used only for follow-up phrases and for search matches. Nothing else is yellow.
- Coral means "needs action" (reminder due, follow-up, the New button). Cobalt means "navigation and primary action".
- Large numbers and dates use the serif. Everything else uses the sans.
- Avoid shadows. Use 1 dp hairlines and tonal fills. The New button is the only element with a shadow.
- Do not use Material You dynamic colour. The palette is fixed.

## 4. Tokens

Colours (light / dark):

| Token | Light | Dark | Use |
|---|---|---|---|
| `page` | #FBFBFD | #0D0F1A | Screen background |
| `panel` | #FFFFFF | #151828 | Nav bar, sheets, fields on a page |
| `ink` | #0F1222 | #ECEEF8 | Primary text, selected chip |
| `ink2` | #464B63 | #B5BAD0 | Secondary text |
| `mute` | #62677D | #8D93AB | Meta text, inactive icons |
| `line` | rgba(15,18,34,.11) | rgba(236,238,248,.12) | Hairlines |
| `cobalt` | #2B50F5 | #8FA3FF | Accent, links, active tab, week card |
| `onCobalt` | #FFFFFF | #0D1233 | Text on cobalt |
| `soft` | #EDF0FF | #1D2340 | Search field, active tab pill |
| `coral` | #D63B1F | #FF7A5E | Needs-you: New button, reminder due, follow-up tag |
| `onCoral` | #FFFFFF | #2A0C05 | Text on coral |
| `mark` | #FFE35C | rgba(255,227,92,.28) | Highlighter. Text stays `ink` |
| `ok` | #1B9E6A | #52D49B | Synced dot |
| `warn` | #8A5A00 | #F0B84A | Slipping, waiting |
| `star` | #D18A00 | #F0B84A | Ratings |

Kind icon tiles (background / glyph), light then dark:

- Person: #FFE1D9 / #A8321B, then #3A1F1A / #FF9C85
- Thought: #E6EAFF / #2B50F5, then #1F2750 / #9DB0FF
- Media (movie, TV, podcast, music): #E3F4EA / #146C47, then #14301F / #6FD3A0
- Place (went, ate, did): #FFF1C2 / #7A5A00, then #3A3012 / #F0CC5C
- Book and recipe: #F0E6FF / #6A3FC4, then #2B2048 / #C3A8FF

Type (bundle the fonts in the APK later):

- Display: **Instrument Serif** 400. Day headers 26 sp, big numbers 44 sp, screen titles 32 sp.
- Text: **Plus Jakarta Sans** 400, 500, 700. Title 15 sp / 700, body 14 sp, label 12 sp / 500, nav label 11 sp / 500.
- Meta: **DM Mono** 400 and 500. Times, counts, route-like labels, 11 sp.

Shape and spacing: 4 dp grid. Screen margins 14 dp. Cards 20 dp radius. Chips 17 dp (34 dp tall, 48 dp touch area). Buttons 20 dp. Field 24 dp (search) or 12 dp (forms). Icon tiles 9 dp radius. Hairline 1 dp.

Motion: 200 ms standard ease for chip and tab changes. 300 ms for the New speed dial (scale and fade, items staggered 30 ms). A filter chip change cross-fades the feed in 150 ms. Respect reduced motion by removing all of it.

## 5. Navigation and routes

Bottom navigation, three tabs: **Feed**, **Nudges** (with a count badge), **Review**. A floating **New** button sits above the nav on Feed, Nudges and Review.

Top of every tab: a permanent **search field** and an **avatar button** (a green dot on the avatar means synced). The avatar opens a sheet with sync status, Settings, Reminders and Disconnect.

Feed filter chips (a row under the search field): All, People, Things, Thoughts, Places, Open loops. The chip changes what the Feed shows. It does not change tab.

Routes (use these as hash routes):

```
feed                  feed?filter=people|things|thoughts|places|loops
search?q=<text>
nudges
review
today/<yyyy-mm-dd>    (the Feed scrolled to a day, with a date picker)
capture               (the New speed dial)
capture/met  capture/note  capture/any  capture/media  capture/media/rate
person/<ref>          item/<ref>
account               (avatar sheet)
settings   settings/reminders   connect (first run)
```

The system back button goes up one level. It never asks to discard a draft (the plan says cancel keeps no draft).

## 6. Screens to build

Build every screen below, in both themes. For each, show the states listed.

1. **Feed** (`feed`). Top: search field and avatar. Chip row. A cobalt **week card** (big serif entry count, "up from 19", a 7-day bar chart, themes as small pills). Then day headers (`Today`, `Yesterday`, then dates) in serif, each with its entries. An entry is: time in the left margin, kind tile, title in bold (people are cobalt links), kind label, optional note with highlighter on follow-up phrases, and a coral outlined **Follow-up** tag with a checkbox that marks it done. Newest entry of the day has a small coral tick left of its time. States: loaded, empty (first run, "Nothing logged yet"), offline (pill), syncing.
2. **Feed, People filter.** Same screen. The list becomes people: avatar, name, "met 6 times, last today", a status tag (`Slipping` amber, `Reminder due` coral outline), sort menu ("Seen recently, Not seen longest, Most often, A to Z"), 12-month mini bars on the right. Tap opens Person.
3. **Feed, Things filter.** Same pattern for media and places: category chips under the filter, dot or tile by category, title, half-star rating, meta. Sort: recent, highest rated, A to Z. Tap opens Item.
4. **Search** (`search`). The field is focused with the keyboard up. Below it: people matches as chips, then matching entries with the typed word on the highlighter, and a count ("5 entries"). Empty query shows recent searches and the themes from the Review. States: results, no results, empty query.
5. **Nudges** (`nudges`). Three sections. **Reach out**: cards for people who need contact, each with the reason (`Reminder every 4 weeks, 6 days past` or `Slipping, 29 days`), a short draft message, and buttons Text, Snooze (menu: 1 week, 1 month), Met just now. **Follow-ups**: checkbox rows, with who and when. **Looks like right now**: dashed suggestion cards ("Met Priya? You often see Priya on Sundays around 4 PM", Log it). Empty state: "You are all caught up."
6. **New speed dial** (`capture`). The New button becomes a close button. A scrim covers the screen. Four labelled actions stack above it: **Met someone**, **Watched, listened, read**, **Went, ate, did**, **A thought**. Each opens its flow.
7. **Capture: Met someone** (`capture/met`). Full screen, no nav. Close button, title, offline pill when relevant. Name field. A one-line **Reading this as** check ("coffee with Maria" gives `coffee` and `Maria Alvarez`). Person chips. Note field with a dictation button. **When** chips (Just now, Earlier today, Yesterday, Pick date and time). A **More details** section with Place (with recent-place chips) and **Remind me every** chips (Off, 1 week, 2 weeks, 1 month, Custom). A pinned bottom bar: "Saved to this phone first. It syncs when you are online." and **Save**. Also draw the keyboard-open state.
8. **Capture: Thought, Went/ate/did, Watched/listened/read.** Same frame. Thought: note and an optional "About" picker. Went: name, kind chips (restaurant, coffee, place, event, custom), rating, note. Media: kind chips, title search with results and a source tag (TMDB, iTunes, Open Library, TheMealDB), **Add as typed**, then **Rate it** (`capture/media/rate`): half stars by tap or drag with minus and plus buttons, note, **Save** and **Just log it**. Empty states: no TMDB key (with a button to Settings), no results, offline.
9. **Person** (`person/<ref>`). Header with avatar, name, first logged, times met, status tag. Three stats (usual gap, since last met, open follow-ups). Buttons: Met just now, Add a note, Message (opens the phone's text app with the draft). A **Reminder** card (interval, due date, Change, Snooze 1 week, Snooze 1 month) and Retire in the overflow menu. 12-month bar chart. **Check-in draft** with Send as text and Copy. Topics as chips (open Search). Open follow-ups. **Where you meet** place chips with counts. A timeline in the same entry style as the Feed. Overflow menu: Rename, Merge into, Retire, Remove entry (long-press an entry).
10. **Item** (`item/<ref>`). The Person screen without cadence, reminder or draft: title, category badge, stats, Rename, Merge into, and the timeline.
11. **Review** (`review`). Title "Your week". The week story in serif. Four stat tiles with last week for comparison. Themes with trend pills (New, Rising, Steady, Fading) and meters. A 12-week activity grid. Category bars for 30 days. "Worth noticing". Taste by category with a meter. Streak and open follow-ups.
12. **Today** (`today/<date>`). The Feed scrolled to a date, with a date picker button in the top bar and previous and next day arrows.
13. **Account sheet, Settings, Reminders, Connect.** The avatar sheet shows `Synced 4:12`, `2 waiting`, Sync now, and links. **Settings** has URL, key (masked), TMDB key, Save and test, Scan QR, setup link and QR for a second phone, This device (entries, queue, last sync, Clear local copy), Privacy, Version, Disconnect. **Reminders** has the notification permission, the daily check time, and battery-optimisation steps. **Connect** (first run) is a full screen with Scan QR, Paste link, and nothing else. Also draw the error states: wrong key and old script.
14. **Outside the app.** A reminder notification (title, body, actions Open, Snooze a week, Mark contacted), a 4 × 2 home-screen widget (Met, Rate, Did, Note buttons and a "3 today" count), and the launcher shortcut menu.

## 7. Sync states

The sync pill lives on the avatar and in the account sheet. Show all of: `Not connected`, `Synced 4:12`, `2 waiting`, `Offline`, `Wrong key`, `Script is old`. The Offline toggle in the prototype must drive these.

## 8. Sample data (use only this)

Today is Sunday, 15 November 2026, 4:12 PM.

```json
{
  "people": [
    {"ref":"n:maria-alvarez","name":"Maria Alvarez","met":6,"last":"today","status":"on track"},
    {"ref":"n:priya-nair","name":"Priya Nair","met":9,"last":"4 days ago","status":"on track"},
    {"ref":"n:ms-gamilah","name":"Ms. Gamilah","met":7,"last":"6 days ago","status":"on track"},
    {"ref":"n:dev-patel","name":"Dev Patel","met":11,"last":"29 days ago","status":"slipping","usualGapDays":14},
    {"ref":"n:dr-okafor","name":"Dr. Okafor","met":14,"last":"34 days ago","status":"slipping","usualGapDays":21,"remindDays":28,"dueDaysPast":6}
  ],
  "things": [
    {"ref":"m:past-lives","title":"Past Lives","cat":"movie","stars":4.5},
    {"ref":"b:braiding-sweetgrass","title":"Braiding Sweetgrass","cat":"book","stars":4,"stoppedAt":"chapter 7"},
    {"ref":"t:severance","title":"Severance","cat":"tv","stars":null},
    {"ref":"x:hazels-coffee","title":"Hazel's Coffee","cat":"coffee","stars":4}
  ],
  "today": [
    {"t":"3:50 PM","kind":"met","who":"Maria Alvarez","place":"Lakeside Park","note":"Walked the lake loop. She is applying for the instructional coach job. Ask how the interview goes."},
    {"t":"12:30 PM","kind":"note","note":"Ask Ms. Gamilah about WIDA sentence frames for the plate tectonics unit."},
    {"t":"11:05 AM","kind":"rated","title":"Past Lives","stars":4.5},
    {"t":"9:40 AM","kind":"went","title":"Hazel's Coffee","note":"Grading done early. Try the cardamom latte again."}
  ],
  "yesterday": [
    {"t":"8:40 PM","kind":"logged","title":"Severance"},
    {"t":"1:15 PM","kind":"met","who":"Priya Nair","place":"farmers market","note":"She wants to borrow the soil sample kit. Bring the kit Monday."},
    {"t":"9:05 AM","kind":"logged","title":"Braiding Sweetgrass","pos":"ch. 7"}
  ],
  "week": {"entries":23,"before":19,"peopleMet":6,"rated":4,"avgStars":4.1,"streak":6,
           "perDay":[0,3,4,4,5,4,3],
           "themes":[["rubric","Rising",5],["maps","New",3],["thesis","Steady",3],["tired","Fading",2]]},
  "followUps": [
    "Ask Ms. Gamilah about WIDA sentence frames for the plate tectonics unit",
    "Send Dr. Okafor the lit review outline",
    "Book the bus for the field trip"
  ],
  "checkInDraft":"Hi Dr. Okafor, it has been about 5 weeks since we caught up. Last time we talked about tightening the second-language acquisition section. How is that going? I still want to send you the lit review outline."
}
```

## 9. Behaviour rules to respect (from `app.js`)

- **Person status:** `On track`, `Slipping` (since last meeting is more than max(14, 1.6 × usual gap)), `Quiet` (more than max(45, 3 × usual gap)), `New`, `Noted`. An explicit reminder interval overrides the inferred gap. A reminder is due at last meeting plus interval, is paused by Snooze, and is gone when Retired. Meeting again resets it with nothing stored.
- **Follow-ups** are found in notes (last 60 days) by lead words such as ask, send, email, call, text, bring, check, book, schedule, finish, thank, and phrases such as "need to", "have to", "remember to". Show only the matched phrase.
- **Suggestions** ("Looks like right now"): a person you usually meet at this weekday and hour (within an hour, at least twice in 12 weeks), the item to resume, and the most overdue person.
- **Check-in draft** is written from the last note and the oldest open follow-up. It is never sent by the app. The Message button opens the phone's text app.
- **Ratings** are half stars from 0.5 to 5.
- **Refs** (`n:`, `x:`, `m:`, `t:`, `p:`, `a:`, `s:`, `b:`, `r:`) are internal ids. Never show them.
- **Capture** always saves locally first. Cancel keeps no draft.
- **Week** compares the last 7 days with the 7 before. **Themes** compare this week's words with the four weeks before.

## 10. Accessibility and platform

- Every target is at least 48 × 48 dp. Chips are 34 dp tall with extra touch padding.
- Text meets contrast 4.5:1 in both themes. Check `coral`, `cobalt`, `mute` and the highlighter on `page` and `panel`. Never rely on colour alone: a status always has a word, and a kind always has an icon.
- All sizes are in sp-equivalents and the layouts survive 200% font. Cards grow, rows wrap, nothing clips.
- Every icon button and every unlabeled control has an accessible label. Star ratings can be set with minus and plus.
- Support edge-to-edge with system bar insets, the gesture bar, and a keyboard that resizes the screen.
- Tablets and foldables (over 600 dp): list and detail side by side. Draw one tablet frame for Feed with Person.

## 11. How to work

1. Read the sources in section 1. Write down in `HANDOFF.md` anything in this brief that conflicts with the plan, and follow this brief for visuals and navigation.
2. Build `DESIGN_TOKENS.json` and a component gallery page first (colours, type, chips, buttons, entry row, nudge card, field, nav, sheet, pill). Check it in both themes.
3. Build the screens from the components. Do not hand-style a screen.
4. Make every screen reachable and every button do something visible (open a screen, toggle a state, show a snackbar).
5. Open the result in a headless browser. Screenshot every screen in both themes at 360 × 800 and 411 × 914, and the three screens at 200% font. Look at the screenshots and fix clipping, overlap and contrast before you say it is done.
6. Report what you verified and what you could not. Do not claim the behaviour of a real Android device.

## 12. Done when

- All 14 groups in section 6 exist, in light and dark, reachable by tapping.
- The Offline toggle shows all six sync states.
- No text is clipped at 200% font. Contrast is checked for the tokens above.
- `HANDOFF.md` lists a composable, state and task IDs for every screen.
- The folder contains no secrets and no real names.

## 13. Handoff to Android Studio (for later)

The next step, outside this brief: a coding agent creates the Compose app from `android/design/margin/`. The mapping it will use:

- `DESIGN_TOKENS.json` becomes `ui/theme/Color.kt`, `Type.kt` and `Shape.kt`, with a `LogbookColors` object for the extra roles (coral, mark, kind tiles) and a Material 3 `ColorScheme` for the rest (`primary = cobalt`, `onPrimary = onCobalt`, `surface = panel`, `background = page`, `onSurface = ink`, `outline = line`, `tertiary = coral`).
- Each `data-component` becomes one `@Composable` in `ui/components/`, with a `@Preview` in both themes.
- Each screen becomes a composable plus a ViewModel, per the plan's task D1 to D8. Routes match section 5.
- Package `app.logbook`, `minSdk 26`, `targetSdk 35` (still to be confirmed by the user).
- Build the app module in CI or Android Studio. The container has no Android SDK.
