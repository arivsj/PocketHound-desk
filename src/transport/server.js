/**
 * Servidor do celular — a ponta que o PocketHound (Android) enxerga.
 *
 * Recebe os quadros do plugin e os repassa. Também é aqui que nascem os
 * quadros **efêmeros** do PC (`desk.state`, `notice`), que não entram no anel
 * de replay e por isso carregam `seq: 0` — o celular sabe que `seq === 0`
 * nunca avança o cursor.
 *
 * Segurança: **nunca** se confia no endereço de origem. Estar na mesma rede,
 * vir de 127.0.0.1 ou de um IP privado não autoriza nada; só o token do
 * dispositivo, comparado por hash com tempo constante, autoriza. Essa foi a
 * falha crítica do projeto anterior e aqui ela não se repete.
 *
 * @module pockethound-desk/transport-server
 */

'use strict'

const { EventEmitter } = require('node:events')
const { createServer } = require('node:http')
const { createSocket } = require('node:dgram')

const { PROTOCOL_VERSION, OUTBOUND, frame } = require('../core/protocol.js')

/** Teto do corpo aceito nas rotas do celular. */
const MAX_BODY = 256 * 1024

/**
 * A partir de quantos bytes pendentes no socket consideramos o celular "para trás".
 * 512 KiB dá folga para uma rajada e ainda assim evita buffer sem limite.
 */
const BACKPRESSURE_BYTES = 512 * 1024

/** Quadros efêmeros que o próximo substitui — podem ser descartados sem perda. */
const SUBSTITUIVEIS = new Set(['desk.state', 'pong', 'replay.done'])

/**
 * Um quadro pode ser descartado quando o celular está para trás?
 *
 * Deltas de texto SIM: o `text.done` seguinte consolida a mensagem inteira, e o
 * agrupamento de 40 ms já os junta. Quadros de controle NÃO: uma aprovação
 * perdida trava a sessão, e perder um `session.upsert` faz a tela mentir.
 *
 * @param {object} outgoing - quadro a enviar.
 * @returns {boolean} se é seguro descartar.
 */
function descartavel(outgoing) {
  if (SUBSTITUIVEIS.has(outgoing.type)) return true
  if (outgoing.type !== 'turn.event') return false
  const kind = outgoing.payload?.kind
  return kind === 'text.delta' || kind === 'reasoning.delta'
}

/**
 * Lê e analisa o corpo JSON de uma requisição.
 * @param {import('node:http').IncomingMessage} req - requisição.
 * @returns {Promise<object>} corpo analisado.
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('corpo grande demais')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) { resolve({}); return }
      try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

/** Servidor que atende os celulares pareados. */
class TransportServer extends EventEmitter {
  /**
   * @param {object} options - dependências.
   * @param {import('../core/config.js').Store} options.store - configuração e dispositivos.
   * @param {number} options.port - porta de escuta.
   * @param {string} options.host - interface de escuta.
   */
  constructor(options) {
    super()
    this.store = options.store
    this.host = options.host ?? '0.0.0.0'
    this.port = options.port ?? 7411
    this.server = null
    this.beacon = null
    /** @type {Set<{send: Function, device: object, cursor: number}>} */
    this.clients = new Set()
    this.ring = []
    this.ringLimit = 4000
    this.stats = { framesIn: 0, framesOut: 0, connects: 0, rejects: 0, dropped: 0 }
  }

  /** Sobe o servidor HTTP e o farol de descoberta. */
  start() {
    this.server = createServer((req, res) => {
      this.#handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    this.server.on('clientError', (_error, socket) => socket.destroy())

    // Em Node, um evento 'error' sem listener e LANCADO. Sem isto, uma porta
    // ocupada derrubaria o app em vez de mostrar "nao subiu".
    // Nome proprio ('bind-error') de proposito: emitir 'error' sem ouvinte
    // lancaria pela segunda vez, que e o erro que estamos evitando.
    this.server.on('error', (error) => {
      this.failure = error?.code ?? 'erro'
      this.emit('bind-error', error)
    })

    this.server.listen(this.port, this.host, () => {
      const address = this.server.address()
      this.port = typeof address === 'object' && address ? address.port : this.port
      this.failure = undefined
      this.#startBeacon()
      this.emit('listening', { port: this.port, host: this.host })
    })
  }

  /** Encerra servidor e farol. */
  stop() {
    if (this.beacon) {
      try { this.beacon.close() } catch { /* já fechado */ }
      this.beacon = null
    }
    for (const client of this.clients) {
      try { client.send = () => {} } catch { /* ignora */ }
    }
    this.clients.clear()
    if (this.server) { this.server.close(); this.server = null }
  }

  /** @returns {number} celulares conectados agora. */
  get phoneCount() {
    return this.clients.size
  }

  /** @returns {object} retrato para a interface. */
  status() {
    return {
      listening: Boolean(this.server) && !this.failure,
      failure: this.failure,
      host: this.host,
      port: this.port,
      phones: this.clients.size,
      ring: this.ring.length,
      stats: { ...this.stats },
      devices: this.store.listDevices(),
    }
  }

  /**
   * Recebe um quadro do plugin e distribui.
   * @param {object} incoming - quadro do plugin.
   */
  ingest(incoming) {
    this.stats.framesIn += 1
    // O anel existe para o caso do celular cair e voltar enquanto o plugin
    // ainda está vivo. Não substitui o replay do plugin, complementa.
    if (Number(incoming.seq) > 0) {
      this.ring.push(incoming)
      if (this.ring.length > this.ringLimit) this.ring.splice(0, this.ring.length - this.ringLimit)
    }
    this.broadcast(incoming)
  }

  /**
   * Entrega um quadro a todos os celulares conectados.
   * @param {object} outgoing - quadro a enviar.
   */
  broadcast(outgoing) {
    for (const client of [...this.clients]) {
      try {
        client.send(outgoing)
        this.stats.framesOut += 1
      } catch {
        this.clients.delete(client)
      }
    }
  }

  /**
   * Publica um quadro efêmero do PC (nunca entra no anel, `seq: 0`).
   * @param {string} type - tipo do quadro.
   * @param {object} payload - conteúdo.
   */
  publishEphemeral(type, payload) {
    this.broadcast(frame(type, payload, { seq: 0 }))
  }

  /** Sobe o farol UDP que deixa o celular achar o PC na mesma rede. */
  #startBeacon() {
    try {
      this.beacon = createSocket({ type: 'udp4', reuseAddr: true })
      this.beacon.bind(() => {
        try { this.beacon.setBroadcast(true) } catch { /* rede sem broadcast */ }
      })
      this.beacon.on('error', () => { this.beacon = null })
    } catch {
      this.beacon = null
    }
  }

  /**
   * Anuncia a presença do PC na rede local.
   * @param {object} info - o que anunciar (`name`, `version`, `mode`).
   */
  announce(info) {
    if (!this.beacon) return
    const payload = Buffer.from(JSON.stringify({
      service: 'pockethound',
      v: PROTOCOL_VERSION,
      port: this.port,
      name: info.name,
      mode: info.mode,
      at: Date.now(),
    }))
    try {
      this.beacon.send(payload, 0, payload.length, 7412, '255.255.255.255')
    } catch { /* sem rota de broadcast: o celular ainda pode digitar o IP */ }
  }

  /**
   * Confere o token do dispositivo.
   * @param {import('node:http').IncomingMessage} req - requisição.
   * @returns {object|undefined} o dispositivo autorizado.
   */
  #device(req) {
    const header = String(req.headers.authorization ?? '')
    if (!header.startsWith('Bearer ')) return undefined
    return this.store.authenticate(header.slice(7))
  }

  /**
   * Roteia uma requisição do celular.
   * @param {import('node:http').IncomingMessage} req - requisição.
   * @param {import('node:http').ServerResponse} res - resposta.
   */
  async #handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname.replace(/\/+$/, '') || '/'

    // Dois caminhos abertos, e só dois.
    if (route === '/ph/ping') {
      this.#json(res, 200, { service: 'pockethound', v: PROTOCOL_VERSION, at: Date.now() })
      return
    }

    // Pareamento. É a ÚNICA rota aberta que devolve segredo, e por isso a
    // credencial aqui é o próprio código: 6 dígitos, uso único, TTL de 120 s e
    // teto de 5 tentativas (o Store cuida disso e invalida ao estourar).
    //
    // Note o que NÃO se faz: não se libera por IP de origem. Na rede local, o
    // IP não prova nada — no projeto anterior um proxy fazia requisição remota
    // chegar como loopback e ganhar as rotas administrativas sem token.
    if (route === '/ph/pair') {
      if (req.method !== 'POST') {
        this.#json(res, 405, { error: { code: 'METHOD', message: 'use POST' } })
        return
      }
      let corpo
      try {
        corpo = await readJson(req)
      } catch {
        this.#json(res, 400, { error: { code: 'BAD_BODY', message: 'corpo inválido' } })
        return
      }
      const resultado = this.store.pair({
        code: String(corpo.code ?? ''),
        name: String(corpo.name ?? 'celular').slice(0, 60),
        fingerprint: corpo.fingerprint,
      })
      if (!resultado.ok) {
        this.stats.rejects += 1
        // A mensagem é genérica de propósito: dizer "código errado" vs "código
        // expirado" ajudaria quem está tentando adivinhar.
        this.#json(res, 401, { error: { code: 'PAIR_FAILED', message: 'código inválido ou expirado' } })
        return
      }
      this.emit('paired', resultado.device)
      // O token em claro existe UMA vez, nesta resposta. Depois disso o desk só
      // guarda o SHA-256.
      this.#json(res, 200, {
        ok: true,
        v: PROTOCOL_VERSION,
        device: { id: resultado.device.id, name: resultado.device.name },
        token: resultado.token,
        transport: { host: this.host, port: this.port },
      })
      return
    }

    const device = this.#device(req)
    if (!device) {
      this.stats.rejects += 1
      this.#json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'token inválido ou revogado' } })
      return
    }
    this.store.touch(device.id)

    switch (route) {
      case '/ph/hello':
        this.#json(res, 200, {
          ok: true,
          v: PROTOCOL_VERSION,
          device: { id: device.id, name: device.name },
          cursor: this.#cursor(),
          phones: this.clients.size,
        })
        return

      case '/ph/stream':
        this.#stream(req, res, url, device)
        return

      case '/ph/frame': {
        // Canal de saída do celular: um POST simples por comando.
        const body = await readJson(req)
        const result = await this.#command(device, body)
        this.#json(res, result.ok ? 200 : 400, result)
        return
      }

      default:
        this.#json(res, 404, { error: { code: 'NOT_FOUND', message: route } })
    }
  }

  /** @returns {number} maior seq conhecido no anel. */
  #cursor() {
    const last = this.ring[this.ring.length - 1]
    return last ? Number(last.seq) : 0
  }

  /**
   * Trata um comando vindo do celular, avisando quem escuta.
   * @param {object} device - dispositivo autenticado.
   * @param {object} body - quadro enviado pelo app.
   * @returns {Promise<object>} resultado do comando.
   */
  async #command(device, body) {
    const type = String(body?.type ?? '')
    const payload = body?.payload ?? {}
    // O desk só valida a forma; quem executa é quem escuta (`main.js`),
    // que tem o link do plugin e a fila de aprovações.
    this.emit('command', { device, type, payload })
    return { ok: true, type, deviceId: device.id }
  }

  /**
   * Responde JSON.
   * @param {import('node:http').ServerResponse} res - resposta.
   * @param {number} status - código HTTP.
   * @param {unknown} body - corpo serializável.
   */
  #json(res, status, body) {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
    })
    res.end(text)
  }

  /**
   * Abre o SSE de um celular, fazendo o replay pedido pelo cursor.
   * @param {import('node:http').IncomingMessage} req - requisição.
   * @param {import('node:http').ServerResponse} res - resposta.
   * @param {URL} url - URL com `cursor`.
   * @param {object} device - dispositivo autenticado.
   */
  #stream(req, res, url, device) {
    const cursor = Number(url.searchParams.get('cursor') ?? '0')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const client = { device, cursor: cursor, since: Date.now(), dropped: 0, send: () => {} }

    /**
     * Entrega um quadro, respeitando a contrapressão do celular.
     *
     * Sem isto, uma rede móvel lenta faz o buffer do socket crescer sem limite:
     * o PC produz quadros na velocidade do modelo e o celular consome na
     * velocidade do rádio. Descartar o substituível é o que mantém a memória
     * plana — e o cursor garante que o celular pode pedir o buraco de volta.
     *
     * @param {object} outgoing - quadro.
     * @returns {boolean} se foi entregue.
     */
    client.send = (outgoing) => {
      if (res.writableLength > BACKPRESSURE_BYTES && descartavel(outgoing)) {
        client.dropped += 1
        this.stats.dropped += 1
        return false
      }
      res.write('id: ' + (outgoing.seq || '') + '\ndata: ' + JSON.stringify(outgoing) + '\n\n')
      return true
    }

    // Replay do que o celular perdeu antes do stream ao vivo.
    for (const buffered of this.ring) {
      if (Number(buffered.seq) > cursor) client.send(buffered)
    }
    client.send(frame(OUTBOUND.REPLAY_DONE, { from: cursor, to: this.#cursor() }, { seq: 0 }))

    client.cursor = this.#cursor()
    this.clients.add(client)
    this.stats.connects += 1
    this.emit('phones', this.clients.size)

    const beat = setInterval(() => {
      try { res.write(': beat\n\n') } catch { /* conexão caiu */ }
    }, 15000)
    if (typeof beat.unref === 'function') beat.unref()

    const close = () => {
      clearInterval(beat)
      this.clients.delete(client)
      this.emit('phones', this.clients.size)
      try { res.end() } catch { /* já encerrado */ }
    }
    req.on('close', close)
    req.on('error', close)
  }
}

module.exports = { TransportServer, descartavel, BACKPRESSURE_BYTES }
