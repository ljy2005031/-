import { createServer } from 'node:net'
import { EventEmitter } from 'node:events'

import { Aedes } from 'aedes'
import { connectAsync } from 'mqtt'

const PUBLISHER_CLIENT_ID = 'origin-protocol-simulator-server'

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve()
    server.close(() => resolve())
  })
}

export class MockMqttBroker extends EventEmitter {
  constructor({ protocol }) {
    super()
    this.protocol = protocol
    this.aedes = null
    this.server = null
    this.publisher = null
    this.host = null
    this.port = null
    this.clients = new Set()
    this.startedAt = null
  }

  get running() {
    return Boolean(this.server?.listening && this.publisher?.connected)
  }

  get state() {
    return {
      running: this.running,
      host: this.host,
      port: this.port,
      clients: [...this.clients].sort(),
      startedAt: this.startedAt
    }
  }

  async start({ host = '127.0.0.1', port = 3333 } = {}) {
    if (this.server || this.aedes || this.publisher) await this.stop()

    const aedes = await Aedes.createBroker()
    const server = createServer(aedes.handle)
    this.aedes = aedes
    this.server = server
    this.host = host
    this.port = port

    aedes.on('clientReady', (client) => {
      if (!client?.id || client.id === PUBLISHER_CLIENT_ID) return
      this.clients.add(client.id)
      this.emit('client-change', this.state)
      this.emit('log', {
        level: 'success',
        source: 'MQTT',
        message: `客户端已连接：${client.id}`
      })
    })

    aedes.on('clientDisconnect', (client) => {
      if (!client?.id || client.id === PUBLISHER_CLIENT_ID) return
      this.clients.delete(client.id)
      this.emit('client-change', this.state)
      this.emit('log', {
        level: 'warning',
        source: 'MQTT',
        message: `客户端已断开：${client.id}`
      })
    })

    aedes.on('clientError', (client, error) => {
      this.emit('log', {
        level: 'error',
        source: 'MQTT',
        message: `客户端 ${client?.id ?? 'unknown'} 错误：${error.message}`
      })
    })

    aedes.on('publish', (packet, client) => {
      if (!packet?.topic || packet.topic.startsWith('$SYS/')) return
      const sourceClientId = client?.id ?? 'broker'
      const fromSimulator = sourceClientId === PUBLISHER_CLIENT_ID
      let decoded = null
      let decodeError = null

      if (this.protocol.hasTopic(packet.topic)) {
        try {
          decoded = this.protocol.decode(packet.topic, packet.payload)
        } catch (error) {
          decodeError = error.message
        }
      }

      this.emit('message', {
        direction: fromSimulator ? 'server-to-client' : 'client-to-server',
        clientId: sourceClientId,
        topic: packet.topic,
        qos: packet.qos,
        bytes: packet.payload?.length ?? 0,
        decoded,
        decodeError,
        rawHex: decoded ? null : Buffer.from(packet.payload ?? []).toString('hex').slice(0, 512)
      })
    })

    server.on('error', (error) => {
      this.emit('log', { level: 'error', source: 'MQTT', message: error.message })
    })

    try {
      await listen(server, port, host)
      const actualAddress = server.address()
      this.port = typeof actualAddress === 'object' && actualAddress ? actualAddress.port : port
      this.publisher = await connectAsync(`mqtt://127.0.0.1:${this.port}`, {
        clientId: PUBLISHER_CLIENT_ID,
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: 5000
      })
      this.startedAt = new Date().toISOString()
      this.emit('state', this.state)
      this.emit('log', {
        level: 'success',
        source: 'MQTT',
        message: `Broker 已监听 ${host}:${this.port}（MQTT 3.1.1）`
      })
      return this.state
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop() {
    const publisher = this.publisher
    const server = this.server
    const aedes = this.aedes

    this.publisher = null
    this.server = null
    this.aedes = null
    this.clients.clear()

    if (publisher) {
      try {
        await publisher.endAsync(true)
      } catch {
        publisher.end(true)
      }
    }
    await closeServer(server)
    if (aedes) await aedes.close()

    this.startedAt = null
    this.emit('state', this.state)
  }

  async restart(config) {
    await this.stop()
    return this.start(config)
  }

  async publish(topic, payload, { qos = 1, retain = false } = {}) {
    if (!this.publisher?.connected) throw new Error('MQTT Broker 尚未启动')
    if (![0, 1].includes(qos)) throw new Error('协议规定最高 QoS 为 1')

    const encoded = this.protocol.encode(topic, payload)
    await this.publisher.publishAsync(topic, encoded, { qos, retain })
    return { topic, qos, retain, bytes: encoded.length }
  }
}