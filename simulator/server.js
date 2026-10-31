import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { loadConfig, saveConfig, SIMULATOR_DIR } from './config.js'
import { MockMqttBroker } from './mqtt-broker.js'
import { ProtocolRegistry } from './protocol.js'
import { VideoSender } from './video-sender.js'

const PUBLIC_DIR = path.join(SIMULATOR_DIR, 'public')
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const MAX_LOG_ENTRIES = 300

class EventStream {
  constructor() {
    this.clients = new Set()
  }

  add(response) {
    this.clients.add(response)
    response.write(': connected\n\n')
    return () => this.clients.delete(response)
  }

  send(event, data) {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const response of this.clients) {
      try {
        response.write(chunk)
      } catch {
        this.clients.delete(response)
      }
    }
  }

  close() {
    for (const response of this.clients) response.end()
    this.clients.clear()
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw new Error('请求体超过 2 MiB 限制')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function contentType(filePath) {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function serveStatic(requestPath, response) {
  const requested = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath.slice(1))
  const filePath = path.resolve(PUBLIC_DIR, requested)
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    json(response, 404, { success: false, error: 'Not found' })
    return
  }
  const body = fs.readFileSync(filePath)
  response.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Content-Length': body.length,
    'Cache-Control': 'no-cache'
  })
  response.end(body)
}

function portNumber(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} 必须是 1 到 65535 的整数`)
  }
  return parsed
}

function numberInRange(value, name, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} 必须在 ${min} 到 ${max} 之间`)
  }
  return parsed
}

function mergeVideoConfig(base, body) {
  return {
    videoPath: String(body.videoPath ?? base.videoPath),
    loop: Boolean(body.loop ?? base.loop),
    startOnLaunch: Boolean(body.startOnLaunch ?? base.startOnLaunch),
    targetHost: String(body.targetHost ?? base.targetHost),
    targetPort: portNumber(body.targetPort ?? base.targetPort, 'targetPort'),
    width: numberInRange(body.width ?? base.width, 'width', 160, 7680),
    height: numberInRange(body.height ?? base.height, 'height', 120, 4320),
    fps: numberInRange(body.fps ?? base.fps, 'fps', 1, 120),
    bitrateKbps: numberInRange(body.bitrateKbps ?? base.bitrateKbps, 'bitrateKbps', 100, 100000),
    gop: numberInRange(body.gop ?? base.gop, 'gop', 1, 600),
    fragmentPayloadBytes: numberInRange(
      body.fragmentPayloadBytes ?? base.fragmentPayloadBytes,
      'fragmentPayloadBytes',
      1,
      1392
    ),
    packetLossPercent: numberInRange(
      body.packetLossPercent ?? base.packetLossPercent,
      'packetLossPercent',
      0,
      100
    )
  }
}

function openBrowser(url) {
  if (process.env.NO_BROWSER === '1') return
  let command
  let args
  if (process.platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    command = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return
    command = 'xdg-open'
    args = [url]
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

async function main() {
  let config = loadConfig()
  process.env.SIMULATOR_PROTO_PATH = config.protocol.protoFile

  const protocol = await ProtocolRegistry.load(config.protocol.protoFile, { robotId: config.protocol.robotId })
  const broker = new MockMqttBroker({ protocol })
  const video = new VideoSender()
  const events = new EventStream()
  const schedules = new Map()
  const logs = []
  const lastMessageLogAt = new Map()
  let logSequence = 0

  const addLog = ({ level = 'info', source = 'SYSTEM', message, details = null }) => {
    const entry = {
      id: ++logSequence,
      time: new Date().toISOString(),
      level,
      source,
      message,
      details
    }
    logs.push(entry)
    if (logs.length > MAX_LOG_ENTRIES) logs.splice(0, logs.length - MAX_LOG_ENTRIES)
    events.send('log', entry)
    const consoleMethod = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log
    consoleMethod(`[${entry.source}] ${entry.message}`)
    return entry
  }

  const broadcastState = () => events.send('state', getState())

  const getState = () => ({
    broker: broker.state,
    video: video.state,
    schedules: [...schedules.values()].map(({ timer: _timer, ...entry }) => entry),
    config: {
      configPath: config.configPath,
      expectedClientId: config.mqtt.expectedClientId,
      mqtt: config.mqtt,
      udpVideo: config.udpVideo,
      protocolFile: config.protocol.protoFile,
      robotId: config.protocol.robotId
    }
  })

  broker.on('log', addLog)
  broker.on('state', broadcastState)
  broker.on('client-change', (state) => {
    const expected = config.mqtt.expectedClientId.trim()
    if (expected) {
      for (const clientId of state.clients) {
        if (clientId !== expected) {
          addLog({
            level: 'warning',
            source: 'MQTT',
            message: `Client ID 为 ${clientId}，正式协议配置期望机器人 ID ${expected}`
          })
        }
      }
    }
    broadcastState()
  })
  broker.on('message', (entry) => {
    const key = `${entry.clientId}:${entry.topic}`
    const now = Date.now()
    const interval = entry.direction === 'client-to-server' ? 250 : 1000
    if (now - (lastMessageLogAt.get(key) ?? 0) < interval) return
    lastMessageLogAt.set(key, now)
    addLog({
      level: entry.decodeError ? 'error' : 'data',
      source: entry.direction === 'client-to-server' ? 'MQTT ↑' : 'MQTT ↓',
      message: `${entry.topic} · ${entry.bytes} B · QoS ${entry.qos} · ${entry.clientId}`,
      details: entry.decoded ?? { decodeError: entry.decodeError, rawHex: entry.rawHex }
    })
  })
  video.on('log', addLog)
  video.on('state', broadcastState)
  video.on('stats', (stats) => events.send('video-stats', stats))

  const startSchedule = async ({ topic, payload, frequencyHz, qos = config.mqtt.qos }) => {
    if (!protocol.hasTopic(topic)) throw new Error(`未知 topic：${topic}`)
    const hz = numberInRange(frequencyHz, 'frequencyHz', 0.1, 100)
    const selectedQos = numberInRange(qos, 'qos', 0, 1)
    const encodedCheck = protocol.encode(topic, payload)
    if (!encodedCheck.length && Object.keys(payload).length) {
      throw new Error(`${topic} 编码为空，请检查字段名`)
    }

    const existing = schedules.get(topic)
    if (existing) clearInterval(existing.timer)

    const publish = async () => {
      try {
        await broker.publish(topic, payload, { qos: selectedQos })
      } catch (error) {
        addLog({ level: 'error', source: 'MQTT', message: `${topic} 定时发送失败：${error.message}` })
      }
    }
    await publish()
    const timer = setInterval(publish, Math.max(10, Math.round(1000 / hz)))
    schedules.set(topic, {
      topic,
      payload,
      frequencyHz: hz,
      qos: selectedQos,
      startedAt: new Date().toISOString(),
      timer
    })
    addLog({ level: 'success', source: 'MQTT', message: `${topic} 已开始按 ${hz} Hz 发送` })
    broadcastState()
  }

  const stopSchedule = (topic) => {
    const entry = schedules.get(topic)
    if (!entry) return false
    clearInterval(entry.timer)
    schedules.delete(topic)
    addLog({ level: 'info', source: 'MQTT', message: `${topic} 定时发送已停止` })
    broadcastState()
    return true
  }

  const stopAllSchedules = () => {
    for (const entry of schedules.values()) clearInterval(entry.timer)
    schedules.clear()
    addLog({ level: 'info', source: 'MQTT', message: '所有定时消息已停止' })
    broadcastState()
  }

  const handleApi = async (request, response, pathname) => {
    if (request.method === 'GET' && pathname === '/api/protocol') {
      json(response, 200, {
        success: true,
        specification: {
          version: 'V2.0.0 (2026-06-26)',
          mqtt: { port: 3333, qosMax: 1, payload: 'Protobuf v3', topic: 'message name' },
          udp: {
            port: 3334,
            codec: 'HEVC/H.265 Annex-B',
            fps: 60,
            resolution: '1920x1080',
            headerBytes: 8,
            maxDatagramBytes: 1400,
            byteOrder: 'big-endian'
          }
        },
        messages: protocol.describe()
      })
      return
    }

    if (request.method === 'GET' && pathname === '/api/state') {
      json(response, 200, { success: true, state: getState(), logs })
      return
    }

    if (request.method === 'GET' && pathname === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const remove = events.add(response)
      request.on('close', remove)
      return
    }

    const body = await readJson(request)

    if (request.method === 'POST' && pathname === '/api/broker/restart') {
      const mqttConfig = {
        host: String(body.host ?? config.mqtt.host),
        port: portNumber(body.port ?? config.mqtt.port, 'port')
      }
      stopAllSchedules()
      await broker.restart(mqttConfig)
      config = { ...config, mqtt: { ...config.mqtt, ...mqttConfig } }
      json(response, 200, { success: true, state: getState() })
      return
    }

    if (request.method === 'POST' && pathname === '/api/mqtt/publish') {
      const result = await broker.publish(String(body.topic), body.payload ?? {}, {
        qos: Number(body.qos ?? config.mqtt.qos),
        retain: Boolean(body.retain)
      })
      addLog({ level: 'success', source: 'MQTT', message: `${result.topic} 手动发送成功（${result.bytes} B）` })
      json(response, 200, { success: true, result })
      return
    }

    if (request.method === 'POST' && pathname === '/api/mqtt/schedule/start') {
      await startSchedule(body)
      json(response, 200, { success: true, schedules: getState().schedules })
      return
    }

    if (request.method === 'POST' && pathname === '/api/mqtt/schedule/stop') {
      json(response, 200, { success: true, stopped: stopSchedule(String(body.topic)) })
      return
    }

    if (request.method === 'POST' && pathname === '/api/mqtt/schedule/stop-all') {
      stopAllSchedules()
      json(response, 200, { success: true })
      return
    }

    if (request.method === 'POST' && pathname === '/api/video/start') {
      const videoConfig = mergeVideoConfig(config.udpVideo, body)
      if (body.saveToYaml) {
        config = { ...config, udpVideo: videoConfig }
        saveConfig(config)
        addLog({ level: 'success', source: 'CONFIG', message: '视频参数已写入 config.yaml' })
      }
      const state = await video.start(videoConfig)
      json(response, 200, { success: true, state })
      return
    }

    if (request.method === 'POST' && pathname === '/api/video/stop') {
      json(response, 200, { success: true, state: await video.stop() })
      return
    }

    if (request.method === 'POST' && pathname === '/api/logs/clear') {
      logs.length = 0
      events.send('logs-cleared', {})
      json(response, 200, { success: true })
      return
    }

    json(response, 404, { success: false, error: 'Unknown API endpoint' })
  }

  const webServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname.startsWith('/api/')) {
        await handleApi(request, response, url.pathname)
      } else {
        serveStatic(url.pathname, response)
      }
    } catch (error) {
      addLog({ level: 'error', source: 'HTTP', message: error.message })
      if (!response.headersSent) json(response, 400, { success: false, error: error.message })
      else response.end()
    }
  })

  await broker.start({ host: config.mqtt.host, port: config.mqtt.port })
  await new Promise((resolve, reject) => {
    webServer.once('error', reject)
    webServer.listen(config.web.port, config.web.host, resolve)
  })

  const guiUrl = `http://${config.web.host}:${config.web.port}`
  addLog({ level: 'success', source: 'GUI', message: `控制台已启动：${guiUrl}` })
  addLog({
    level: 'info',
    source: 'CONFIG',
    message: `独立配置：${config.configPath}`
  })
  if (config.web.openBrowser) openBrowser(guiUrl)

  if (config.udpVideo.startOnLaunch) {
    try {
      await video.start(config.udpVideo)
    } catch (error) {
      addLog({ level: 'error', source: 'UDP', message: `自动启动失败：${error.message}` })
    }
  }

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    addLog({ level: 'info', source: 'SYSTEM', message: `收到 ${signal}，正在停止模拟器……` })
    stopAllSchedules()
    await video.stop()
    await broker.stop()
    events.close()
    await new Promise((resolve) => webServer.close(resolve))
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error(`协议模拟器启动失败：${error.stack ?? error.message}`)
  process.exit(1)
})