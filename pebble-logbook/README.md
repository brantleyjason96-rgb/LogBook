# Logbook watch app: phone-side code

The phone-side JavaScript of the Logbook Pebble app (v1.16.0), recovered from the built `.pbw`'s source map,
plus the now-playing bookmark change. **This is not a full project**: the watch's C code, resources and
`package.json` were not in the `.pbw` and are not here. Copy `src/pkjs/` over the same folder in your local
project and rebuild. `appinfo.original.json` is the manifest from the v1.16.0 build, for reference.

## Now-playing bookmarks (`src/pkjs/nowplaying.js`)

When a bookmark or note is saved with no position said out loud, the phone asks the Pebble music plugin
what is playing:

- track **and** position known: `pos` is filled in ("12:34") and the track is saved with the bookmark;
- track but **no position**: only the track is shown ("Bookmarked: Artist - Title");
- nothing playing, paused, plugin error, or no answer within 1.5 s: saved exactly as before;
- a position you say yourself ("20 minutes in") always wins and the plugin is not asked.

People and loose thoughts never ask. The bookmarked item (the podcast, book, album you picked) is unchanged.
The event sent to your Sheet gains a `track` field next to `pos`; the Apps Script must store it to keep it.

### It is off until you finish setup

The plugin's own details could not be checked (its docs were unreachable), so they are guesses in
`CONFIG` at the top of `nowplaying.js`, and the feature is off while `CONFIG.plugin` is empty:

| Setting | Needs checking against the plugin docs |
|---|---|
| `plugin` | the music plugin's UUID (empty = off) |
| `category`, `item` | what to subscribe to |
| `keys` | property names for title, artist, position, playing |
| `positionUnit` | `'seconds'` or `'ms'` |

The Core Pebble app may also need its experimental plugins turned on, and the app's `appinfo.json` may need
a permission for plugins (check the docs).

## Tests

`npm test` in this folder (Node 18+). They run the real `index.js` against a mocked plugin.
They show the logic is right for the shape assumed above, not that the real plugin matches it.
