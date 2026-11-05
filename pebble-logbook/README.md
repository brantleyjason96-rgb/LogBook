# Logbook watch app: phone-side code

The phone-side JavaScript of the Logbook Pebble app (v1.16.0), recovered from the built `.pbw`'s source map,
plus the now-playing bookmark change. **This is not a full project**: the watch's C code, resources and
`package.json` were not in the `.pbw` and are not here. Copy `src/pkjs/` over the same folder in your local
project and rebuild. `appinfo.original.json` is the manifest from the v1.16.0 build, for reference.

## Now-playing bookmarks (`src/pkjs/nowplaying.js`)

When a bookmark or note is saved with no position said out loud, the phone asks the Core Pebble app's
built-in **Music** plugin (UUID `00000000-0000-0000-0001-000000000003`, source `music/track`) what is playing:

- **track known** (the normal case): the track is saved with the bookmark and shown ("Bookmarked: Artist - Title",
  or just the track when that is too long for the watch), and in the Bookmarks list and on the web app;
- nothing playing, paused, plugin error, or no answer within 1.5 s: saved exactly as before;
- a position you say yourself ("20 minutes in") always wins and the plugin is not asked.

### Marks and notes (1.17.0)

- Reflect > the item > **Mark this spot** adds a mark every press (as many as you like per podcast); each keeps the time and the playing track.
- **Add a note** within 10 minutes of a mark puts the note on that mark. A spoken position or a later note makes a separate entry.
- The Sheet gets the note as a `note` event with `track`, `pos` and `about` (the mark's event id).

The plugin publishes title, artist, album and playing/paused, **not playback position** (checked in the plugin's
source, `MusicPlugin.kt`), so `pos` stays whatever you said. If a later plugin version adds position, set
`CONFIG.keys.position` and the code will use it.

People and loose thoughts never ask. The bookmarked item is unchanged. The event sent to your Sheet gains a
`track` field next to `pos`; the Apps Script must store it to keep it.

### Needs
- **Android** with the Core Pebble app (the plugin is Android only).
- The Core app may need experimental plugins enabled (Debug menu) and may ask permission to read music.
- Turn the feature off by emptying `CONFIG.plugin` in `nowplaying.js`.

## Tests

`npm test` in this folder (Node 18+). They run the real `index.js` against a mocked plugin.
The plugin data in them is shaped like `MusicPlugin.kt` builds it. They have not been run on a real watch.
