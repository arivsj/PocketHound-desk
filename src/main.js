/**
 * PocketHound desk — processo principal.
 *
 * Junta as quatro peças:
 *
 *   DshLink          fala com o plugin dentro do Harness (loopback)
 *   TransportServer  atende os celulares pareados (LAN/P2P)
 *   Store            preferências e dispositivos
 *   DeskState        retrato da máquina
 *
 * O trabalho deste arquivo é só um: **ligar os fios**. Nenhuma regra de
 * protocolo mora aqui.
 *
 * @module pockethound-desk/main
 */

'use strict'

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { join } = require('node:path')

const { Store } = require('./core/config.js')
const { montarPareamento } = require('./core/pairing-qr.js')
const { P2pSupervisor } = require('./transport/p2p/supervisor.js')
const { BACKGROUND } = require('./core/theme.js')
const { DeskState } = require('./core/desk-state.js')
const { DshLink } = require('./dsh/link.js')
const { TransportServer } = require('./transport/server.js')
const { INBOUND, OUTBOUND } = require('./core/protocol.js')

/** Quantas decisões manter no histórico visível. */
const HISTORY_LIMIT = 200

/** @type {BrowserWindow|null} */
let window = null

const store = new Store(app.getPath('userData'))
const deskState = new DeskState()
/**
 * Sobe e supervisiona a ponte P2P.
 *
 * Instanciado no módulo (e não no whenReady) porque o servidor do celular
 * precisa da porta já escolhida para montar o `--api` da ponte.
 */
const p2p = new P2pSupervisor({
  deskDir: join(__dirname, '..'),
  apiBase: '',
  log,
})
const link = new DshLink()
const transport = new TransportServer({
  store,
  port: store.config.port,
  host: store.config.bindHost,
})

/** Histórico de decisões, para a tela de aprovações. */
const history = []
/** Espelho local das regras "não perguntar de novo", só para exibição. */
const rules = []
/** Últimos quadros, para a interface mostrar o fluxo sem precisar do celular. */
const recentFrames = []
/** Contadores de tráfego para o gráfico da tela de transporte. */
const traffic = { perSecond: new Array(60).fill(0), lastTick: Date.now(), inWindow: 0 }

/**
 * Escreve no console e repassa para a interface.
 * @param {string} level - `info`, `warn` ou `error`.
 * @param {string} message - texto.
 */
function log(level, message) {
  const entry = { at: Date.now(), level, message }
  process.stdout.write('[pockethound] ' + level + ': ' + message + '\n')
  window?.webContents.send('ph:log', entry)
}

/** Monta o retrato que a interface consome. */
function snapshot() {
  return {
    version: 1,
    bridge: link.status(),
    p2p: p2p.status(),
    transport: transport.status(),
    devices: store.listDevices(),
    config: store.config,
    sessions: [...sessions.values()],
    recentFrames: recentFrames.slice(-60),
    counters: traffic.perSecond.slice(),
    pendingCount: pendingApprovals.size,
  }
}

/** @type {Map<string, object>} sessões conhecidas, alimentadas pelo link. */
const sessions = new Map()
/** @type {Map<string, object>} aprovações pendentes agora. */
const pendingApprovals = new Map()

/**
 * Avisa a interface de que algo mudou.
 * @param {string} channel - canal (`snapshot`).
 * @param {unknown} payload - conteúdo.
 */
function push(channel, payload) {
  window?.webContents.send('ph:' + channel, payload)
}

/* ------------------------------------------------------------------ link */

link.on('frame', (incoming) => {
  // 1. repassa ao celular — o desk não interpreta o que não precisa.
  transport.ingest(incoming)

  // 2. mantém o espelho local que a interface mostra.
  if (incoming.type === OUTBOUND.SESSION_UPSERT) sessions.set(incoming.payload.id, incoming.payload)
  if (incoming.type === OUTBOUND.SESSION_GONE) sessions.delete(incoming.payload.id)
  if (incoming.type === OUTBOUND.APPROVAL_REQUEST) pendingApprovals.set(incoming.payload.requestId, incoming.payload)
  if (incoming.type === OUTBOUND.APPROVAL_RESOLVED) {
    const request = pendingApprovals.get(incoming.payload.requestId)
    pendingApprovals.delete(incoming.payload.requestId)
    history.unshift({ ...incoming.payload, at: incoming.ts, request })
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  }

  recentFrames.push({ seq: incoming.seq, type: incoming.type, ts: incoming.ts, session: incoming.session })
  if (recentFrames.length > 400) recentFrames.splice(0, recentFrames.length - 400)

  traffic.inWindow += 1
  push('frame', incoming)
})

link.on('connection', (info) => {
  log('info', info ? 'ponte conectada na porta ' + info.port : 'ponte caiu — tentando de novo')
  // Presença real: o plugin só reivindica uma aprovação se houver celular.
  link.presence(transport.phoneCount).catch(() => {})
  push('snapshot', snapshot())
})

link.on('error', (error) => log('warn', 'ponte: ' + error.message))

/* ------------------------------------------------------------- celular */

transport.on('phones', (count) => {
  log('info', count + ' celular(es) conectado(s)')
  link.presence(count).catch(() => {})
  push('snapshot', snapshot())
})

transport.on('command', async ({ device, type, payload }) => {
  try {
    switch (type) {
      case INBOUND.HELLO_ACK:
        log('info', 'celular \"' + device.name + '\" entrou')
        break
      case INBOUND.PROMPT_SEND: {
        const result = await link.prompt({
          sessionId: payload.sessionId,
          text: payload.text,
          mode: payload.mode,
        })
        log('info', 'prompt do celular: ' + (result.ok ? 'entregue' : String(result.error)))
        break
      }
      case INBOUND.WORKSPACE_LIST: {
        // O POST do celular ja recebeu um ok generico; a LISTA viaja como quadro
        // efemero, pelo mesmo caminho do desk.state. Assim o protocolo nao ganha
        // um segundo formato de resposta so para isto.
        const lista = await link.workspaces()
        transport.publishEphemeral(OUTBOUND.WORKSPACE_LIST, { workspaces: lista.workspaces ?? [] })
        log('info', 'workspaces do harness: ' + (lista.workspaces ?? []).length)
        break
      }
      case INBOUND.SESSION_CREATE: {
        const resultado = await link.createSession({
          workspaceId: payload.workspaceId,
          path: payload.path,
        })
        if (resultado.ok) {
          log('info', 'sessao criada em ' + String(resultado.path ?? ''))
        } else {
          log('error', 'nao consegui criar sessao: ' + String(resultado.error ?? ''))
          transport.publishEphemeral(OUTBOUND.NOTICE, {
            level: 'error',
            title: 'Não consegui criar a sessão',
            body: String(resultado.error ?? ''),
          })
        }
        break
      }
      case INBOUND.APPROVAL_DECIDE: {
        const result = await link.decide({
          requestId: payload.requestId,
          outcome: payload.outcome,
          remember: Boolean(payload.remember),
          rememberAll: Boolean(payload.rememberAll),
        })
        if (result.ok && (payload.remember || payload.rememberAll)) {
          const request = pendingApprovals.get(payload.requestId)
          rules.unshift({
            toolName: request?.toolName ?? payload.toolName,
            outcome: payload.outcome,
            all: Boolean(payload.rememberAll),
            at: Date.now(),
          })
          if (rules.length > 100) rules.length = 100
        }
        log('info', 'decisão do celular: ' + payload.outcome)
        break
      }
      case INBOUND.QUESTION_ANSWER:
        await link.answer({ requestId: payload.requestId, answers: payload.answers })
        break
      case INBOUND.SESSION_CANCEL:
        await link.cancel(payload.sessionId)
        log('warn', 'turno cancelado pelo celular')
        break
      case INBOUND.PING:
        transport.publishEphemeral(OUTBOUND.PONG, { echo: payload.echo })
        break
      default:
        log('warn', 'comando desconhecido do celular: ' + type)
    }
  } catch (error) {
    log('error', 'falha ao tratar ' + type + ': ' + error.message)
  }
})

transport.on('listening', ({ port }) => {
  log('info', 'servidor do celular em ' + port)
  push('snapshot', snapshot())
})

transport.on('bind-error', (error) => {
  // Nao derruba o app: o desk segue de pe mostrando a falha, e o farol e a
  // ponte continuam funcionando. Porta ocupada e problema de configuracao,
  // nao motivo para o usuario perder o que estava fazendo.
  log('error', 'nao consegui abrir a porta ' + store.config.port + ': ' + error.message)
  push('snapshot', snapshot())
})

/* ------------------------------------------------------------- janela */

/** Cria a janela principal. */
function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: BACKGROUND,
    title: 'PocketHound',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.loadFile(join(__dirname, 'renderer', 'index.html'))
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { window = null })
}

/* ------------------------------------------------------------------ IPC */

ipcMain.handle('ph:snapshot', () => snapshot())
ipcMain.handle('ph:sessions', () => [...sessions.values()])
ipcMain.handle('ph:pending', () => [...pendingApprovals.values()])
ipcMain.handle('ph:history', () => history.slice(0, 60))
ipcMain.handle('ph:rules', () => rules)

ipcMain.handle('ph:pair-code', (_event, ttlSeconds) => {
  const ttl = Math.max(30, Math.min(600, Number(ttlSeconds) || 120))
  const result = store.createPairingCode(ttl)
  log('info', 'código de pareamento gerado (válido por ' + ttl + 's)')
  push('snapshot', snapshot())
  return result
})

/**
 * Gera o QR de pareamento.
 *
 * O QR carrega o ticket do túnel P2P, e é isso que faz o pareamento funcionar
 * de qualquer rede. Sem o túnel no ar, ele sai só com o endereço direto — e a
 * tela precisa dizer isso ao usuário em vez de deixá-lo descobrir sozinho.
 */
ipcMain.handle('ph:pair-qr', async (_event, ttlSeconds) => {
  const ttl = Math.max(30, Math.min(900, Number(ttlSeconds) || 300))
  const { code, expiresAt } = store.createPairingCode(ttl)
  const pareamento = await montarPareamento({
    deskDir: join(__dirname, '..'),
    code,
    expiresAt,
    address: addressForPhone(),
    pcName: require('node:os').hostname(),
  })
  log(
    'info',
    pareamento.viaTunel
      ? 'QR gerado — o celular pareia de qualquer rede (túnel ativo)'
      : 'QR gerado — sem túnel: só funciona na mesma rede do PC',
  )
  push('snapshot', snapshot())
  return pareamento
})

/**
 * Endereço do PC para o QR.
 *
 * Só o túnel é confiável fora da LAN, mas o endereço direto poupa uma ida ao
 * relay quando os dois estão na mesma rede.
 *
 * @returns {string|undefined} URL do servidor do celular, quando descoberta.
 */
function addressForPhone() {
  const redes = require('node:os').networkInterfaces()
  for (const lista of Object.values(redes)) {
    for (const item of lista ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        return 'http://' + item.address + ':' + transport.port
      }
    }
  }
  return undefined
}

ipcMain.handle('ph:revoke', (_event, id) => {
  const ok = store.revoke(String(id))
  log('warn', ok ? 'dispositivo revogado' : 'dispositivo não encontrado')
  push('snapshot', snapshot())
  return { ok }
})

ipcMain.handle('ph:configure', (_event, patch) => {
  const config = store.updateConfig(patch ?? {})
  log('info', 'preferências atualizadas')
  push('snapshot', snapshot())
  return config
})

ipcMain.handle('ph:reveal', (_event, path) => shell.showItemInFolder(String(path)))

ipcMain.handle('ph:win', (_event, action) => {
  if (!window) return
  if (action === 'minimize') window.minimize()
  if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
  if (action === 'close') window.close()
})

/* -------------------------------------------------------------- ciclo */

app.whenReady().then(() => {
  createWindow()
  link.start()
  transport.start()

  // Retrato da máquina em intervalo fixo, como quadro efêmero.
  const stateTimer = setInterval(() => {
    transport.publishEphemeral(OUTBOUND.DESK_STATE, deskState.sample())
  }, store.config.deskStateIntervalMs)

  // A ponte P2P sobe junto com o desk. O usuário não deve precisar de um
  // segundo terminal só para o celular alcançar o PC de fora da rede.
  p2p.apiBase = 'http://127.0.0.1:' + transport.port
  if (store.config.p2pBridge !== false) {
    p2p.start().then(() => push('snapshot', snapshot()))
  } else {
    log('info', 'ponte P2P desligada em Ajustes')
  }

  // Farol de descoberta na LAN.
  const beaconTimer = setInterval(() => {
    if (!store.config.advertise) return
    transport.announce({
      name: require('node:os').hostname(),
      mode: store.config.transportMode,
    })
  }, 3000)

  // Balde de tráfego por segundo, para o gráfico da tela de transporte.
  const trafficTimer = setInterval(() => {
    traffic.perSecond.push(traffic.inWindow)
    traffic.perSecond.shift()
    traffic.inWindow = 0
    push('snapshot', snapshot())
  }, 1000)

  app.on('before-quit', () => {
    clearInterval(stateTimer)
    clearInterval(beaconTimer)
    clearInterval(trafficTimer)
    p2p.stop()
    transport.stop()
    link.stop()
    // O lastSeen vive em memória e só desce a cada 30 s; no encerramento ele
    // precisa descer de qualquer jeito.
    store.flush()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
