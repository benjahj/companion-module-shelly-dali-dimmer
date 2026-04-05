# Shelly DALI Dimmer – Bitfocus Companion Module

Control Shelly DALI Dimmer Gen3 (and compatible Shelly dimmers) from [Bitfocus Companion](https://bitfocus.io/companion) via the local HTTP/RPC API.

## Supported Devices

| Device | Generation |
|---|---|
| Shelly DALI Dimmer Gen3 | Gen3 |
| Shelly Dimmer 2 | Gen1 / Gen2 |
| Shelly Plus Dimmer 1PM | Gen3 |
| Shelly Plus Dimmer 10V PM | Gen3 |

## Requirements

- **Bitfocus Companion** v4.1.4 or later
- **Node.js** 18 or later (bundled with Companion)
- The Shelly device must be on the same network and reachable via HTTP

## Installation

### Option A – Developer Modules Path (recommended for testing)

1. In Companion, go to **Settings** → set **Developer modules path** to a directory, e.g. `/opt/companion-module-dev`
2. Clone the repository into that directory:
   ```bash
   cd /opt/companion-module-dev
   git clone https://github.com/benjahj/companion-module-shelly-dali-dimmer.git shelly_dali_dimmer
   cd shelly_dali_dimmer
   npm install
   ```
3. Restart Companion
4. The module appears as **Shelly: Shelly DALI Dimmer Gen3** under "Add Connection"

### Option B – Import as .tgz Package

1. Build the package:
   ```bash
   npm install
   npx companion-module-build
   ```
2. In Companion UI → **Modules** → **Import module package** → select the generated `.tgz` file

## Configuration

| Field | Description | Default |
|---|---|---|
| **IP Address** | IP address of the Shelly device | `192.168.1.100` |
| **Port** | HTTP port | `80` |
| **Shelly Model** | Select your device type from the dropdown | Shelly DALI Dimmer Gen3 |
| **Polling Interval** | How often to poll device status (ms, 0 = disabled) | `3000` |

## Actions

| Action | Description |
|---|---|
| **Light – On** | Turn the light on |
| **Light – Off** | Turn the light off |
| **Light – Toggle** | Toggle the light on/off |
| **Dim Up (step)** | Increase brightness by a configurable step (default 10%) |
| **Dim Down (step)** | Decrease brightness by a configurable step (default 10%) |
| **Set Brightness (%)** | Set brightness to an exact value (0–100) |

## Feedbacks

| Feedback | Type | Description |
|---|---|---|
| **Light is ON** | Boolean | Changes button style when the light is on |
| **Brightness level** | Advanced | Shows current brightness percentage on the button |

## API Reference

The module communicates with Shelly devices using the local HTTP RPC API:

| Endpoint | Usage |
|---|---|
| `/rpc/Light.Set?id=0&on=true\|false` | Turn on/off |
| `/rpc/Light.Set?id=0&offset=±N` | Relative dim |
| `/rpc/Light.Set?id=0&brightness=N` | Absolute brightness |
| `/rpc/Light.Toggle?id=0` | Toggle |
| `/rpc/Light.GetStatus?id=0` | Poll current status |

## Development

```bash
git clone https://github.com/benjahj/companion-module-shelly-dali-dimmer.git
cd companion-module-shelly-dali-dimmer
npm install
```

To add a new Shelly device model, edit the `DEVICE_PROFILES` object in `main.js`.

## License

MIT

