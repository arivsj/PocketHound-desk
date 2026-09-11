/**
 * Supervisor da ponte P2P.
 *
 * Sobe o processo Python que fala QUIC e o mantém vivo enquanto o desk estiver
 * aberto. Existe para o usuário não precisar de dois terminais: **abrir o desk
 * já liga o túnel**.
 *
 * ## Degradação, não falha
 *
 * A ponte depende de coisas que podem não estar na máquina: `python3`,
 * `httpx` e o iroh em `vendor/`. Se qualquer uma faltar, o desk **continua
 * funcionando** — só sem túnel, e dizendo isso. Um app de PC que se recusa a
 * abrir porque uma dependência opcional sumiu é pior que um app sem a função.
 *
 * @module pockethound-desk/p2p-supervisor
 */

'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

/** Espera máxima pelo anúncio do endpoint antes de considerar que subiu. */
const READY_TIMEOUT_MS = 40000

/** Recuo entre tentativas, quando a ponte cai sozinha. */
const RESTART_DELAY_MS = 5000
const MAX_RESTARTS = 5

/** Supervisor da ponte P2P. */
class P2pSupervisor {
  /**
   * @param {object} options - dependências.
   * @param {string} options.deskDir - raiz do repositório do desk.
   * @param {string} options.apiBase - endereço do servidor do celular.
   * @param {(nivel: string, mensagem: string) => void} options.log - registrador.
   */
  constructor({ deskDir, apiBase, log }) {
    this.deskDir = deskDir
    this.apiBase = apiBase
    this.log = log
    this.processo = null
    this.tentativas = 0
    this.parado = false
    this.pronto = false
    this.motivo = null
    this.script = join(deskDir, 'src', 'transport', 'p2p', 'bridge.py')
    this.infoPath = join(deskDir, 'state', 'p2p', 'endpoint.json')
  }

  /**
   * Confere o que a ponte precisa antes de tentar subir.
   *
   * Falhar aqui dá uma mensagem útil ("falta o iroh em vendor/") em vez de um
   * traceback de Python que o usuário não sabe ler.
   *
   * @returns {string|null} o que falta, ou null quando está tudo no lugar.
   */
  preflight() {
    if (!existsSync(this.script)) return 'bridge.py não encontrado'
    const python = spawnSync('python3', ['-c', 'import sys, httpx'], { encoding: 'utf8' })
    if (python.status !== 0) return 'python3 ou httpx ausente'
    const iroh = spawnSync('python3', ['-c', 'import sys; sys.path.insert(0, "' + join(this.deskDir, 'vendor') + '"); import iroh'], { encoding: 'utf8' })
    if (iroh.status !== 0) return 'iroh ausente em vendor/ (rode: pip3 install --target vendor iroh)'
    return null
  }

  /** Sobe a ponte e espera ela se anunciar. */
  async start() {
    if (this.processo || this.parado) return
    const falta = this.preflight()
    if (falta) {
      this.motivo = falta
      this.log('warn', 'túnel P2P indisponível: ' + falta)
      return
    }

    this.processo = spawn('python3', [this.script, '--serve', '--api', this.apiBase], {
      cwd: this.deskDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // O que a ponte escreve vira log do desk: sem isto, um erro do Python
    // morreria no vazio e o usuário só veria "o túnel não funciona".
    this.processo.stdout.on('data', (dado) => this.log('info', 'p2p: ' + String(dado).trim()))
    this.processo.stderr.on('data', (dado) => this.log('warn', 'p2p: ' + String(dado).trim()))

    this.processo.on('exit', (codigo) => {
      this.processo = null
      this.pronto = false
      if (this.parado) return
      if (this.tentativas >= MAX_RESTARTS) {
        this.motivo = 'a ponte caiu ' + MAX_RESTARTS + ' vezes'
        this.log('error', 'túnel P2P desistiu depois de ' + MAX_RESTARTS + ' tentativas')
        return
      }
      this.tentativas += 1
      this.log('warn', 'ponte caiu (código ' + codigo + '); tentando de novo em ' + (RESTART_DELAY_MS / 1000) + 's')
      setTimeout(() => this.start(), RESTART_DELAY_MS)
    })

    const inicio = Date.now()
    while (Date.now() - inicio < READY_TIMEOUT_MS) {
      if (this.#lerAnuncio()) {
        this.pronto = true
        this.tentativas = 0
        this.log('info', 'túnel P2P no ar')
        return
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    this.motivo = 'a ponte não se anunciou em ' + (READY_TIMEOUT_MS / 1000) + 's'
    this.log('warn', this.motivo + ' — o QR vai sair sem túnel')
  }

  /** Encerra a ponte, sem tentar reerguer. */
  stop() {
    this.parado = true
    if (!this.processo) return
    const alvo = this.processo
    this.processo = null
    // SIGTERM primeiro: a ponte fecha o endpoint e o relay com educação. Matar
    // com SIGKILL deixaria a identidade anunciada por alguns segundos.
    try { alvo.kill('SIGTERM') } catch { /* já morreu */ }
    setTimeout(() => { try { alvo.kill('SIGKILL') } catch { /* já morreu */ } }, 3000)
  }

  /**
   * Lê o anúncio do endpoint, publicado pela ponte.
   * @returns {object|null} o anúncio, quando existir e for legível.
   */
  #lerAnuncio() {
    try {
      if (!existsSync(this.infoPath)) return null
      const dados = JSON.parse(readFileSync(this.infoPath, 'utf8'))
      return dados?.ticket ? dados : null
    } catch {
      return null
    }
  }

  /** @returns {object} retrato para a interface. */
  status() {
    const anuncio = this.#lerAnuncio()
    return {
      enabled: !this.parado,
      running: Boolean(this.processo),
      ready: this.pronto,
      pid: this.processo?.pid ?? null,
      reason: this.motivo,
      endpointId: anuncio?.endpointId ?? null,
      relayUrl: anuncio?.relayUrl ?? null,
      directAddresses: anuncio?.directAddresses ?? [],
    }
  }
}

module.exports = { P2pSupervisor }
