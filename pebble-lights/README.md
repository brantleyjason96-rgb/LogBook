# Home Lights 2 (Pebble)

A Pebble watch app for Google Home lights and thermostats: a **rooms grid**, per-room lights, a thermostat screen, and
**voice control**. It does not talk to Google itself. It uses the Google Home plugin from
[coredevices/pebble-apps](https://github.com/coredevices/pebble-apps/tree/main/googlehome) through the Pebble plugin API
(`Pebble.subscribeToSource` / `Pebble.invokeAction`). Install the plugin in the Pebble app and sign in under its settings first.

## Using it
| Screen | UP / DOWN | SELECT | Hold |
|---|---|---|---|
| **Rooms** (home) | previous / next room | open the room | SELECT: room off (on if all off). DOWN: talk |
| **Room** | previous / next row | toggle a light, or open the thermostat | SELECT: brightness. DOWN: talk |
| **Thermostat** | set point +1 / -1 deg F (hold to repeat) | cycle Heat, Cool, Eco, Off | SELECT: talk |
| **Brightness** | +10% / -10% | apply and close | |
| **Voice result** | UP: undo. DOWN: try again | close | |

Voice cards close by themselves after 12 seconds. If a phrase is ambiguous ("turn off the lamp" with two lamps) you get a short
"Which one?" list.

## What you can say
"Turn off the kitchen lights" / "bedroom lights on" / "turn off all the lights" / "everything off"
"Dim the living room to forty percent" / "set the floor lamp to 30" / "brighten the office" / "living room lights to full"
"Set the thermostat to 72" / "warmer" / "cooler" / "turn the heat off" / "eco mode on the thermostat"
On a room or thermostat screen, "turn them off" and "dim it to 20" apply to the room you are looking at.

The phrase parser is plain rules, not AI (`parseVoice` in `src/pkjs/index.js`). It matches your real room and light names,
understands number words ("forty five"), and when two names fit it prefers the longer one ("floor lamp" beats "lamp").
Temperatures are whole degrees Fahrenheit, 50 to 90.

## Build
Needs the plugins branch of `pebble-tool` and the SDK (see the pebble-apps README):

    pebble build && pebble install --emulator emery

Phone-side tests (no SDK needed): `npm test`

## Status
- **Tested:** the phone side (`src/pkjs/index.js`): grouping, about 40 spoken phrases, voice commands, undo, "which one?", failures,
  the watch's button commands. All against a mocked plugin.
- **Not tested:** the C watch app has not been built with the real SDK or run in the emulator. It compiles cleanly (`-Wall -Wextra`)
  against a hand-written stub of the Pebble API, with and without a microphone. Expect small build fixes on the first `pebble build`.
- **Not verified:** how the Core Devices app handles the Dictation API. Voice also needs a watch with a microphone; on others the
  voice card says so.
- **Layout:** the room tiles show the room temperature only when the screen is tall enough (Emery and Gabbro). Round screens are
  inset but unreviewed.
- The plugin reports setpoint and room temperature in Celsius; the app converts to Fahrenheit and sends `temperature_f` back.
- Limits: 8 rooms, 24 lights, one thermostat per room.
