# Home Lights 3 (Pebble)

Google Home lights, thermostats and scenes on your wrist, built around **fewer presses**. You choose and order what the home screen
shows in the app's **settings page**; the watch does the rest.

It does not talk to Google itself. It uses the Google Home plugin from
[coredevices/pebble-apps](https://github.com/coredevices/pebble-apps/tree/main/googlehome) through the Pebble plugin API
(`Pebble.subscribeToSource` / `Pebble.invokeAction`). Install the plugin in the Pebble app and sign in under its settings first.

## Three rules, on every screen
| Gesture | Does |
|---|---|
| **Tap SELECT** | Do it. Toggle a light, or every light in a room. Run a scene. All lights off. Open the thermostat. |
| **Hold UP** | Fine-tune. Brightness for a light. Open the lights of a room. |
| **Hold SELECT** | Talk to the watch, from any screen. |

UP and DOWN move through lists and **wrap around**, so the last row ("All rooms") is one press up from the top.
Most daily actions are one or two presses: put them at the top of the home screen.

## Screens
- **Home**: your favourites, then "All rooms". Each row is one line: a dot (yellow on, hollow off, grey offline, orange thermostat,
  blue scene), the name, and the state on the right.
- **All rooms**: every room (tap toggles the whole room, hold UP opens it) and your scenes.
- **Room**: its lights and thermostat.
- **Brightness**: UP/DOWN change it, SELECT applies, BACK applies and leaves.
- **Thermostat**: set point and current temperature, UP/DOWN change the set point, SELECT cycles Heat, Cool, Eco, Off.
- **Voice result**: shows what was understood. UP undoes, DOWN tries again. Closes by itself after 12 seconds.

## Settings (the gear in the Pebble app)
- **Home screen**: add rooms, single lights, thermostats, scenes and "All lights off"; reorder with Up/Down; give each a shorter watch
  name. A live preview of the watch screen updates as you change things.
- **Names and visibility**: rename anything, or hide it from the room lists, All rooms and "All lights off". A hidden light can still
  be named by voice.
- **Controls**: brightness step (5, 10 or 20 percent) and thermostat step (1 or 2 degrees).
- Changes reach the watch as you make them. Until you change something you get a suggested layout.

## What you can say
"Turn off the kitchen lights" / "bedroom lights on" / "turn off all the lights" / "everything off"
"Dim the living room to forty percent" / "set the floor lamp to 30" / "brighten the office" / "living room lights to full"
"Set the thermostat to 72" / "warmer" / "cooler" / "turn the heat off" / "eco mode on the thermostat"
"Run goodnight" / "movie night" (any Google Home automation that can be run by hand)
On a room or thermostat screen, "turn them off" and "dim it to 20" apply to the room you are looking at. If two names fit
("turn off the lamp" with two lamps) you get a short "Which one?" list.

The parser is plain rules, not AI (`parseVoice` in `src/pkjs/index.js`): it matches your real room, light and scene names, understands
number words ("forty five"), and prefers the longer name ("floor lamp" beats "lamp"). Temperatures are whole degrees Fahrenheit, 50 to 90.

## Speed
What happens when you tap a light: the watch shows the new state at once, the phone shows it at once too and then asks Google, and a
failure puts the real state back. Several things keep that quick:
- Room and all-off changes send up to 6 requests to Google in parallel, all shown on the watch together, with one retry if Google
  rate-limits.
- The plugin refreshes its data after every action; the app now sends only the rows that changed instead of resending whole lists, and
  never discards a message that is waiting (such as a voice result).
- Button presses queue on the watch, so a quick second press is not lost while the first is still being sent.
- A quick second tap on the same light turns it back, because the phone already knows about the first.
- Brightness and thermostat changes are sent 450 ms after your last press.

The time between your tap and the bulb itself is mostly the Google Home plugin: each action signs in again, looks up the whole home,
then sends the command, one device after another. Caching the sign-in and the home lookup there, and controlling devices in parallel,
would help most. That change belongs in the plugin (coredevices/pebble-apps), not this app.

## How it is built
The **phone builds every list** and sends rows (`title`, state text, state, type); the **watch only draws rows** and reports taps
and holds. That keeps the watch code small and puts the logic where it is tested. Only rows that changed are sent after an action.
The protocol is documented at the top of `src/pkjs/index.js`.

## Build
Needs the plugins branch of `pebble-tool` and the SDK (see the pebble-apps README):

    pebble build && pebble install --emulator emery

`config.html` is the settings page (`configPage` in `package.json`). Open it in a plain browser to preview it with example data.
Phone-side tests (no SDK needed): `npm test`

## Status
- **Tested:** the phone side, against a mocked plugin: lists and favourites, taps and holds, only-changed-rows updates, settings
  save/load/reset and bad values, hidden items, scenes, about 40 spoken phrases, undo, "which one?", failures, and the speed behaviours
  above (28 tests; five of them fail against the previous version). The watch's press queue was run in a small C harness with a fake busy outbox. The settings page was
  driven in a real browser (add, reorder, rename, remove, hide, steps, reset; phone width and dark mode).
- **Not tested:** the C watch app has not been built with the real SDK or run in the emulator. It compiles cleanly (`-Wall -Wextra`)
  against a hand-written stub of the Pebble API, with and without a microphone. Expect small build fixes on the first `pebble build`.
- **Not verified:** how the Core Devices app handles the Dictation API and the settings-page bridge (`Pebble.sendMessage`). Voice
  needs a watch with a microphone; on others the voice card says so.
- The plugin reports setpoint and room temperature in Celsius; the app converts to Fahrenheit and sends `temperature_f` back.
- Limits: 8 rooms, 24 lights, 12 scenes, 20 favourites, one thermostat per room.
