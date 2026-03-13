# Shelly DALI Dimmer — Companion Module

Control Shelly dimmer devices directly from Bitfocus Companion over your local network using the Shelly HTTP/RPC API. No cloud required.

---

## Supported Devices

| Device | Generation | Protocol |
|---|---|---|
| Shelly DALI Dimmer Gen3 | Gen3 | HTTP RPC (`/rpc`) |
| Shelly Dimmer 2 | Gen1/Gen2 | HTTP RPC (`/rpc`) |
| Shelly Plus Dimmer 1PM | Gen3 | HTTP RPC (`/rpc`) |
| Shelly Plus Dimmer 10V PM | Gen3 | HTTP RPC (`/rpc`) |

> All devices are controlled locally over HTTP — no internet connection or Shelly Cloud account is required.

---

## Configuration

Open the module settings and fill in the following fields:

| Field | Description | Default |
|---|---|---|
| **IP Address** | Local IP address of your Shelly device (e.g. `192.168.1.50`) | `192.168.1.100` |
| **Port** | HTTP port — leave at `80` unless you have changed it on the device | `80` |
| **Shelly Model** | Select the exact model from the dropdown. Choosing the wrong model may cause commands to fail | Shelly DALI Dimmer Gen3 |
| **Polling Interval (ms)** | How often Companion fetches the current status from the device. Set to `0` to disable polling | `3000` |

> **Tip:** Find your device IP in the Shelly app under *Device Info*, or check your router's DHCP lease table. Assign a static/reserved IP so it never changes.

---

## Actions

All actions apply to the device selected in the configuration.

| Action | Options | Description |
|---|---|---|
| **Light – On** | — | Turns the light on at its last known brightness |
| **Light – Off** | — | Turns the light off |
| **Light – Toggle** | — | Toggles the light between on and off |
| **Dim Up** | Step % (1–100, default 10) | Increases brightness by the given step |
| **Dim Down** | Step % (1–100, default 10) | Decreases brightness by the given step |
| **Set Brightness (%)** | Brightness 0–100 | Sets an exact brightness level. Setting to `0` turns the light off |
| **Fade to Brightness** | Target % (0–100), Duration (0.5–60 s) | Smoothly fades brightness to the target over the specified duration |

---

## Feedbacks

Feedbacks update in real time based on the polled device state.

| Feedback | Type | Description |
|---|---|---|
| **Light is ON** | Boolean | Button turns yellow when the light output is active |
| **Brightness level** | Advanced | Overlays the current brightness percentage on the button face. Green when on, dark grey when off |

---

## Variables

Use these in button labels or expressions to display live device data.

| Variable | Description | Example Value |
|---|---|---|
| `$(shelly-dali-dimmer:light_state)` | Current power state | `ON` or `OFF` |
| `$(shelly-dali-dimmer:brightness)` | Current brightness as a number (0–100) | `75` |
| `$(shelly-dali-dimmer:brightness_bar)` | Visual 10-segment brightness bar with percentage | `▰▰▰▰▰▰▰▱▱▱ 70%` |

---

## Troubleshooting

**Module shows "Connection Failure"**
- Verify the IP address is correct and the Shelly device is powered on.
- Run `ping <ip>` from the Companion host to confirm network reachability.
- Ensure no firewall is blocking port 80 between Companion and the device.

**Commands have no effect**
- Make sure the correct **Shelly Model** is selected — a mismatched model will send commands to the wrong API endpoint.
- Check that the Shelly's local HTTP API is enabled. In the Shelly app go to *Settings → Device Settings → Local control* and confirm it is on (enabled by default).

**Brightness feedback is stuck or wrong**
- Increase the polling interval or lower it for faster updates. A value of `1000` (1 second) gives near-real-time feedback.
- If the device was controlled from outside Companion (e.g., Shelly app or physical switch), wait one poll cycle for the state to sync.

**Fade action stutters or is too slow**
- The fade runs at 20 steps per second from inside Companion. On very busy networks, individual HTTP calls may be delayed. Increase the fade duration to compensate.
- Ensure the device IP is stable (use a DHCP reservation on your router).

---

## Maintainer

Benjamin Hald — [benjahj@gmail.com](mailto:benjahj@gmail.com) — GitHub: [benjahj](https://github.com/benjahj)

Issues and feature requests: [github.com/benjahj/companion-module-shelly-dali-dimmer/issues](https://github.com/benjahj/companion-module-shelly-dali-dimmer/issues)

