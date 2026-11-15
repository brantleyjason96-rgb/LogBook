# Logbook visuals: the Margin plan

This is the plan for keeping the Android app visually faithful to the Margin
direction: what the direction commits us to, what the build actually does
today, and what is left to close the gap.

Read first: `docs/ANDROID_DESIGN_BRIEF_MARGIN.md` (the direction),
`android/design/margin/HANDOFF.md` (per-screen mapping), and
`docs/ANDROID_BUILD_PLAN_MARGIN.md` (milestones M1 to M12). The brief and the
handoff already say what the app should look like. This file does not repeat
them; it works out where the build has drifted from them and how each drift
gets closed and stays closed.

**Status:** the direction is implemented in broad strokes — the palette, the
type, the shape, the three tabs, the speed dial and the sheets are all in the
app today. This plan covers the residual drift, plus the visual claims the
build currently makes that nothing checks.

**Done so far (15 Nov 2026):** V1 and V2. `ThemeDriftTest` compares the theme
with `DESIGN_TOKENS.json` and fails on a one-digit colour change or a one-dp
radius change; every component now has light, dark and 200% previews, and the
gallery renders them behind a debug-only Settings row.

The two shell smoke tests now pass; both were red on `main` before this work.
The Connect screen also regained its "Logbook" wordmark at `displayHero`, which
is the one use the tokens define for that style (`screens/13-connect_*`).

**Next:** V3 (Roborazzi baselines) turns the previews into images CI compares.
Until then none of these screens has actually been rendered — they are compiled,
not seen — so the first look at the gallery is still owed to a human eye.

## 1. What this plan is, and what it is not

**Is:** the source of truth for colour, type, shape, spacing, motion, the
highlighter, and the handful of layout rules that break at 200% font or on a
tablet — and the tests that keep them true.

**Is not:** a redesign, a place to re-argue the direction, or a behaviour plan.
Sorting, sync, the outbox, follow-up rules and the Sheet contract belong to
`docs/ANDROID_BUILD_PLAN_MARGIN.md` and `docs/ANDROID_APP_TASKS.md`. If a change
here alters behaviour, it is in the wrong document.

The optional model layer (`docs/LOCAL_AI_PLAN.md`) adds no new visual
vocabulary. Its screens are built from the components below. Anything the
model adds is labelled "on this phone" in the existing label style, and nothing
it produces gets a colour of its own.

## 2. Sources of truth, in order

When two of these disagree, the earlier one wins:

1. **`android/design/margin/DESIGN_TOKENS.json`** for every number: colour,
   size, radius, duration, font scale rule. It is machine-readable on purpose,
   so a test can compare against it (see V1).
2. **The design brief** for the rules a number cannot express: time in the left
   margin, the highlighter used for nothing but follow-ups and search hits,
   coral means "needs action", no shadows except the New button, no dynamic
   colour.
3. **`android/design/margin/screens/`** (202 PNGs) as the record of what the
   direction looked like when it was drawn. Not a pixel target — see section 7.
4. **`android/design/margin/HANDOFF.md`** for which composable draws which
   screen and which state it needs.
5. **`app.js`** at the repo root for behaviour, never for looks.

## 3. The direction, as enforceable rules

Eight rules, each one checkable by looking at one screenshot:

1. Time sits in the left margin; content sits to its right. Dates are set in the
   serif display face.
2. Every entry carries a rounded-square kind tile, coloured by kind, never by
   importance.
3. The yellow highlighter appears on follow-up phrases and search hits, and
   nowhere else.
4. Coral marks what needs the user: the New button, a due reminder, a follow-up
   tag. Cobalt marks navigation and the primary action. Nothing else is either.
5. Serif for dates and big numbers; sans for everything else; mono for times,
   counts and route-like labels.
6. Hairlines and tonal fills instead of shadows and elevation. The New button is
   the only thing that casts one.
7. The palette is fixed. No Material You dynamic colour, in either theme.
8. Nothing is conveyed by colour alone: a status always carries a word, a kind
   always carries an icon.

## 4. Where the build stands

Checked in this checkout on 15 November 2026, by reading the source. Each row is
a claim about the app, not about the mockup.

| # | Expected | Actual today | Evidence | Severity |
|---|---|---|---|---|
| D1 | A test fails if Kotlin colour drifts from the tokens | **Closed by V1.** `ThemeDriftTest` compares 17 palette roles × 2 themes, 5 kind tiles × 2, the kind map, 18 Material roles, 12 radii, 11 type styles and 5 durations with the JSON | `app/src/test/.../ui/theme/ThemeDriftTest.kt` | ~~High~~ closed |
| D2 | A `@Preview` per component, light, dark, font scale 2.0 | **Closed by V2.** Every component but `LbSheet` is previewed three ways; the gallery shows them all in one scroll | `ui/components/Previews.kt`, `ui/components/Gallery.kt` | ~~High~~ closed |
| D3 | A screenshot test per component and screen | Roborazzi is on the test classpath; no screenshot test uses it | `app/build.gradle.kts:115-116`, `gradle/libs.versions.toml:72-73` | High — visual regressions are invisible |
| D4 | Chips are 34 dp tall inside a 48 dp touch area | The chip Surface itself is 48 dp, so the pill is 48 dp | `LbChip` uses `heightIn(min = MinTouchDp)` on the Surface | Medium — chips read as buttons, rows feel heavy |
| D5 | At font scale ≥ 1.5 the entry row stacks and stat tiles stack | Nothing reads the font scale | No `LocalDensity.current.fontScale` in `android/`; the entry row keeps a fixed 52 dp time column | High — 200% text will squeeze or clip |
| D6 | The highlighter is one shared component | It is a private helper in the Feed file, used only by the Feed | `ui/feed/Feed.kt:436` `highlighted(...)`; no other file calls it | Medium — Person timelines, Nudges and Search hits go unmarked |
| D7 | Feed chips: All, People, Things, Thoughts, Places, Open loops | Five chips; "Open loops" is missing | `ui/feed/Feed.kt:143-147` | Medium — the loops filter has no entry point on the Feed |
| D8 | Week card has a 7-day bar chart | A sentence ("N days active · N people met") stands where the chart goes | `WeekCard` in `ui/feed/Feed.kt:272` | Medium — the card is the Feed's one visual anchor |
| D9 | Themes in the week card are small static pills | They are `LbChip(t) {}` — tappable, 48 dp, and do nothing | `WeekCard`, chips built with an empty lambda | Medium — TalkBack announces a dead button |
| D10 | Speed dial labels use `panel` and `ink` | Hardcoded `Color.White` and a literal ink, so dark theme is off-palette | `ui/shell/Shell.kt:407` | Medium — the one place the palette is bypassed |
| D11 | Star input supports tap-half, drag, and 48 dp targets | Tap sets whole stars; there is no drag; icons are 34 dp | `LbStarPicker` in `ui/components/Basic.kt` | Medium — ratings land on whole stars and the targets are undersized |
| D12 | Bottom bar on phones, rail at 600 dp, list-detail for Feed + Person | A plain `NavigationBar` at every width; no rail, no list-detail | No `NavigationSuiteScaffold` or `ListDetailPaneScaffold` in `android/` | Medium — the tablet frame in `screens/15-*` has no counterpart |
| D13 | The search field on every tab is the real field | A `Surface` that looks like a field and opens the Search screen | `Header` in `ui/shell/Shell.kt` | Low — it reads correctly, it just is not what the brief describes |
| D14 | Entry row: kind label, coral tick on the newest entry, follow-up as a checkbox tag with strike-through | Kind tile plus a "Follow-up" chip; no kind label; no newest tick | `EntryRow` in `ui/feed/Feed.kt:295`; `LbEntryRow` and `LbFollowUpRow` in `Basic.kt` | Medium — the tag is the direction's main "needs you" signal |
| D15 | Reduced motion removes the animation | Every duration is a hardcoded `tween` | `LbMotion` in `ui/theme/Shape.kt` | Low — but it is an accessibility commitment |
| D16 | Account avatar is a set initial or a person icon | The word "Me" is drawn as initials | `Header` and `AccountSheet` in `ui/shell/Shell.kt` | Low — pending open question 4 |

Three of these (D1, D2, D3) are the reason the other thirteen are invisible: the
build has no way to notice that it drifted.

## 5. Tasks

Sizes as in the build plan: S is under half a day, M is about a day, L is
several days. Each task names the milestone it amends and how it is proven.

### V1: Make the theme test real — done

- Write `ThemeDriftTest` in `app/src/test`: parse `DESIGN_TOKENS.json` from the
  source tree, convert each colour, and assert against `Color.kt` —
  `LogbookColors`, both `ColorScheme`s, `kindToTile`, and the `LbShape` radii.
  Assert the type sizes in `Type.kt` while it is open.
- Parse the alpha-bearing tokens (`line`, `mark`, `scrim`) properly; they are
  `rgba()` in the JSON and packed `0xAARRGGBB` in Kotlin, and comparing them as
  strings would pass a wrong value.
- **Done when:** the test fails when any single colour or radius is edited by
  hand, and passes unmodified in CI.

### V2: Previews for every component — done

- Add `@Preview` to every public composable in `ui/components/`, each in light,
  dark and `fontScale = 2f`, grouped in a `ui/components/Previews.kt` (or beside
  each composable once the file is split).
- Add a debug-only gallery screen that renders them in one scroll, so the
  comparison against `screens/00-components_*.png` is a single look rather than
  a hunt through the IDE.
- **Done when:** every component in the `HANDOFF.md` table has a preview, and
  the gallery, in both themes, can be compared with the mockup's gallery by eye.

### V3: Screenshot baselines (M, after V2)

- Roborazzi is already on the classpath and unused. Record one baseline per
  screen and per component state named in the handoff, light and dark, at 360 ×
  800 and 411 × 914, plus 200% text for Feed, Person and Capture.
- Record against the *app*, not against the mockup: the PNGs in
  `screens/` are the reference for the first human comparison, and the app's own
  images become the regression baseline thereafter.
- Write the refresh rule into `android/README.md`: a baseline may only be
  re-recorded in a commit that also shows the new image, and a red screenshot
  test is never "fixed" by re-recording without saying why.
- **Done when:** CI fails on a one-pixel change to a chip radius, and the run
  reports which screen changed.

### V4: Chips, tags and touch targets (S, after V3)

- Separate the chip's painted height from its touch height: a 34 dp pill inside
  a 48 dp wrapper. Use `Modifier.minimumInteractiveComponentSize()` where it
  fits the row, otherwise a fixed touch wrapper. Row gaps of 14 dp so touch
  areas do not overlap (handoff F6).
- Rebuild the follow-up tag as the brief draws it: coral outline, checkbox that
  fills when done, the phrase struck through once done.
- Raise the star glyphs to 48 dp touch targets without drawing them bigger, and
  keep the number beside the stars so the rating never depends on colour alone.
- Make the week card's theme pills non-interactive: a pill, not a chip with an
  empty lambda.
- **Done when:** a TalkBack pass reads no dead buttons, and every target in the
  gallery measures at least 48 × 48 dp.

### V5: Font scale layouts (M, after V3)

- Read `LocalDensity.current.fontScale` once in the theme and expose the
  threshold decision (1.5 and above) through a small helper.
- At and above the threshold: move the time above the entry instead of beside
  it, stack the stat tiles, wrap chip rows instead of scrolling them, and let
  the person header's stats go to two columns.
- **Done when:** the 200% previews of Feed, Person, Capture and Nudges show no
  clipping, no overlap and no horizontal scroll, and the screenshot tests cover
  both scales.

### V6: One highlighter (S, after V3)

- Move `highlighted()` out of `ui/feed/Feed.kt` into `ui/components/` as
  `LbHighlight`, beside `LbFollowUpRow`. It stays a pure function returning an
  `AnnotatedString`: `:core` owns the ranges, the UI owns the paint, no regex in
  UI code.
- Use it on the Feed, the Person and Item timelines, the Nudges follow-up rows
  and the Search results. Add the struck-through style for a follow-up that is
  done.
- **Done when:** one definition exists, and every surface that shows a note with
  a follow-up paints the phrase.

### V7: Entry row and week card fidelity (M, after V4, V6)

- Entry row: the kind label under the title, the small coral tick beside the
  newest entry of the day, the follow-up tag from V4, and a hairline row rather
  than a bordered card if the mockup shows one (compare `screens/01-feed_*`).
- Week card: the seven-day bar chart from `perDay`, the big serif count, the "up
  from N" comparison the card already computes, and themes as static pills.
- **Done when:** a side-by-side of `01-feed` and the app's own screenshot
  differs only by font metrics and antialiasing.

### V8: Adaptive layouts (L, after V5)

- `NavigationSuiteScaffold` for the bottom bar and the 600 dp rail, and
  `ListDetailPaneScaffold` so Person and Item open beside the Feed on wide
  screens, with the list selection preserved across rotation.
- The rail keeps the same three destinations and the same badge; the New button
  moves to the rail's own action slot rather than floating over a list.
- **Done when:** the tablet structure matches `screens/15-tablet-feed-person_*`
  and a phone at 360 dp is pixel-unchanged.

### V9: The real search field (M, after V7)

- Either make the header field the actual field — focused in place, typing
  debounced, results below — or keep the current one-screen search and relabel
  the header entry point honestly. The brief asks for the former; the decision
  is open question 7 below.
- **Done when:** the chosen shape has its own screenshot state and no control
  announces itself as an input while behaving as a link.

### V10: Speed dial and sheet polish (S, after V4)

- Replace the hardcoded white and literal ink in `SpeedDialItem` with `panel` and
  `ink`, so dark theme is on-palette.
- Stagger the four items by 30 ms, per the tokens, and check that the scrim
  matches `scrim` in both themes.
- Apply the answer to open question 4 for the avatar initial.
- **Done when:** the speed dial in dark theme is drawn only from tokens, and the
  stagger is visible on a real animation, not just in code.

### V11: Motion and reduced motion (S, after V10)

- Keep durations in one place (`LbMotion`), and confirm that explicit `tween`
  durations respond to the system animation scale. Where they do not, gate them
  on the composition's motion duration scale so "remove animations" in system
  settings removes ours.
- **Done when:** with animations off in system settings, the speed dial, sheets
  and tab changes appear without motion, and nothing animates for the user who
  asked it not to.

## 6. How this is verified

| Layer | Check | Where |
|---|---|---|
| Tokens | `ThemeDriftTest` against `DESIGN_TOKENS.json` | JVM, CI |
| Look | Roborazzi baselines per component and screen, light and dark, 360 and 411 dp, plus 200% text | JVM, CI |
| Contrast | A JVM test over the token pairs, at 4.5:1 for text and 3:1 for glyphs | JVM, CI |
| Touch targets | Gallery measured by the screenshot test's layout tree; plus a written TalkBack pass | CI, then phone |
| The eight rules | A checklist walked against the screenshots, one line per rule | Review, per visual PR |
| Real device | Insets, gesture bar, keyboard resize, system font scale, widget and notification rendering | Your phone |

Not claimed by any of this: that the app looks right on a device nobody has run
it on. A passing screenshot test proves the pixels did not change, not that they
were right in the first place — that judgement stays human, made once per
screen against the mockup.

## 7. Fidelity budget

Where the app may legitimately differ from the mockup:

- **Font metrics.** Instrument Serif, Plus Jakarta Sans and DM Mono do not
  measure identically in Compose and Chromium. A line breaking one word later
  is fine.
- **Hairlines.** A 1 dp line lands on a half-pixel at some densities. Anti-
  aliasing differences are fine.
- **Ripple and state layers.** Material's own interaction feedback is allowed;
  the mockup has none.

Where it may not:

- Any colour not in the tokens, in either theme.
- A shadow on anything but the New button.
- The highlighter on anything but a follow-up phrase or a search hit.
- Coral on anything that is not "needs you", or cobalt on anything that is not
  navigation or the primary action.
- A status that is colour without a word, or a kind that is colour without an
  icon.

## 8. Drift control

Three things keep this document true, and only three:

1. **One machine-readable token source.** The JSON is the input to a test, not a
   reference someone remembers to consult.
2. **One gallery.** A single screen that shows every component in both themes
   makes "did this change anything" a ten-second question.
3. **One baseline rule.** Screenshots are re-recorded only deliberately, in a
   commit that shows the new image.

If a future direction replaces Margin, the JSON, the gallery and the baselines
are the three things to replace — not the screens one by one.

## 9. Open questions

Carried from `android/design/margin/HANDOFF.md` where they touch visuals, plus
those this plan surfaces. Each has a default, so work can continue.

1. **Star colour in light theme.** `#D18A00` on `page` is 2.77:1 (handoff F4).
   Default: keep it and always print the number, per the mockup. Darkening to
   about `#B37400` would let the glyphs pass on their own.
2. **Avatar letter.** Default: a person icon until an initial is set in
   Settings, rather than the word "Me".
3. **Search field shape.** The permanent in-place field from the brief, or the
   current one-screen search with an honest entry point? Default: keep the
   current shape and relabel it, because it is the smaller change and the
   behaviour is identical.
4. **Feed "Open loops" chip.** Default: add it, counting open follow-ups, and
   point it at the same filtered list the Nudges tab reads.
5. **Nudges badge.** People only (the mockup's choice), or people plus open
   follow-ups? Default: people only, so the badge can reach zero.
6. **Custom reminder interval.** Is a number-of-days field enough? Default: yes.
7. **Reduced motion.** Should the app add its own "reduce motion" switch for
   users whose launcher cannot set the system one? Default: no; follow the
   system only.

## 10. Out of scope

- Dynamic colour, theming by the user, or a second visual direction.
- New screens. The visual layer does not add a destination; Nudges and Review
  already carry what the direction asks for.
- Any change to `:core`, the outbox, sync or the Sheet contract.
- Reworking the PWA or the watch app to match Margin. They are separate
  surfaces with their own styles.
- Icon design. Kind tiles use Material rounded icons until an icon set exists;
  the tile colours and radius are what the direction fixes.
