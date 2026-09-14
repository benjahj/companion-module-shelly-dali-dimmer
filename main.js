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
const PUSH_RESET_MS = 1000

// ─────────────────────────────────────────────
// CONFIGURABLE: WebSocket keepalive.
// The device only ever speaks to us when a physical button is pressed, so an
// idle socket can be silently evicted by any stateful firewall or NAT between
// Companion and the device. Nothing in TCP tells either end. We ping
// so the flow stays warm AND so a dead socket is detected instead of hanging
// open forever in readyState OPEN.
// ─────────────────────────────────────────────
const WS_PING_MS = 20000
const WS_RECONNECT_MIN_MS = 2000
const WS_RECONNECT_MAX_MS = 30000

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
	/** Physical button state per input (true = pressed, false = released) */
	_inputState = [false, false]
	/** WebSocket state */
	ws = null
	wsConnected = false
	wsReconnectTimer = null
	wsMsgId = 1
	/** Heartbeat state — _wsAlive is cleared on each ping, set by any inbound frame */
	_wsPingTimer = null
	_wsAlive = false
	_wsRetries = 0
	/** Last status pushed to Companion, so we only report changes */
	_status = null
	_statusMsg = null
	_httpOk = true

	// ── Lifecycle ──────────────────────────────

	async init(config) {
		this.config = config
		this._httpOk = true
		this._refreshStatus()
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
		this._wsRetries = 0
		this._httpOk = true
		this._refreshStatus()
		this.initVariables()
		this.initActions()
		this.initFeedbacks()
		this.startPolling()
		this._connectWebSocket()
	}

	// ── Status reporting ───────────────────────

	/**
	 * Only forward a status to Companion when it actually changes. Calling
	 * updateStatus() on every poll is what fills the log with one
	 * "Status: ok - null" line every polling interval.
	 */
	_setStatus(status, msg = null) {
		if (status === this._status && msg === this._statusMsg) return
		this._status = status
		this._statusMsg = msg
		this.updateStatus(status, msg)
	}

	/**
	 * Combine HTTP health and WebSocket health into one reported status.
	 * HTTP polling can be perfectly healthy while the event socket is dead —
	 * that combination must not report "ok", because button events are the
	 * half that is broken.
	 */
	_refreshStatus() {
		if (!this._httpOk) return
		if (this.wsConnected) {
			this._setStatus(InstanceStatus.Ok)
		} else {
			this._setStatus(InstanceStatus.UnknownWarning, 'Button events offline (WebSocket down)')
		}
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
			this._httpOk = false
			this._setStatus(InstanceStatus.ConnectionFailure, err.message)
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
			this._httpOk = true
			this._refreshStatus()
			this.updateVariableValues()
			this.checkFeedbacks('light_is_on', 'brightness_level')
		} catch (_) {
			// error already logged in shellyRpc()
		}
	}

	// ── WebSocket (input events) ──────────────

	_connectWebSocket() {
		if (!this.config || !this.config.host) return

		// Drop any previous socket first. Without this a lingering socket keeps
		// its listeners, can fire 'close' later and schedule a *second* reconnect,
		// and burns one of the device's 6 concurrent RPC channels.
		if (this.ws) {
			this.ws.removeAllListeners()
			try { this.ws.terminate() } catch (_) { /* already gone */ }
			this.ws = null
		}
		this._stopHeartbeat()

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
			this._wsRetries = 0
			this.log('debug', 'WS connected')
			// A request frame carrying a valid `src` is what subscribes this
			// connection to NotifyEvent / NotifyStatus. Without it the device
			// never pushes anything.
			this._wsSend('Shelly.GetStatus', {})
			this._startHeartbeat()
			this._refreshStatus()
		})

		ws.on('message', (data) => {
			this._wsAlive = true
			try {
				this._handleWsMessage(JSON.parse(data.toString()))
			} catch (e) {
				this.log('warn', `WS parse error: ${e.message}`)
			}
		})

		ws.on('pong', () => {
			this._wsAlive = true
		})

		ws.on('close', () => {
			if (this.ws !== ws) return // superseded socket, ignore
			this.wsConnected = false
			this._stopHeartbeat()
			this.log('debug', 'WS closed')
			this._refreshStatus()
			this._scheduleReconnect()
		})

		ws.on('error', (err) => {
			this.log('error', `WS error: ${err.message}`)
			this.wsConnected = false
			ws.close()
		})
	}

	// ── WebSocket heartbeat ───────────────────

	/**
	 * Ping every WS_PING_MS and terminate if the previous ping was never
	 * answered. The socket carries no traffic between button presses, so when
	 * the flow is dropped without a clean close (device reboot, Wi-Fi drop,
	 * firewall or NAT idle timeout) no FIN or RST arrives. readyState stays
	 * OPEN, 'close' never fires, and no reconnect is ever scheduled — the
	 * module sits holding a dead socket while HTTP polling keeps reporting
	 * "ok", until someone disables and re-enables the connection.
	 */
	_startHeartbeat() {
		this._stopHeartbeat()
		this._wsAlive = true
		this._wsPingTimer = setInterval(() => {
			const ws = this.ws
			if (!ws || ws.readyState !== WebSocket.OPEN) return

			if (!this._wsAlive) {
				this.log('warn', 'WS heartbeat missed — terminating dead socket and reconnecting')
				try { ws.terminate() } catch (_) { /* nothing to do */ }
				return // 'close' fires and schedules the reconnect
			}

			this._wsAlive = false
			try {
				ws.ping()
			} catch (err) {
				this.log('warn', `WS ping failed: ${err.message}`)
				try { ws.terminate() } catch (_) { /* nothing to do */ }
			}
		}, WS_PING_MS)
	}

	_stopHeartbeat() {
		if (this._wsPingTimer) {
			clearInterval(this._wsPingTimer)
			this._wsPingTimer = null
		}
		this._wsAlive = false
	}

	_cleanupWs() {
		this._stopHeartbeat()
		if (this.wsReconnectTimer) {
			clearTimeout(this.wsReconnectTimer)
			this.wsReconnectTimer = null
		}
		if (this.ws) {
			this.ws.removeAllListeners()
			// terminate(), not close(): we have just removed the listeners that
			// would observe the closing handshake, so a graceful close could
			// leave the socket half-shut and the channel allocated on the device.
			try { this.ws.terminate() } catch (_) { /* already gone */ }
			this.ws = null
		}
		this.wsConnected = false
	}

	/**
	 * Exponential backoff with jitter. A flat 5s retry against an unreachable
	 * device is 12 connection attempts a minute, forever — enough to keep a
	 * rate-limiting firewall permanently unhappy with the Companion host.
	 */
	_scheduleReconnect() {
		if (this.wsReconnectTimer) return
		const backoff = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_MIN_MS * Math.pow(2, this._wsRetries))
		const delay = Math.round(backoff * (0.5 + Math.random() * 0.5))
		this._wsRetries++
		this.log('debug', `WS reconnect in ${delay}ms`)
		this.wsReconnectTimer = setTimeout(() => {
			this.wsReconnectTimer = null
			this._connectWebSocket()
		}, delay)
	}

	_wsSend(method, params) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
		const frame = { id: this.wsMsgId++, src: 'companion-shelly', method, params }
		this.ws.send(JSON.stringify(frame))
	}

	/** The light component key this instance's profile targets, e.g. "light:0" */
	_lightKey() {
		const profile = DEVICE_PROFILES[this.config.deviceType] ?? DEVICE_PROFILES['shelly-dali-dimmer-gen3']
		return `light:${profile.lightId}`
	}

	_handleWsMessage(msg) {
		// NotifyStatus / NotifyFullStatus — real-time output and brightness.
		// The device already pushes these; using them means feedback is instant
		// instead of up to one polling interval stale, and lets the polling
		// interval be raised to a sanity check rather than the primary source.
		if (msg.method === 'NotifyStatus' || msg.method === 'NotifyFullStatus') {
			const light = msg.params && msg.params[this._lightKey()]
			if (light) {
				if (typeof light.output === 'boolean') this.lightStatus.output = light.output
				if (typeof light.brightness === 'number') this.lightStatus.brightness = light.brightness
				this.updateVariableValues()
				this.checkFeedbacks('light_is_on', 'brightness_level')
			}
			return
		}

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

				if (ev.event === 'btn_down') {
					this._inputState[idx] = true
					this.updateVariableValues()
					continue
				}

				if (ev.event === 'btn_up') {
					this._inputState[idx] = false
					this._updateInputPushType(idx, 'N/A')
					continue
				}

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
			{ variableId: 'input_state_0', name: 'Input 0 State (1=pressed, 0=released)' },
			{ variableId: 'input_state_1', name: 'Input 1 State (1=pressed, 0=released)' },
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
			input_state_0: this._inputState[0] ? 1 : 0,
			input_state_1: this._inputState[1] ? 1 : 0,
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

