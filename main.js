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
const WebSocket = require('ws')

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
// CONFIGURABLE: Push event labels and auto-reset delay
// Maps Shelly WebSocket NotifyEvent names → display labels
// ─────────────────────────────────────────────
const PUSH_EVENT_MAP = {
	'single_push': 'Single',
	'double_push': 'Dobbelt',
	'triple_push': 'Tripple',
	'long_push': 'Langt',
}
const PUSH_RESET_MS = 3000

// ─────────────────────────────────────────────
// Module class
// ─────────────────────────────────────────────
class ShellyDaliDimmerInstance extends InstanceBase {
	/** Current known light status {output: bool, brightness: number} */
	lightStatus = { output: false, brightness: 0 }
	pollTimer = null
	/** Active fade interval (cleared on new fade or destroy) */
	_fadeTimer = null
	/** Current push type display values per input */
	_pushType = ['N/A', 'N/A']
	_pushResetTimer = [null, null]
	/** WebSocket state */
	ws = null
	wsConnected = false
	wsReconnectTimer = null
	wsMsgId = 1

	// ── Lifecycle ──────────────────────────────

	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Ok)
		this.initVariables()
		this.initActions()
		this.initFeedbacks()
		this.startPolling()
		this._connectWebSocket()
	}

	async destroy() {
		this.stopPolling()
		this._cancelFade()
		this._cleanupWs()
		for (const t of this._pushResetTimer) {
			if (t) clearTimeout(t)
		}
		this._pushResetTimer = [null, null]
	}

	async configUpdated(config) {
		this.config = config
		this.stopPolling()
		this._cleanupWs()
		this.updateStatus(InstanceStatus.Ok)
		this.initVariables()
		this.initActions()
		this.initFeedbacks()
		this.startPolling()
		this._connectWebSocket()
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

	// ── WebSocket (input events) ──────────────

	_connectWebSocket() {
		if (!this.config || !this.config.host) return

		const port = parseInt(this.config.port) || DEFAULT_PORT
		const url = `ws://${this.config.host}:${port}/rpc`
		this.log('debug', `WS connecting to ${url}`)

		let ws
		try {
			ws = new WebSocket(url, { handshakeTimeout: 4000 })
		} catch (err) {
			this.log('error', `WS creation failed: ${err.message}`)
			this._scheduleReconnect()
			return
		}
		this.ws = ws

		ws.on('open', () => {
			this.wsConnected = true
			this.log('debug', 'WS connected')
			// Subscribe to device events
			this._wsSend('Shelly.GetStatus', {})
		})

		ws.on('message', (data) => {
			try {
				this._handleWsMessage(JSON.parse(data.toString()))
			} catch (e) {
				this.log('warn', `WS parse error: ${e.message}`)
			}
		})

		ws.on('close', () => {
			this.wsConnected = false
			this.log('debug', 'WS closed')
			this._scheduleReconnect()
		})

		ws.on('error', (err) => {
			this.log('error', `WS error: ${err.message}`)
			this.wsConnected = false
			ws.close()
		})
	}

	_cleanupWs() {
		if (this.wsReconnectTimer) {
			clearTimeout(this.wsReconnectTimer)
			this.wsReconnectTimer = null
		}
		if (this.ws) {
			this.ws.removeAllListeners()
			this.ws.close()
			this.ws = null
		}
		this.wsConnected = false
	}

	_scheduleReconnect() {
		if (this.wsReconnectTimer) return
		this.wsReconnectTimer = setTimeout(() => {
			this.wsReconnectTimer = null
			this._connectWebSocket()
		}, 5000)
	}

	_wsSend(method, params) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
		const frame = { id: this.wsMsgId++, src: 'companion-shelly', method, params }
		this.ws.send(JSON.stringify(frame))
	}

	_handleWsMessage(msg) {
		// NotifyEvent — real-time button events from the device
		if (msg.method === 'NotifyEvent') {
			const events = msg.params && msg.params.events
			if (!Array.isArray(events)) return

			for (const ev of events) {
				let idx = -1
				if (ev.component === 'input:0') idx = 0
				else if (ev.component === 'input:1') idx = 1
				if (idx === -1) continue

				this.log('debug', `Input ${idx} event: ${ev.event}`)

				const label = PUSH_EVENT_MAP[ev.event]
				if (label) {
					this._updateInputPushType(idx, label)
				}
			}
		}
	}

	_updateInputPushType(idx, type) {
		if (this._pushResetTimer[idx]) {
			clearTimeout(this._pushResetTimer[idx])
			this._pushResetTimer[idx] = null
		}

		this._pushType[idx] = type
		this.updateVariableValues()

		if (type !== 'N/A') {
			this._pushResetTimer[idx] = setTimeout(() => {
				this._pushResetTimer[idx] = null
				this._updateInputPushType(idx, 'N/A')
			}, PUSH_RESET_MS)
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

			fade_to_brightness: {
				name: 'Fade to Brightness',
				options: [
					{
						type: 'number',
						id: 'target',
						label: 'Target Brightness (0–100)',
						default: 100,
						min: 0,
						max: 100,
					},
					{
						type: 'number',
						id: 'duration',
						label: 'Duration (seconds)',
						default: 3,
						min: 0.5,
						max: 60,
						step: 0.5,
					},
				],
				callback: async (action) => {
					const target = Math.round(action.options.target ?? 100)
					const duration = action.options.duration ?? 3
					this._startFade(target, duration)
				},
			},
		})
	}

	// ── Fade helpers ─────────────────────────────

	_cancelFade() {
		if (this._fadeTimer) {
			clearInterval(this._fadeTimer)
			this._fadeTimer = null
		}
	}

	_startFade(target, durationSec) {
		this._cancelFade()

		const startBrightness = this.lightStatus.brightness
		const diff = target - startBrightness
		if (diff === 0) return

		// Calculate update interval: aim for ~20 steps/sec but at least 1 step per tick
		const TICK_MS = 50
		const totalTicks = Math.max(1, Math.round((durationSec * 1000) / TICK_MS))
		let currentTick = 0

		this._fadeTimer = setInterval(async () => {
			currentTick++
			const progress = Math.min(currentTick / totalTicks, 1)
			const newBrightness = Math.round(startBrightness + diff * progress)

			try {
				await this.shellyRpc('Light.Set', {
					brightness: String(newBrightness),
					on: newBrightness > 0 ? 'true' : 'false',
				})
				this.lightStatus.brightness = newBrightness
				this.lightStatus.output = newBrightness > 0
				this.updateVariableValues()
				this.checkFeedbacks('light_is_on', 'brightness_level')
			} catch (_) {
				// error logged in shellyRpc
			}

			if (progress >= 1) {
				this._cancelFade()
			}
		}, TICK_MS)
	}

	// ── Variables ─────────────────────────────

	initVariables() {
		this.setVariableDefinitions([
			{ variableId: 'light_state', name: 'Light State (ON/OFF)' },
			{ variableId: 'brightness', name: 'Brightness (0–100)' },
			{ variableId: 'brightness_bar', name: 'Brightness Bar' },
			{ variableId: 'input_push_type_0', name: 'Input 0 Push Type' },
			{ variableId: 'input_push_type_1', name: 'Input 1 Push Type' },
		])
		this.updateVariableValues()
	}

	/**
	 * Build a text-based slider bar, e.g. "▓▓▓▓▓▓▓▓░░ 80%"
	 */
	_buildBar(pct) {
		const total = 10
		const filled = Math.round((pct / 100) * total)
		const before = '▰'.repeat(filled)
		const after = '▱'.repeat(total - filled)
		return `${before}${after} ${pct}%`
	}

	updateVariableValues() {
		const pct = this.lightStatus.brightness
		this.setVariableValues({
			light_state: this.lightStatus.output ? 'ON' : 'OFF',
			brightness: pct,
			brightness_bar: this._buildBar(pct),
			input_push_type_0: this._pushType[0],
			input_push_type_1: this._pushType[1],
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

