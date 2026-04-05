# Shelly DALI Dimmer

Control Shelly dimmers from Companion via the local network.

## Setup

1. Enter the **IP address** of your Shelly device
2. Select the correct **Shelly Model** from the dropdown
3. Leave the port at **80** unless you have changed it on the device
4. Adjust the **polling interval** if needed (default: 3000 ms)

## Actions

- **Light – On** / **Light – Off** / **Light – Toggle**: Basic on/off control
- **Dim Up / Dim Down**: Adjust brightness by a step (default 10%)
- **Set Brightness (%)**: Set an exact brightness level (0–100)

## Feedbacks

- **Light is ON**: Highlights the button when the light is on (yellow background)
- **Brightness level**: Displays the current brightness percentage on the button

## Troubleshooting

- **Connection Failure**: Verify the IP address is correct and the device is reachable (`ping <ip>`)
- **No response**: Make sure the Shelly device has its local HTTP API enabled (default: enabled)
- **Wrong model**: If commands don't work, try selecting a different device model in the config

