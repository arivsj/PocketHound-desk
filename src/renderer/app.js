/**
 * Interface do PocketHound desk.
 *
 * Sem framework: o renderer é vanilla, como no dashboard anterior. O trabalho
 * aqui é desenhar a chuva de caracteres, trocar de página, e refletir o
 * retrato que o processo principal manda.
 *
 * A chuva lê os tokens do CSS **uma vez** e guarda em cache. O sistema antigo
 * tinha a cor escrita à mão em dois lugares do JS e fazia comparação de string
 * para decidir o estado; aqui a cor vem do design system e o estado vem do
 * dado.
 *
 * @module pockethound-desk/renderer
 */

'use strict'

const api = window.pockethound

/* ------------------------------------------------------------- estado */

/** @type {object|null} */
let snapshot = null
/** @type {Map<string, object>} */
const sessions = new Map()
/** @type {object[]} */
let pending = []
/** @type {object[]} */
let history = []
/** @type {object[]} */
let rules = []
/** @type {object[]} */
let logs = []
/** Máximo de quadros mostrados na tabela do painel. */
const FRAME_ROWS = 14

/**
 * Escapa texto para inserir em HTML.
 * @param {unknown} value - valor cru.
 * @returns {string} texto seguro.
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Formata um instante como hora curta.
 * @param {number} ms - epoch em milissegundos.
 * @returns {string} hora ou travessão.
 */
function clock(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('pt-BR', { hour12: false })
}

/**
 * Formata uma grandeza de bytes em MB/GB.
 * @param {number} mb - valor em megabytes.
 * @returns {string} texto legível.
 */
function megabytes(mb) {
  if (!Number.isFinite(mb)) return '—'
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'
}

/**
 * Traduz o tipo de quadro para um rótulo curto em português.
 * @param {string} type - tipo do protocolo.
 * @returns {string} rótulo.
 */
function frameLabel(type) {
  const labels = {
    'session.upsert': 'sessão',
    'session.gone': 'sessão encerrada',
    'turn.event': 'turno',
    'approval.request': 'aprovação pedida',
    'approval.resolved': 'aprovação decidida',
    'question.request': 'pergunta',
    'replay.done': 'replay concluído',
    desk_state: 'estado do PC',
    hello: 'handshake',
    notice: 'aviso',
  }
  return labels[type] ?? type
}

/* --------------------------------------------------------------- chuva */

/** Desenha a chuva de caracteres na sidebar. */
const rain = (() => {
  const canvas = document.getElementById('rain')
  const context = canvas.getContext('2d')
  const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789'
  const COLUMN_WIDTH = 12
  const STEP_EVERY = 3

  let columns = []
  let frame = 0
  let width = 0
  let height = 0
  let colors = null
  let enabled = true

  /**
   * Lê os tokens do design system uma única vez e guarda em cache.
   *
   * Sem valor de reserva escrito à mão: se um token sumir, a chuva simplesmente
   * não desenha. Inventar uma cor aqui é como a paleta racha em duas — foi o
   * que aconteceu no dashboard anterior, que tinha a cor repetida em 42 lugares
   * entre o CSS e o JavaScript.
   *
   * @returns {boolean} se os tokens estão completos.
   */
  function readTokens() {
    const styles = getComputedStyle(document.documentElement)
    const read = (token) => styles.getPropertyValue(token).trim()
    const trace = read('--ph-bg')
    const body = read('--ph-rain')
    const head = read('--ph-rain-head')
    if (!trace || !body || !head) {
      colors = null
      return false
    }
    colors = { trace, body, head }
    return true
  }

  /** Ajusta o canvas ao tamanho real do elemento. */
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    width = Math.max(1, Math.floor(rect.width))
    height = Math.max(1, Math.floor(rect.height))
    canvas.width = width * ratio
    canvas.height = height * ratio
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const count = Math.ceil(width / COLUMN_WIDTH)
    columns = Array.from({ length: count }, () => Math.floor(Math.random() * -40))
  }

  /** Um quadro da animação. */
  function draw() {
    if (!enabled || !colors) return
    frame += 1

    // O rastro nasce do véu, nunca de clearRect.
    context.fillStyle = colors.trace
    context.globalAlpha = 0.08
    context.fillRect(0, 0, width, height)
    context.globalAlpha = 1

    context.font = '12px "JetBrains Mono", monospace'
    for (let index = 0; index < columns.length; index += 1) {
      if (frame % STEP_EVERY !== 0) continue
      const x = index * COLUMN_WIDTH
      const y = columns[index] * 14
      const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]

      context.fillStyle = Math.random() > 0.92 ? colors.head : colors.body
      context.fillText(glyph, x, y)
      context.globalAlpha = 0.55
      context.fillText(glyph, x, y - 14)
      context.globalAlpha = 1

      if (y > height && Math.random() > 0.975) columns[index] = 0
      else columns[index] += 1
    }
    requestAnimationFrame(draw)
  }

  readTokens()
  resize()
  window.addEventListener('resize', resize)
  requestAnimationFrame(draw)

  return {
    /**
     * Liga ou desliga a chuva.
     * @param {boolean} value - novo estado.
     */
    setEnabled(value) {
      enabled = Boolean(value)
      if (enabled && colors) requestAnimationFrame(draw)
      else if (!enabled) context.clearRect(0, 0, width, height)
    },
    /** Relê os tokens (troca de tema a quente). */
    refresh: readTokens,
  }
})()

/* -------------------------------------------------------------- páginas */

/** Liga a navegação da sidebar. */
function setupNav() {
  const items = [...document.querySelectorAll('.ph-nav__item')]
  for (const item of items) {
    item.addEventListener('click', () => {
      for (const other of items) other.classList.toggle('is-active', other === item)
      const target = 'page-' + item.dataset.page
      for (const page of document.querySelectorAll('.ph-page')) {
        page.classList.toggle('is-active', page.id === target)
      }
    })
  }
}

/* ------------------------------------------------------------- desenho */

/** Redesenha tudo a partir do retrato atual. */
function render() {
  if (!snapshot) return

  /* sidebar ---------------------------------------------------------- */
  const connected = snapshot.bridge?.connected
  const bridgeStatus = document.getElementById('bridgeStatus')
  bridgeStatus.className = 'ph-status ' + (connected ? 'is-online' : 'is-offline')
  document.getElementById('bridgeStatusText').textContent = connected ? 'conectada' : 'offline'

  const badge = document.getElementById('navBadge')
  badge.hidden = pending.length === 0
  badge.textContent = String(pending.length)

  /* painel ---------------------------------------------------------- */
  document.getElementById('cBridge').textContent = connected ? 'porta ' + snapshot.bridge.info.port : 'offline'
  document.getElementById('cSessions').textContent = String(sessions.size)
  document.getElementById('cPhones').textContent = String(snapshot.transport?.phones ?? 0)
  document.getElementById('cPending').textContent = String(pending.length)
  document.getElementById('painelHint').textContent = connected
    ? 'cursor ' + snapshot.bridge.cursor + ' · ' + snapshot.bridge.stats.frames + ' quadros recebidos'
    : 'aguardando a ponte do Harness'

  const last = snapshot.recentFrames?.[snapshot.recentFrames.length - 1]
  document.getElementById('cLastFrame').textContent = last
    ? frameLabel(last.type) + ' · seq ' + last.seq + ' · ' + clock(last.ts)
    : 'aguardando quadros'

  const recent = [...sessions.values()].slice(0, 4)
  document.getElementById('painelSessions').innerHTML = recent.length
    ? recent.map(sessionCard).join('')
    : '<div class="ph-empty">Nenhuma sessão viva. Abra o Harness e comece uma conversa.</div>'

  const frames = (snapshot.recentFrames ?? []).slice(-FRAME_ROWS).reverse()
  document.getElementById('frameRows').innerHTML = frames.length
    ? frames.map((entry) => '<tr><td><code>' + entry.seq + '</code></td><td>' + esc(frameLabel(entry.type)) +
        '</td><td class="ph-muted">' + esc((entry.session ?? '—').slice(0, 18)) + '</td><td class="ph-muted">' +
        clock(entry.ts) + '</td></tr>').join('')
    : '<tr><td colspan="4" class="ph-muted">sem quadros ainda</td></tr>'

  /* sessões --------------------------------------------------------- */
  const all = [...sessions.values()]
  document.getElementById('sessionList').innerHTML = all.length
    ? all.map(sessionCard).join('')
    : '<div class="ph-empty">Nenhuma sessão viva.</div>'

  /* aprovações ------------------------------------------------------ */
  document.getElementById('pendingList').innerHTML = pending.length
    ? pending.map(pendingCard).join('')
    : '<div class="ph-empty">Nada esperando decisão. Quando o Harness pedir permissão, aparece aqui e no celular.</div>'

  document.getElementById('historyRows').innerHTML = history.length
    ? history.slice(0, 12).map((entry) => {
        const cls = entry.outcome === 'allowed-once' ? 'ok' : 'danger'
        return '<tr><td><code>' + esc(entry.toolName ?? '—') + '</code></td>' +
          '<td><span class="ph-badge ph-badge--' + cls + '">' + esc(entry.outcome) + '</span></td>' +
          '<td class="ph-muted">' + esc(entry.by ?? '—') + '</td><td class="ph-muted">' + clock(entry.at) + '</td></tr>'
      }).join('')
    : '<tr><td colspan="4" class="ph-muted">nenhuma decisão ainda</td></tr>'

  document.getElementById('ruleList').innerHTML = rules.length
    ? rules.map((rule) => '<div class="ph-list__item"><div class="ph-list__main">' +
        '<span class="ph-list__title">' + esc(rule.toolName) + (rule.all ? ' (qualquer argumento)' : '') + '</span>' +
        '<span class="ph-list__meta">decidido em ' + clock(rule.at) + '</span></div>' +
        '<span class="ph-badge ph-badge--' + (rule.outcome === 'allowed-once' ? 'ok' : 'danger') + '">' +
        esc(rule.outcome) + '</span></div>').join('')
    : '<div class="ph-empty">Nenhuma regra. Marque “não perguntar de novo” no celular para criar uma.</div>'

  /* transporte ------------------------------------------------------ */
  const transport = snapshot.transport ?? {}
  document.getElementById('tListen').textContent = transport.listening ? transport.host + ':' + transport.port : 'parado'
  document.getElementById('tPhones').textContent = String(transport.phones ?? 0)
  document.getElementById('tRing').textContent = String(transport.ring ?? 0)
  document.getElementById('tCursor').textContent = String(snapshot.bridge?.cursor ?? 0)
  document.getElementById('pathIn').textContent = (transport.listening ? 'http://' : '') +
    (transport.port ? '<ip-do-pc>:' + transport.port : '—')

  // Descartes não são erro: são o que mantém a memória plana quando o rádio
  // está lento. O cursor devolve o buraco; só o insubstituível nunca é largado.
  // Estado do túnel: é o que decide se o QR funciona fora da rede local.
  const tunel = snapshot.p2p ?? {}
  document.getElementById('pathP2p').textContent = tunel.ready
    ? 'no ar — o celular alcança de qualquer rede'
    : (tunel.running
        ? 'subindo…'
        : (tunel.reason ? 'indisponível: ' + tunel.reason : 'parado'))
  document.getElementById('pathRelay').textContent = tunel.relayUrl
    ? tunel.relayUrl + (tunel.endpointId ? ' · ' + tunel.endpointId.slice(0, 12) + '…' : '')
    : (tunel.ready ? 'conectado por endereços diretos' : '—')

  const dropped = transport.stats?.dropped ?? 0
  document.getElementById('pathDrop').textContent = dropped === 0
    ? 'nada descartado'
    : dropped + ' quadros substituíveis descartados'

  const counters = snapshot.counters ?? []
  const peak = Math.max(1, ...counters)
  document.getElementById('trafficChart').innerHTML = counters
    .map((value) => '<div class="ph-chart__bar" style="height:' + Math.round((value / peak) * 100) + '%"></div>')
    .join('')
  document.getElementById('trafficHint').textContent = peak > 1
    ? peak + ' quadros/s no pico'
    : 'sem tráfego medido ainda'

  /* dispositivos ---------------------------------------------------- */
  const devices = snapshot.devices ?? []
  document.getElementById('deviceRows').innerHTML = devices.length
    ? devices.map((device) => '<tr><td>' + esc(device.name) + '</td>' +
        '<td class="ph-muted">' + clock(device.createdAt) + '</td>' +
        '<td class="ph-muted">' + (device.lastSeen ? clock(device.lastSeen) : 'nunca') + '</td>' +
        '<td><span class="ph-badge ph-badge--' + (device.revoked ? 'danger' : 'ok') + '">' +
        (device.revoked ? 'revogado' : 'ativo') + '</span></td>' +
        '<td>' + (device.revoked ? '' : '<button class="ph-btn ph-btn--sm ph-btn--danger" data-revoke="' +
          esc(device.id) + '" type="button">Revogar</button>') + '</td></tr>').join('')
    : '<tr><td colspan="5" class="ph-muted">nenhum celular pareado</td></tr>'

  for (const button of document.querySelectorAll('[data-revoke]')) {
    button.addEventListener('click', async () => {
      await api.revoke(button.dataset.revoke)
      await refresh()
    })
  }

  for (const button of document.querySelectorAll('[data-reveal]')) {
    button.addEventListener('click', () => api.revealPath(button.dataset.reveal))
  }

  /* ajustes --------------------------------------------------------- */
  const config = snapshot.config ?? {}
  setIfIdle('cfgPort', config.port)
  setIfIdle('cfgTimeout', config.approvalTimeoutMs)
  setIfIdle('cfgMode', config.transportMode)
  const advertise = document.getElementById('cfgAdvertise')
  if (document.activeElement !== advertise) advertise.checked = Boolean(config.advertise)
  const rainToggle = document.getElementById('cfgRain')
  if (document.activeElement !== rainToggle) rainToggle.checked = config.rain !== false

  document.getElementById('logRows').innerHTML = logs.length
    ? logs.slice(0, 14).map((entry) => '<tr><td class="ph-muted">' + clock(entry.at) + '</td>' +
        '<td><code>' + esc(entry.level) + '</code></td><td>' + esc(entry.message) + '</td></tr>').join('')
    : '<tr><td colspan="3" class="ph-muted">sem registros</td></tr>'
}

/**
 * Escreve num campo só quando ele não está em uso.
 * @param {string} id - identificador do elemento.
 * @param {unknown} value - valor a escrever.
 */
function setIfIdle(id, value) {
  const element = document.getElementById(id)
  if (!element || document.activeElement === element) return
  if (element.value !== String(value ?? '')) element.value = String(value ?? '')
}

/**
 * Cartão de uma sessão.
 * @param {object} session - sessão.
 * @returns {string} HTML.
 */
function sessionCard(session) {
  const title = session.title || 'sem título ainda'
  const viva = session.status !== 'cold'
  const estado = viva
    ? '<span class="ph-badge ph-badge--ok">viva</span>'
    : '<span class="ph-badge ph-badge--mute">no disco</span>'
  // O caminho do log vem do sessionPersistence.locate() do próprio harness.
  // Só o desktop revela o arquivo — o celular não tem gerenciador de arquivos.
  const revelar = session.logPath
    ? '<button class="ph-btn ph-btn--sm ph-btn--ghost" data-reveal="' + esc(session.logPath) +
      '" type="button" title="Abrir o log da sessão no gerenciador de arquivos">log</button>'
    : ''
  return '<div class="ph-list__item"><div class="ph-list__main">' +
    '<span class="ph-list__title">' + esc(title) + '</span>' +
    '<span class="ph-list__meta">' + esc(session.id) + ' · ' +
    (viva ? (session.events ?? 0) + ' eventos' : 'histórico') +
    (session.workspace ? ' · ' + esc(session.workspace) : '') +
    (session.origin === 'subagent' ? ' · subagente' : '') + '</span></div>' +
    revelar + estado + '</div>'
}

/**
 * Cartão de uma aprovação pendente.
 * @param {object} request - pedido.
 * @returns {string} HTML.
 */
function pendingCard(request) {
  const args = request.args ? JSON.stringify(request.args, null, 2) : '(sem argumentos registrados)'
  const remaining = Math.max(0, Math.round((request.expiresAt - Date.now()) / 1000))
  return '<div class="ph-approval">' +
    '<div class="ph-approval__head"><span class="ph-approval__tool">' + esc(request.toolName) + '</span>' +
    '<span class="ph-badge ph-badge--warn">' + remaining + 's</span></div>' +
    (request.reason ? '<p class="ph-muted">' + esc(request.reason) + '</p>' : '') +
    '<pre class="ph-approval__pre">' + esc(args.slice(0, 900)) + '</pre>' +
    '<span class="ph-muted">a decisão está no celular</span></div>'
}

/* ------------------------------------------------------------- eventos */

/** Busca o retrato completo e redesenha. */
async function refresh() {
  snapshot = await api.snapshot()
  sessions.clear()
  for (const session of snapshot.sessions ?? []) sessions.set(session.id, session)
  pending = await api.pending()
  history = await api.history()
  rules = await api.rules()
  render()
}

/** Liga os controles da interface. */
function setupControls() {
  document.getElementById('winMin').addEventListener('click', () => api.window.minimize())
  document.getElementById('winMax').addEventListener('click', () => api.window.maximize())
  document.getElementById('winClose').addEventListener('click', () => api.window.close())

  document.getElementById('btnPair').addEventListener('click', async () => {
    const result = await api.pairQr(300)
    document.getElementById('pairCode').textContent = result.code

    // O SVG vem pronto do processo principal; aqui só entra no DOM.
    const caixa = document.getElementById('pairQr')
    if (result.svg) {
      caixa.innerHTML = result.svg
      caixa.hidden = false
    } else {
      caixa.hidden = true
    }

    // Dizer a verdade sobre o alcance do QR: com túnel, qualquer rede; sem ele,
    // só a mesma. O usuário não deve descobrir isso por tentativa e erro.
    document.getElementById('pairVia').textContent = result.viaTunel
      ? 'Alcance: qualquer rede (túnel P2P ativo' + (result.relayUrl ? ', via relay' : '') + ')'
      : 'Alcance: só a mesma rede do PC — suba a ponte P2P com «npm run p2p:serve» para parear de fora.'

    document.getElementById('pairOverlay').hidden = false
    const tick = () => {
      const left = Math.max(0, Math.round((result.expiresAt - Date.now()) / 1000))
      document.getElementById('pairExpiry').textContent = left
        ? 'expira em ' + left + 's — uso único'
        : 'código expirado'
      if (left) setTimeout(tick, 1000)
    }
    tick()
    await refresh()
  })

  document.getElementById('btnPairClose').addEventListener('click', () => {
    document.getElementById('pairOverlay').hidden = true
  })

  document.getElementById('btnSave').addEventListener('click', async () => {
    await api.configure({
      port: Number(document.getElementById('cfgPort').value) || 7411,
      approvalTimeoutMs: Number(document.getElementById('cfgTimeout').value) || 90000,
      transportMode: document.getElementById('cfgMode').value,
      advertise: document.getElementById('cfgAdvertise').checked,
      rain: document.getElementById('cfgRain').checked,
    })
    rain.setEnabled(document.getElementById('cfgRain').checked)
    await refresh()
  })
}

/* ---------------------------------------------------------------- boot */

setupNav()
setupControls()
api.on('snapshot', (next) => {
  snapshot = next
  sessions.clear()
  for (const session of next.sessions ?? []) sessions.set(session.id, session)
  render()
})
api.on('frame', () => { /* o retrato periódico já cobre; evita redesenho por quadro */ })
api.on('log', (entry) => {
  logs.unshift(entry)
  if (logs.length > 60) logs.length = 60
})

refresh().then(() => {
  rain.setEnabled(snapshot?.config?.rain !== false)
  // O retrato é empurrado pelo processo principal a cada segundo; este
  // intervalo só cobre o caso de a interface ficar sem eventos.
  setInterval(refresh, 5000)
})
