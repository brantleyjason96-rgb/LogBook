# Logbook 1.11.0: Hub Tiles + Paper

Build: `pebble build` then `pebble install --emulator emery` (or `--phone <ip>`).
Only `src/c/main.c` and the version in `package.json` changed. The phone side (`src/pkjs`) is untouched.

## Controls
- Hub (opens here): Up/Down move focus (wraps), Select opens the tile. Hold Up = first tile, hold Down = last tile, hold Select = Say it from any tile.
- Tiles: Say it, Today, Reflect, Stats, Log a... (the full kind menu), Shelf (Recent, Bookmarks, Favorites).
- Rating screen: hold Up = 5 stars, hold Down = 1 star, hold Select = say a note (as before).
- Search results: hold Select = rate 3 stars and return to the hub. "Anything" results still ask for a category first.
- Today (old Home): Select = Say it, hold Select = re-rate newest. Back returns to the hub.

## Paper palette
`C_BG`, `C_FG`, `C_MUTE`, `C_LINE`, `C_ACC`, `C_STAR`, `C_OK`, `C_WARN` and `kind_color()` near the top of the drawing code.
Focus is a black bar. `on_color()` picks black or white text for any fill. Stars are gold with a black outline.

## Not done
- Hold actions on MenuLayer lists (Reflect next unannotated, kind picker first/last, shelf top/bottom): MenuLayer owns the click config, so these need a custom provider.
- Day navigation on Today, Stats range hold.
- The phone settings page (`config_html.js`) keeps its dark theme.
- Not compiled with the Pebble SDK here; it passed a syntax check against a stub header only.

## 1.12.0: second-brain sync (phone side only; main.c untouched)
- Notes and bookmarks now sync to Sheets, and every rating is also logged as its own event (nothing overwritten).
- Needs the v2 Apps Script (logbook_sheet_v2.gs; also shown in settings). With the old script, events wait on the phone and a toast says to update.
- Tick "Send all my ratings and notes when I save" once to backfill existing notes.

## 1.13.0: People tile
- New hub tile, second position: People. Opens "Someone new" (say a name) and the people you have logged, most recent first.
  - Select on a person = logged that you met them (no stars). Hold Select = say what you talked about.
  - Someone new: say "Maria", "coffee with Maria" or "Maria, we talked about the field trip". The phone pulls out the name, matches it to a known person if there is exactly one match, and keeps the rest as the note.
- Hub is now 7 tiles in 4 rows (tiles are 44 px tall). Today and Stats show where they did before, one tile later.
- Phone side: new request type 14 (people list), people and meets saved in phone storage, events of kind "met" (category "person") sent to the Sheet. Home carries a "met today" count (flag 8).
- No new message keys. People are logged through the existing LOG_REF/LOG_NOTE message with ref "n:slug" (or "n:?" for a spoken new name) and zero stars.
- main.c was syntax-checked against a stub header, not built with the Pebble SDK.

## 1.13.1
- Settings page now shows the v3 sheet script (read API for the web app, KEY support). Nothing else changed; watch and phone protocol are the same as 1.13.0.

## 1.14.0: longer notes, keep listening
- Notes can now be about 240 characters (was 100). They are stored in their own slots, so queued notes survive a restart. The watch-to-phone message buffer is bigger to carry them.
- Keep listening: for notes (on a person or on something you rated), each accepted phrase is added to the note and the microphone opens again, so a pause no longer ends your thought. Press Back, or stay quiet, to finish; the whole note is saved and the watch buzzes once.
- New-person names (the first tile entry) still end after one phrase.
- Queued entries from 1.13.x that never reached the phone are dropped on upgrade (the storage layout changed); send anything pending before updating.

## 1.14.1: hard names
- A name you say is matched to people you already know by how it sounds, so "Miss Camilah", "Miss Jamila" and "Ms. Gamilah" all find the same person instead of creating three. Titles (Ms, Miss, Mrs, Mr, Dr) are ignored when comparing.
- If two known people sound alike the app does not guess (unless one is clearly the one you see far more often); it creates a new person, which you can merge on the web.
- The phone remembers each spelling it matched, so the same mishearing resolves instantly next time.
- Notes from the watch are no longer cut at 120 characters on the phone (now 250).

## 1.15.0 - better notes

- **Pick a person, get a small menu:** Met just now / Add a note / Met, with a note. "Add a note" saves the note only and does not count a meeting. Holding Select on a person still does met + note in one go.
- **New Note tile (8th, purple):** "Note about..." lists A thought, then recent people, then recent ratings. Pick one and talk; it keeps listening until you pause or press Back, then returns to the hub.
- **A thought** is a note not tied to anything. It lands in the sheet as a `note` event with no ref (the web app already shows these).
- Person notes show in the sheet as `note` events on that person, and on the watch under Reflect-style note lists. They stay out of Shelf > Bookmarks.
- Phone: REQ_TARGETS 15, `noteTargets()`, `addMark(..., raw)`, LOG_TAG "note" for person notes. Hub is now 8 tiles; the "Hold Select" hint was dropped to make room.

## 1.15.1 - touch

Only active on watches with a touchscreen and with touch on in the watch's settings (`PBL_TOUCH`, `touch_service_is_enabled()`); button-only watches behave exactly as before.
- All lists, menus and action rows: system touch navigation switched on (`app_touch_navigation_enable(true)`), so tap a row and swipe to scroll.
- Hub: tap a tile to open it.
- Rating screen: touch or drag across the stars to set the rating (half stars included), tap the rating word to save. Buttons still work, and hold Select still adds a note.

## 1.16.1 - now-playing bookmarks (phone side only; main.c untouched)

- When a bookmark or note is saved with no position said out loud, the phone asks the Core Pebble app's built-in Music plugin (`music/track`) what is playing and keeps the track with the bookmark. Shown on the watch ("Bookmarked: Artist - Title", or just the track if long), in Shelf > Bookmarks, and on the web app.
- The plugin does not publish playback position, so `pos` still only comes from what you say. Android only. See `README.md`.
- New file `src/pkjs/nowplaying.js` (settings at the top, empty `plugin` turns it off). `index.js`: `addMark` / `commitMark`, `markEvent` adds `track`.
- Version is 1.16.1 so it installs above the 1.16.0 build.

## 1.17.0 - many marks per item, notes on a mark

- On an item's Reflect page the row is now **Mark this spot** (then **Mark again**). Every press adds a new mark, so a podcast can have as many as you like; each stores the time and the playing track. It no longer toggles, so marks are not removed from the watch (remove them on the web app).
- **Add a note** (or holding Select and speaking) within 10 minutes of a mark puts the words on your latest mark. Say a time or page ("26 minutes in") and you get a new mark instead. Later or for another item, it is an ordinary note as before.
- A note on a mark keeps the ribbon, and goes to the Sheet as a `note` event with the mark's place and track and `about` set to the mark's event id.
- Watch change: three label strings in `item_draw_row` (`src/c/main.c`) and one comment. Everything else is phone side. `main.c` was not compiled here.

