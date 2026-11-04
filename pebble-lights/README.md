# Home Lights (Pebble)

A Pebble watch app that lists your Google Home lights, toggles them, and dims them. It does not talk to Google itself.
It uses the **Google Home plugin** from [coredevices/pebble-apps](https://github.com/coredevices/pebble-apps/tree/main/googlehome)
through the Pebble plugin API (`Pebble.subscribeToSource` / `Pebble.invokeAction`).

## Use
- Install the Google Home plugin in the Pebble app and sign in under its settings.
- **SELECT** toggles the highlighted light. The first row, "All lights off", turns off every light.
- **Long-press SELECT** opens a brightness window; **UP/DOWN** change it by 10%.

## Build
Needs the plugins branch of `pebble-tool` and the SDK (see the pebble-apps README):

    pebble build && pebble install --emulator emery

Phone-side tests (no SDK needed): `npm test`

## Status
The phone-side logic has tests against a mocked plugin API. The C watch code has **not been compiled or run**:
the SDK host was not reachable when this was written. Expect to fix small build errors on first `pebble build`.
Data/action names come from the plugin's manifest (`home/device`, `turn_on`, `turn_off`, `set_brightness`).
