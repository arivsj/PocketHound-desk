/**
 * Configuração e estado durável do PocketHound desk.
 *
 * Tudo mora em `<userData>/pockethound/`:
 *   config.json    preferências (porta, prazos, modo de transporte)
 *   devices.json   celulares pareados — **só o hash do token**, nunca o token
 *
 * O token em claro existe uma única vez, na resposta do pareamento. Depois
 * disso o PC só guarda o SHA-256. Roubar o arquivo não dá acesso a nada.
 *
 * @module pockethound-desk/config
 */

'use strict'

const { createHash, randomBytes, randomInt, timingSafeEqual } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Intervalo mínimo entre duas gravações de `lastSeen` no disco.
 *
 * O projeto anterior regravava o JSON inteiro de dispositivos a CADA requisição
 * autenticada. Com um protocolo de comandos isso passava; com um protocolo de
 * eventos o celular fala o tempo todo, e reescrever o arquivo por mensagem não
 * escala. A memória é a verdade; o disco é atualizado no máximo a cada janela e
 * no encerramento.
 */
const LAST_SEEN_FLUSH_MS = 30000

/** Preferências de fábrica. */
const DEFAULT_CONFIG = Object.freeze({
  /** Porta do servidor que o celular procura. 0 = escolhida pelo sistema. */
  port: 7411,
  /** Interface de escuta do servidor do celular. */
  bindHost: '0.0.0.0',
  /** Modo de transporte preferido. */
  transportMode: 'auto',
  /** Anunciar na LAN por mDNS. */
  advertise: true,
  /** Prazo padrão de uma aprovação no celular, em ms. */
  approvalTimeoutMs: 90000,
  /** Como tratar um pedido quando nenhum celular responde. */
  onNoPhone: 'delegate',
  /** Tema (só 'violet' por enquanto — o design system pede uma paleta só). */
  theme: 'violet',
  /** Liga a chuva de caracteres. */
  rain: true,
  /** Intervalo do retrato da máquina, em ms. */
  deskStateIntervalMs: 2000,
  /**
   * Subir a ponte P2P junto com o desk.
   *
   * Ligado por padrão: sem ela o celular só alcança o PC na mesma rede, e o QR
   * sai sem túnel. Desligue se preferir rodar a ponte à parte.
   */
  p2pBridge: true,
})

/**
 * Lê e mescla um arquivo JSON, tolerando ausência e corrupção.
 * @param {string} file - caminho do arquivo.
 * @param {object} fallback - valor padrão.
 * @returns {object} o conteúdo lido ou o padrão.
 */
function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return { ...fallback }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { ...fallback, ...parsed }
  } catch {
    // Arquivo corrompido não pode derrubar o app: o padrão é sempre seguro.
    return { ...fallback }
  }
}

/**
 * Escreve JSON de forma atômica.
 * @param {string} file - caminho do arquivo.
 * @param {unknown} value - valor serializável.
 */
function writeJson(file, value) {
  mkdirSync(join(file, '..'), { recursive: true })
  const temporary = file + '.tmp'
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(temporary, file)
}

/**
 * Hash do token, como ele é guardado.
 * @param {string} token - token em claro.
 * @returns {string} SHA-256 em hex.
 */
function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex')
}

/**
 * Compara dois hashes sem vazar tempo.
 * @param {string} a - primeiro hash.
 * @param {string} b - segundo hash.
 * @returns {boolean} se são iguais.
 */
function sameHash(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Repositório de configuração e dispositivos pareados. */
class Store {
  /**
   * @param {string} directory - pasta de estado do app.
   */
  constructor(directory) {
    this.directory = directory
    this.configFile = join(directory, 'config.json')
    this.devicesFile = join(directory, 'devices.json')
    this.config = readJson(this.configFile, DEFAULT_CONFIG)
    /** Quando o `lastSeen` foi gravado pela última vez (ver LAST_SEEN_FLUSH_MS). */
    this.lastSeenFlushAt = 0
    /** @type {Map<string, object>} */
    this.devices = new Map()
    const stored = readJson(this.devicesFile, { devices: [] })
    for (const device of stored.devices ?? []) this.devices.set(device.id, device)
  }

  /**
   * Atualiza preferências e persiste.
   * @param {object} patch - campos a alterar.
   * @returns {object} a configuração resultante.
   */
  updateConfig(patch) {
    this.config = { ...this.config, ...patch }
    writeJson(this.configFile, this.config)
    return this.config
  }

  /** Persiste a lista de dispositivos. */
  #saveDevices() {
    writeJson(this.devicesFile, { devices: [...this.devices.values()] })
  }

  /**
   * Gera um código de pareamento de 6 dígitos, de uso único e vida curta.
   * @param {number} [ttlSeconds] - validade em segundos.
   * @returns {{code: string, expiresAt: number}} o código emitido.
   */
  createPairingCode(ttlSeconds = 120) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0')
    this.pending = { hash: hashToken('pair:' + code), expiresAt: Date.now() + ttlSeconds * 1000, attempts: 0 }
    return { code, expiresAt: this.pending.expiresAt, ttlSeconds }
  }

  /**
   * Consome o código de pareamento pendente e registra o dispositivo.
   * @param {object} input - dados do pareamento.
   * @param {string} input.code - código digitado no celular.
   * @param {string} input.name - nome do aparelho.
   * @param {string} [input.fingerprint] - impressão do aparelho.
   * @returns {{ok: true, device: object, token: string}|{ok: false, error: string}} resultado.
   */
  pair(input) {
    const pending = this.pending
    if (!pending) return { ok: false, error: 'nenhum código pendente' }
    if (Date.now() > pending.expiresAt) {
      this.pending = undefined
      return { ok: false, error: 'código expirado' }
    }
    pending.attempts += 1
    if (pending.attempts > 5) {
      this.pending = undefined
      return { ok: false, error: 'tentativas demais' }
    }
    if (!sameHash(pending.hash, hashToken('pair:' + String(input.code ?? '')))) {
      return { ok: false, error: 'código errado' }
    }
    // Uso único: o código morre aqui, dê certo ou não a partir daqui.
    this.pending = undefined
    const token = randomBytes(32).toString('base64url')
    const device = {
      id: randomBytes(9).toString('hex'),
      name: String(input.name ?? 'celular').slice(0, 60),
      fingerprint: input.fingerprint ? String(input.fingerprint).slice(0, 80) : undefined,
      tokenHash: hashToken(token),
      createdAt: Date.now(),
      lastSeen: undefined,
      revoked: false,
    }
    this.devices.set(device.id, device)
    this.#saveDevices()
    // O token em claro só existe nesta resposta.
    return { ok: true, device, token }
  }

  /**
   * Autentica um token de dispositivo.
   * @param {string} token - token apresentado na conexão.
   * @returns {object|undefined} o dispositivo, quando válido.
   */
  authenticate(token) {
    if (!token) return undefined
    const digest = hashToken(token)
    for (const device of this.devices.values()) {
      if (device.revoked) continue
      if (sameHash(device.tokenHash, digest)) return device
    }
    return undefined
  }

  /**
   * Marca um dispositivo como visto agora.
   * @param {string} id - identificador do dispositivo.
   */
  touch(id) {
    const device = this.devices.get(id)
    if (!device) return
    device.lastSeen = Date.now()
    const now = Date.now()
    if (now - this.lastSeenFlushAt < LAST_SEEN_FLUSH_MS) return
    this.lastSeenFlushAt = now
    this.#saveDevices()
  }

  /** Grava agora o que estiver só na memória — usado no encerramento. */
  flush() {
    this.lastSeenFlushAt = Date.now()
    this.#saveDevices()
  }

  /**
   * Revoga um dispositivo.
   * @param {string} id - identificador do dispositivo.
   * @returns {boolean} se existia.
   */
  revoke(id) {
    const device = this.devices.get(id)
    if (!device) return false
    device.revoked = true
    device.revokedAt = Date.now()
    this.#saveDevices()
    return true
  }

  /**
   * Lista os dispositivos, sem nunca expor o hash do token.
   * @returns {object[]} dispositivos públicos.
   */
  listDevices() {
    return [...this.devices.values()].map((device) => ({
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastSeen: device.lastSeen,
      revoked: Boolean(device.revoked),
    }))
  }
}

module.exports = { Store, DEFAULT_CONFIG, hashToken, sameHash, readJson, writeJson }
