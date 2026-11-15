# Deploying the v4 Sheet script

The Android app talks to your Google Sheet through an Apps Script web app. The
script in `android/script/logbook_v4.gs` is **v4**, and the app needs v4: v3 has
no `pull` action, so a v3 deployment can only push, never pull, and the phone
cannot rebuild its copy of the logbook.

Until this is done the app works entirely offline. Everything you capture stays
on the phone in the outbox, in the order you captured it, and sync resumes the
moment the Sheet answers as v4.

## What the app checks

The app calls `GET ?action=ping`, which v4 answers with:

```json
{ "ok": true, "v": 4, "api": 3 }
```

- `v < 4` → the app shows **"The Sheet runs a script older than v4."** and stops
  retrying (it would only fail again).
- Wrong key → **"The Sheet refused the key."**
- No answer → **"Saved on this phone. It syncs when you are online."**

## Steps (in the Sheet's browser tab)

1. **Open the script.** In the Sheet: *Extensions → Apps Script*.
2. **Replace the code.** Select everything in `Code.gs`, delete it, and paste the
   whole of `android/script/logbook_v4.gs`. Save (⌘/Ctrl+S).
   Before pasting, `node android/script/test_logbook_v4.js` runs the whole file
   against a fake Sheet (setup, a capture push, a pull, a void) and prints one
   PASS/FAIL line per check. It catches a broken string or a renamed helper
   before Apps Script does.
3. **Run `setup()` once.** In the function dropdown pick `setup`, press Run, and
   accept the authorisation prompt. This creates or repairs the tabs the app
   expects (`entries`, `people`, `queue`, `meta`) and writes the API version into
   `meta`. It is safe to run more than once; it never deletes rows.
4. **Deploy a new version, keeping the same URL and key.** *Deploy → Manage
   deployments →* pencil icon on the existing deployment *→ Version: New version
   → Deploy*. Do **not** use "New deployment": that mints a new URL and a new
   key, and every phone would have to be reconnected.
5. **Confirm.** Open the deployment URL with `?action=ping` in a browser. You
   should see `{"ok":true,"v":4,"api":3}`.

## On the phone

1. **Settings → Sync now.** With the same URL and key the connection is already
   stored, so nothing else is needed. Expected message: *"Synced. N in, M out."*
2. If the key changed, reconnect: **Settings → Connect**, paste the setup link
   from the web app (or scan its QR code). The key is stored in the Android
   Keystore, never in the database or in a plain preferences file.
3. If the phone says it is offline, the Sheet is reachable but the request did
   not complete: check mobile data, then try **Sync now** again.

## What sync does now

- **Outbox first.** Every capture is written to Room and to `queue` in one local
  transaction; the network is never in the capture path.
- **Push then pull.** Queue rows are pushed in capture order. On success they are
  marked sent. A `NotConnected`, `WrongKey` or `OldScript` result stops the run
  instead of burning retries.
- **Pull is incremental.** The app sends its highest known `updated` stamp and
  the Sheet returns only rows at or after it.
- **Periodic and on demand.** A WorkManager job runs roughly every six hours
  (with network and battery constraints) and on boot; **Sync now** runs one pass
  immediately.

## Rollback

*Deploy → Manage deployments →* pencil *→ Version:* pick the previous version *→
Deploy*. The URL and key stay the same. The app will report *"The Sheet runs a
script older than v4."* and keep working offline; nothing on the phone is lost,
and the outbox drains once v4 is deployed again.

## Notes

- The script contains no secrets and needs no API keys. TMDB, iTunes, Open
  Library and TheMealDB are called directly by the phone, not through the Sheet.
- The Sheet stays the source of truth for the web app; the phone is a full local
  copy with its own outbox, so the two can be apart for days without conflict.
- Merging two people is a Sheet-side operation (`action: merge`) and a phone-side
  one; both write an ordinary event trail, so a merge can be audited later.
