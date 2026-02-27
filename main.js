/**
 * Bitfocus Companion – Shelly DALI Dimmer Gen3 module
 *
 * Configurable constants (search for these comments to adjust easily):
 *   DEFAULT_PORT   – standard HTTP port for Shelly devices
 *   DEFAULT_STEP   – brightness increment/decrement per Dim Up / Dim Down action
 *   DEVICE_PROFILES – maps dropdown choice → device-specific API settings
 *
 * Shelly Gen3 RPC endpoints used (all via HTTP GET):
 *   Light.Set        → /rpc/Light.Set?id=<lightId>&on=true|false
 *   Light.Set offset → /rpc/Light.Set?id=<lightId>&offset=<±step>
 *   Light.Set bright → /rpc/Light.Set?id=<lightId>&brightness=<0-100>
 *   Light.Toggle     → /rpc/Light.Toggle?id=<lightId>
 *   Light.GetStatus  → /rpc/Light.GetStatus?id=<lightId>
 */

const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')

// ─────────────────────────────────────────────
// CONFIGURABLE: Default port (change here if needed)
// ─────────────────────────────────────────────
const DEFAULT_PORT = 80

// ─────────────────────────────────────────────
// CONFIGURABLE: Dim step in percent (used by Dim Up / Dim Down)
// ─────────────────────────────────────────────
const DEFAULT_STEP = 10

// ─────────────────────────────────────────────
// CONFIGURABLE: Device profiles
// Add new Shelly models here. Each key maps to its Light component id
// and the RPC base path. Adjust if a future device uses a different path.
// ─────────────────────────────────────────────
const DEVICE_PROFILES = {
	'shelly-dali-dimmer-gen3': {
		label: 'Shelly DALI Dimmer Gen3',
		lightId: 0,
		rpcPath: '/rpc',
	},
	'shelly-dimmer-2': {
		label: 'Shelly Dimmer 2 (Gen1/Gen2)',
		lightId: 0,
		rpcPath: '/rpc',
	},
	'shelly-plus-dimmer-1pm': {
		label: 'Shelly Plus Dimmer 1PM (Gen3)',
		lightId: 0,
		rpcPath: '/rpc',
	},
	'shelly-plus-dimmer-10v': {
		label: 'Shelly Plus Dimmer 10V PM (Gen3)',
		lightId: 0,
		rpcPath: '/rpc',
	},
}

// ─────────────────────────────────────────────
// Module class
// ─────────────────────────────────────────────
class ShellyDaliDimmerInstance extends InstanceBase {
	/** Current known light status {output: bool, brightness: number} */
	lightStatus = { output: false, brightness: 0 }
	pollTimer = null

	// ── Lifecycle ──────────────────────────────

	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Ok)
		this.initVariables()
		this.initActions()
		this.initFeedbacks()
		this.startPolling()
	}

	async destroy() {
		this.stopPolling()
	}

	async configUpdated(config) {
		this.config = config
		this.stopPolling()
		this.updateStatus(InstanceStatus.Ok)
		this.initVariables()
		this.initActions()
		this.initFeedbacks()
		this.startPolling()
	}

	// ── Config fields ──────────────────────────

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'IP Address',
				width: 6,
				default: '192.168.1.100',
				regex: '/^[\\w.]+$/',
			},
			{
				// CONFIGURABLE: Default port – change default value here
				type: 'number',
				id: 'port',
				label: 'Port',
				width: 3,
				default: DEFAULT_PORT,
				min: 1,
				max: 65535,
			},
			{
				// CONFIGURABLE: Dropdown to add/remove supported devices
				type: 'dropdown',
				id: 'deviceType',
				label: 'Shelly Model',
				width: 6,
				default: 'shelly-dali-dimmer-gen3',
				choices: Object.entries(DEVICE_PROFILES).map(([id, p]) => ({ id, label: p.label })),
			},
			{
				// CONFIGURABLE: Polling interval for feedback updates
				type: 'number',
				id: 'pollingInterval',
				label: 'Status polling interval (ms, 0 = disabled)',
				width: 4,
				default: 3000,
				min: 0,
				max: 60000,
			},
		]
	}

	// ── HTTP helper ────────────────────────────

	/**
	 * Central function for all Shelly HTTP/RPC calls.
	 * CONFIGURABLE: Change this function to switch from HTTP GET to POST/WebSocket.
	 * @param {string} method  RPC method name, e.g. 'Light.Set'
	 * @param {object} params  Key/value query params
	 */
	async shellyRpc(method, params = {}) {
		const profile = DEVICE_PROFILES[this.config.deviceType] ?? DEVICE_PROFILES['shelly-dali-dimmer-gen3']
		const host = this.config.host ?? '127.0.0.1'
		const port = this.config.port ?? DEFAULT_PORT

		const query = new URLSearchParams({ id: String(profile.lightId), ...params }).toString()
		const url = `http://${host}:${port}${profile.rpcPath}/${method}?${query}`

		try {
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 5000)
			const response = await fetch(url, { signal: controller.signal })
			clearTimeout(timeoutId)
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			return await response.json()
		} catch (err) {
			this.log('error', `Shelly RPC error [${method}]: ${err.message} (URL: ${url})`)
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
			throw err
		}
	}

	// ── Polling ────────────────────────────────

	startPolling() {
		const interval = this.config.pollingInterval ?? 3000
		if (interval > 0) {
			this.pollTimer = setInterval(() => this.pollStatus(), interval)
		}
	}

	stopPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	async pollStatus() {
		try {
			const status = await this.shellyRpc('Light.GetStatus')
			this.lightStatus = { output: !!status.output, brightness: status.brightness ?? 0 }
			this.updateStatus(InstanceStatus.Ok)
			this.updateVariableValues()
			this.checkFeedbacks('light_is_on', 'brightness_level')
		} catch (_) {
			// error already logged in shellyRpc()
		}
	}

	// ── Actions ────────────────────────────────

	initActions() {
		this.setActionDefinitions({

			light_on: {
				name: 'Light – On',
				options: [],
				callback: async () => {
					await this.shellyRpc('Light.Set', { on: 'true' })
					this.lightStatus.output = true
					this.updateVariableValues()
					this.checkFeedbacks('light_is_on')
				},
			},

			light_off: {
				name: 'Light – Off',
				options: [],
				callback: async () => {
					await this.shellyRpc('Light.Set', { on: 'false' })
					this.lightStatus.output = false
					this.updateVariableValues()
					this.checkFeedbacks('light_is_on')
				},
			},

			light_toggle: {
				name: 'Light – Toggle',
				options: [],
				callback: async () => {
					await this.shellyRpc('Light.Toggle', {})
					this.lightStatus.output = !this.lightStatus.output
					this.updateVariableValues()
					this.checkFeedbacks('light_is_on')
				},
			},

			dim_up: {
				name: 'Dim Up (step)',
				options: [
					{
						// CONFIGURABLE: Default dim step for Dim Up
						type: 'number',
						id: 'step',
						label: 'Step (%)',
						default: DEFAULT_STEP,
						min: 1,
						max: 100,
					},
				],
				callback: async (action) => {
					const step = action.options.step ?? DEFAULT_STEP
					await this.shellyRpc('Light.Set', { offset: String(step) })
					this.lightStatus.brightness = Math.min(100, this.lightStatus.brightness + step)
					this.updateVariableValues()
					this.checkFeedbacks('brightness_level')
				},
			},

			dim_down: {
				name: 'Dim Down (step)',
				options: [
					{
						// CONFIGURABLE: Default dim step for Dim Down
						type: 'number',
						id: 'step',
						label: 'Step (%)',
						default: DEFAULT_STEP,
						min: 1,
						max: 100,
					},
				],
				callback: async (action) => {
					const step = action.options.step ?? DEFAULT_STEP
					await this.shellyRpc('Light.Set', { offset: String(-step) })
					this.lightStatus.brightness = Math.max(0, this.lightStatus.brightness - step)
					this.updateVariableValues()
					this.checkFeedbacks('brightness_level')
				},
			},

			set_brightness: {
				name: 'Set Brightness (%)',
				options: [
					{
						type: 'number',
						id: 'brightness',
						label: 'Brightness (0–100)',
						default: 100,
						min: 0,
						max: 100,
					},
				],
				callback: async (action) => {
					const brightness = action.options.brightness ?? 100
					await this.shellyRpc('Light.Set', { brightness: String(brightness), on: brightness > 0 ? 'true' : 'false' })
					this.lightStatus.brightness = brightness
					this.lightStatus.output = brightness > 0
					this.updateVariableValues()
					this.checkFeedbacks('light_is_on', 'brightness_level')
				},
			},
		})
	}

	// ── Variables ─────────────────────────────

	initVariables() {
		this.setVariableDefinitions([
			{ variableId: 'light_state', name: 'Light State (ON/OFF)' },
			{ variableId: 'brightness', name: 'Brightness (0–100)' },
			{ variableId: 'brightness_bar', name: 'Brightness Bar' },
		])
		this.updateVariableValues()
	}

	/**
	 * Build a text-based slider bar, e.g. "▓▓▓▓▓▓▓▓░░ 80%"
	 */
	_buildBar(pct) {
		const total = 12
		const pos = Math.round((pct / 100) * total)
		const before = '━'.repeat(pos)
		const after = '─'.repeat(total - pos)
		return `🔅${before}●${after}🔆 ${pct}%`
	}

	updateVariableValues() {
		const pct = this.lightStatus.brightness
		this.setVariableValues({
			light_state: this.lightStatus.output ? 'ON' : 'OFF',
			brightness: pct,
			brightness_bar: this._buildBar(pct),
		})
	}

	// ── Feedbacks ──────────────────────────────

	initFeedbacks() {
		this.setFeedbackDefinitions({

			light_is_on: {
				name: 'Light is ON',
				type: 'boolean',
				defaultStyle: {
					bgcolor: combineRgb(255, 200, 0),
					color: combineRgb(0, 0, 0),
				},
				options: [],
				callback: () => this.lightStatus.output,
			},

			brightness_level: {
				name: 'Brightness level (show on button)',
				type: 'advanced',
				options: [],
				callback: () => {
					const pct = this.lightStatus.brightness ?? 0
					const on = this.lightStatus.output
					return {
						text: on ? `${pct}%` : 'OFF',
						color: combineRgb(255, 255, 255),
						bgcolor: on
							? combineRgb(Math.round((1 - pct / 100) * 30), Math.round(60 + (pct / 100) * 100), 0)
							: combineRgb(40, 40, 40),
					}
				},
			},
		})
	}
}

// ── Entrypoint ─────────────────────────────────
runEntrypoint(ShellyDaliDimmerInstance, [])

