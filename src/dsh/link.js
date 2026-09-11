/**
 * Link com o plugin dsh-pockethound.
 *
 * O plugin publica um anúncio em `~/.dsh/pockethound/bridge.json` com porta e
 * token efêmeros. Este módulo descobre a ponte, abre o SSE e reconecta sozinho
 * quando o Harness reinicia (o token muda a cada boot, então o anúncio é relido
 * a cada tentativa).
 *
 * Não guarda estado de domínio: só entrega quadros para quem escutar.
 *
 * @module pockethound-desk/dsh-link
 */

'use strict'

const { EventEmitter } = require('node:events')
const { existsSync, readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')

/** Caminho padrão do anúncio publicado pelo plugin. */
function defaultAnnouncementPath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'pockethound', 'bridge.json')
}

/** Cliente da ponte do plugin, com reconexão automática. */
class DshLink extends EventEmitter {
  /**
   * @param {object} [options] - ajustes.
   * @param {string} [options.announcementPath] - caminho alternativo do anúncio.
   * @param {number} [options.retryMs] - intervalo entre tentativas.
   */
  constructor(options = {}) {
    super()
    this.announcementPath = options.announcementPath ?? defaultAnnouncementPath()
    this.retryMs = options.retryMs ?? 2000
    this.abort = null
    this.timer = null
    this.running = false
    this.cursor = 0
    this.info = null
    this.stats = { frames: 0, reconnects: 0, lastFrameAt: 0, connectedAt: 0 }
  }

  /**
   * Lê o anúncio da ponte.
   * @returns {{port: number, token: string, pid: number}|null} o anúncio, ou null.
   */
  readAnnouncement() {
    try {
      if (!existsSync(this.announcementPath)) return null
      const parsed = JSON.parse(readFileSync(this.announcementPath, 'utf8'))
      if (!parsed?.port || !parsed?.token) return null
      return parsed
    } catch {
      return null
    }
  }

  /** @returns {boolean} se a ponte está conectada agora. */
  get connected() {
    return Boolean(this.info)
  }

  /**
   * Inicia o laço de conexão.
   * @param {number} [cursor] - de onde retomar o replay.
   */
  start(cursor = 0) {
    if (this.running) return
    this.running = true
    this.cursor = cursor
    this.#loop()
  }

  /** Encerra o laço e a conexão. */
  stop() {
    this.running = false
    clearTimeout(this.timer)
    this.timer = null
    if (this.abort) this.abort.abort()
    this.abort = null
    this.#setInfo(null)
  }

  /**
   * Atualiza o retrato da ponte e avisa quando muda.
   * @param {object|null} info - novo retrato.
   */
  #setInfo(info) {
    const before = this.info
    this.info = info
    if (Boolean(before) !== Boolean(info)) this.emit('connection', info)
    this.emit('status', this.status())
  }

  /** @returns {object} retrato do link para a interface. */
  status() {
    return {
      connected: this.connected,
      cursor: this.cursor,
      info: this.info,
      stats: { ...this.stats },
    }
  }

  /** Agenda a próxima tentativa. */
  #retry() {
    if (!this.running) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.#loop(), this.retryMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** Uma tentativa completa de conexão e consumo do fluxo. */
  async #loop() {
    if (!this.running) return
    const announcement = this.readAnnouncement()
    if (!announcement) {
      this.#setInfo(null)
      this.#retry()
      return
    }

    const base = 'http://127.0.0.1:' + announcement.port
    const headers = { Authorization: 'Bearer ' + announcement.token }
    this.abort = new AbortController()
    this.stats.reconnects += 1

    try {
      const health = await fetch(base + '/health', { signal: this.abort.signal }).then((r) => r.json())
      this.#setInfo({ port: announcement.port, pid: announcement.pid, startedAt: announcement.startedAt, health })
      this.stats.connectedAt = Date.now()

      const response = await fetch(base + '/stream?cursor=' + this.cursor, { headers, signal: this.abort.signal })
      if (!response.ok || !response.body) throw new Error('stream recusado: ' + response.status)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let split
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const line = block.split('\n').find((entry) => entry.startsWith('data: '))
          if (!line) continue
          try {
            const parsed = JSON.parse(line.slice(6))
            this.cursor = Math.max(this.cursor, Number(parsed.seq) || 0)
            this.stats.frames += 1
            this.stats.lastFrameAt = Date.now()
            this.emit('frame', parsed)
          } catch {
            // Um quadro ilegível não pode derrubar o link inteiro.
          }
        }
      }
      throw new Error('stream terminou')
    } catch (error) {
      if (this.running && error?.name !== 'AbortError') {
        this.#setInfo(null)
        this.emit('error', error)
      }
    }
    this.#retry()
  }

  /**
   * Entrega um prompt a uma sessão.
   * @param {object} input - `{ sessionId, text, mode }`.
   * @returns {Promise<object>} resposta da ponte.
   */
  async prompt(input) {
    return this.#post('/prompt', input)
  }

  /**
   * Aplica uma decisão de aprovação.
   * @param {object} input - `{ requestId, outcome, remember, rememberAll }`.
   * @returns {Promise<object>} resposta da ponte.
   */
  async decide(input) {
    return this.#post('/approval', input)
  }

  /**
   * Responde uma pergunta do agente.
   * @param {object} input - `{ requestId, answers }`.
   * @returns {Promise<object>} resposta da ponte.
   */
  async answer(input) {
    return this.#post('/question', input)
  }

  /**
   * Cancela o turno ativo de uma sessão.
   * @param {string} sessionId - sessão alvo.
   * @returns {Promise<object>} resposta da ponte.
   */
  async cancel(sessionId) {
    return this.#post('/cancel', { sessionId })
  }

  /**
   * Informa ao plugin quantos celulares estão conectados.
   * @param {number} phones - contagem atual.
   * @returns {Promise<object>} resposta da ponte.
   */
  async presence(phones) {
    return this.#post('/presence', { phones })
  }

  /**
   * Lista as sessões vivas na ponte.
   * @returns {Promise<object>} sessões e cursor atual.
   */
  async sessions() {
    const announcement = this.readAnnouncement()
    if (!announcement) throw new Error('ponte indisponível')
    const response = await fetch('http://127.0.0.1:' + announcement.port + '/sessions', {
      headers: { Authorization: 'Bearer ' + announcement.token },
    })
    return response.json()
  }

  /**
   * Lista as aprovações pendentes na ponte.
   * @returns {Promise<object>} pendências e cursor atual.
   */
  async pending() {
    const announcement = this.readAnnouncement()
    if (!announcement) throw new Error('ponte indisponível')
    const response = await fetch('http://127.0.0.1:' + announcement.port + '/pending', {
      headers: { Authorization: 'Bearer ' + announcement.token },
    })
    return response.json()
  }

  /**
   * Envia um POST autenticado à ponte.
   * @param {string} path - rota.
   * @param {object} body - corpo JSON.
   * @returns {Promise<object>} resposta analisada.
   */
  async #post(path, body) {
    const announcement = this.readAnnouncement()
    if (!announcement) throw new Error('ponte indisponível')
    const response = await fetch('http://127.0.0.1:' + announcement.port + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + announcement.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.json()
  }
}

module.exports = { DshLink, defaultAnnouncementPath }
