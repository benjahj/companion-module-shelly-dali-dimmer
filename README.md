# companion-module-shelly-dali-dimmer

**Bitfocus Companion module** for Shelly DALI Dimmer Gen3 and compatible Shelly dimmer devices.
Controls lights locally over HTTP — no cloud, no Shelly account required.

> **Module ID:** `shelly-dali-dimmer`
> **Maintainer:** Benjamin Hald ([@benjahj](https://github.com/benjahj)) — benjahj@gmail.com
> **Repository:** https://github.com/benjahj/companion-module-shelly-dali-dimmer
> **License:** MIT

---

## Supported Devices

| Device | Generation | Protocol |
|---|---|---|
| Shelly DALI Dimmer Gen3 | Gen3 | HTTP RPC (`/rpc`) |
| Shelly Dimmer 2 | Gen1 / Gen2 | HTTP RPC (`/rpc`) |
| Shelly Plus Dimmer 1PM | Gen3 | HTTP RPC (`/rpc`) |
| Shelly Plus Dimmer 10V PM | Gen3 | HTTP RPC (`/rpc`) |

---

## Requirements

| Requirement | Version |
|---|---|
| Bitfocus Companion | v4.1.4 or later |
| Node.js | 18 or later (bundled with Companion) |

The Shelly device must be powered on and reachable on the same local network as the Companion host.

---

## Installation (Development / Testing)

1. In Companion, open **Settings** and set the **Developer modules path** to a local directory.
2. Clone this repository into that directory and install dependencies:

```bash
cd /path/to/companion-module-dev
git clone https://github.com/benjahj/companion-module-shelly-dali-dimmer.git
cd companion-module-shelly-dali-dimmer
npm install
```

3. Restart Companion. The module appears as **Shelly DALI Dimmer** under *Add Connection → Shelly*.

---

## Configuration

| Field | Description | Default |
|---|---|---|
| **IP Address** | Local IP of the Shelly device (e.g. `192.168.1.50`) | `192.168.1.100` |
| **Port** | HTTP port — usually `80` | `80` |
| **Shelly Model** | Select the exact model. Wrong selection causes commands to fail | Shelly DALI Dimmer Gen3 |
| **Polling Interval (ms)** | How often to fetch device status (`0` = disabled) | `3000` |

---

## Actions

| Action | Options | Description |
|---|---|---|
| **Light – On** | — | Turns the light on |
| **Light – Off** | — | Turns the light off |
| **Light – Toggle** | — | Toggles the light |
| **Dim Up** | Step % (1–100) | Increases brightness by step |
| **Dim Down** | Step % (1–100) | Decreases brightness by step |
| **Set Brightness (%)** | Brightness 0–100 | Sets exact brightness (`0` turns off) |
| **Fade to Brightness** | Target %, Duration (s) | Smoothly fades brightness over time |

---

## Feedbacks

| Feedback | Type | Description |
|---|---|---|
| **Light is ON** | Boolean | Button style changes when light is active |
| **Brightness level** | Advanced | Overlays current brightness % on the button |

---

## Variables

| Variable | Description | Example |
|---|---|---|
| `$(shelly-dali-dimmer:light_state)` | Power state | `ON` / `OFF` |
| `$(shelly-dali-dimmer:brightness)` | Brightness 0–100 | `75` |
| `$(shelly-dali-dimmer:brightness_bar)` | Visual bar + percentage | `▰▰▰▰▰▰▰▱▱▱ 70%` |

---

## API Reference

All communication uses the Shelly local HTTP RPC API (no cloud):

| Endpoint | Purpose |
|---|---|
| `GET /rpc/Light.Set?id=0&on=true` | Turn on |
| `GET /rpc/Light.Set?id=0&on=false` | Turn off |
| `GET /rpc/Light.Set?id=0&offset=±N` | Relative dim step |
| `GET /rpc/Light.Set?id=0&brightness=N` | Absolute brightness |
| `GET /rpc/Light.Toggle?id=0` | Toggle |
| `GET /rpc/Light.GetStatus?id=0` | Poll current status |

---

## Bitfocus Submission Checklist

This module is prepared for submission to the [Bitfocus Companion module store](https://developer.bitfocus.io).

| Requirement | Status |
|---|---|
| Repository named `companion-module-{vendor}-{product}` | ✅ `companion-module-shelly-dali-dimmer` |
| `package.json` version matches release tag | ✅ `v1.0.2` |
| Maintainer name, email, and GitHub username in `manifest.json` | ✅ Benjamin Hald / benjahj@gmail.com / benjahj |
| `$schema` present in `manifest.json` | ✅ |
| `manufacturer` and `products` list in `manifest.json` | ✅ |
| `companion/HELP.md` with setup and usage documentation | ✅ |
| MIT license declared in `package.json` and `manifest.json` | ✅ |
| Module tested against Companion v4.1.4+ | ✅ |

To publish a release:
1. Ensure `version` in `package.json` and `manifest.json` match (e.g. `1.0.2`).
2. Tag the commit: `git tag v1.0.2 && git push origin v1.0.2`
3. Submit for review at [developer.bitfocus.io](https://developer.bitfocus.io) using the GitHub account **benjahj**.

---

## Development

```bash
git clone https://github.com/benjahj/companion-module-shelly-dali-dimmer.git
cd companion-module-shelly-dali-dimmer
npm install
```

To add a new Shelly device model, add an entry to the `DEVICE_PROFILES` object in `main.js`. Each entry needs a `label`, `lightId`, and `rpcPath`.

---

## Contributing / Issues

- **Bug reports & feature requests:** [GitHub Issues](https://github.com/benjahj/companion-module-shelly-dali-dimmer/issues)
- **Maintainer contact:** benjahj@gmail.com

---

## License

[MIT](https://opensource.org/licenses/MIT) — © Benjamin Hald

