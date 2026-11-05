# Home Lights (Pebble)

A Pebble watch app that lists your Google Home lights, toggles them, and dims them. It does not talk to Google itself.
It uses the **Google Home plugin** from [coredevices/pebble-apps](https://github.com/coredevices/pebble-apps/tree/main/googlehome)
through the Pebble plugin API (`Pebble.subscribeToSource` / `Pebble.invokeAction`).

## Use
- Install the Google Home plugin in the Pebble app and sign in under its settings.
- **SELECT** toggles the highlighted light. The first row, "All lights off", turns off every light.
- **Long-press SELECT** opens a brightness window with a percent readout and bar. **UP/DOWN** change it by 10% (hold to repeat). **SELECT** applies it now; **BACK** applies it and leaves.
- Offline lights show "Offline"; lights that can't dim ignore long-press. A failed send buzzes the watch.

## Build
Needs the plugins branch of `pebble-tool` and the SDK (see the pebble-apps README):

    pebble build && pebble install --emulator emery

Phone-side tests (no SDK needed): `npm test`

## Design notes
Built with the `pebble-watchface` agent skill's watchapp conventions (stock `wscript`, StatusBarLayer, layout computed from
bounds, round-screen insets, timers cancelled on window disappear). It stays C + PKJS rather than Alloy because the plugin
API (`Pebble.subscribeToSource` / `invokeAction`) is phone-side. `validate_project.py` from the skill passes.

## Status
The phone-side logic has tests against a mocked plugin API. The C watch code compiles cleanly (`-Wall -Wextra`) against a hand-written stub of the Pebble API, but has **not been built
with the real SDK or run in the emulator**: the SDK host was not reachable. Expect to fix small build errors on first `pebble build`.
Data/action names come from the plugin's manifest (`home/device`, `turn_on`, `turn_off`, `set_brightness`).
