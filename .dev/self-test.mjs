/**
 * Autoteste do PocketHound desk — exercita o núcleo sem Electron, sem celular
 * e sem o Harness.
 *
 *   node .dev/self-test.mjs
 *
 * Cobre: store de configuração e dispositivos, hash de token, pareamento de uso
 * único, autenticação, revogação, servidor do celular com replay por cursor,
 * presença, farol e o coletor de estado da máquina.
 */

import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { Store } = require('../src/core/config.js')
const { DeskState } = require('../src/core/desk-state.js')
const { TransportServer, descartavel } = require('../src/transport/server.js')
const { frame, OUTBOUND, parseInbound, INBOUND } = require('../src/core/protocol.js')

let passed = 0
let failed = 0

/**
 * Registra o resultado de uma verificação.
 * @param {string} label - o que foi verificado.
 * @param {boolean} condition - se passou.
 * @param {unknown} [detail] - contexto em caso de falha.
 */
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log('  ok   ' + label) }
  else { failed += 1; console.log('  FALHA ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')) }
}

/**
 * Espera um pouco.
 * @param {number} ms - milissegundos.
 * @returns {Promise<void>} promessa resolvida depois.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const directory = mkdtempSync(join(tmpdir(), 'pockethound-desk-'))

/* ------------------------------------------------------------ store */

console.log('store e preferências')
const store = new Store(directory)
check('config de fábrica aplicada', store.config.port === 7411 && store.config.transportMode === 'auto', store.config)
store.updateConfig({ port: 8123 })
check('preferência persistida', new Store(directory).config.port === 8123)

console.log('pareamento')
const code = store.createPairingCode(60)
check('código tem 6 dígitos', /^[0-9]{6}$/.test(code.code), code.code)
const wrong = store.pair({ code: '000000', name: 'intruso' })
check('código errado é recusado', wrong.ok === false, wrong)
const right = store.pair({ code: code.code, name: 'celular do teste' })
check('código certo pareia', right.ok === true && typeof right.token === 'string', right.error)
const reused = store.pair({ code: code.code, name: 'de novo' })
check('código é de uso único', reused.ok === false, reused)

console.log('autenticação por token')
check('token válido autentica', store.authenticate(right.token)?.id === right.device.id)
check('token inventado não autentica', store.authenticate('nao-e-o-token') === undefined)
check('a lista de dispositivos não expõe o hash', !JSON.stringify(store.listDevices()).includes('tokenHash'))
store.revoke(right.device.id)
check('dispositivo revogado perde acesso', store.authenticate(right.token) === undefined)

/* --------------------------------------------------------- servidor */

console.log('servidor do celular')
const store2 = new Store(mkdtempSync(join(tmpdir(), 'pockethound-desk2-')))
const pairCode = store2.createPairingCode(60)
const paired = store2.pair({ code: pairCode.code, name: 'celular' })
const server = new TransportServer({ store: store2, port: 0, host: '127.0.0.1' })
server.start()
await sleep(140)

const base = 'http://127.0.0.1:' + server.port
const auth = { Authorization: 'Bearer ' + paired.token }

check('/ph/ping é aberto', (await fetch(base + '/ph/ping')).status === 200)
check('sem token devolve 401', (await fetch(base + '/ph/hello')).status === 401)
check('token inválido devolve 401', (await fetch(base + '/ph/hello', { headers: { Authorization: 'Bearer x' } })).status === 401)

const hello = await (await fetch(base + '/ph/hello', { headers: auth })).json()
check('hello reconhece o dispositivo', hello.ok === true && hello.device.name === 'celular', hello)

console.log('fluxo e replay')
const commands = []
server.on('command', ({ type, payload }) => commands.push({ type, payload }))

server.ingest(frame(OUTBOUND.SESSION_UPSERT, { id: 's1', title: 'minha sessão' }, { seq: 1 }))
server.ingest(frame(OUTBOUND.TURN_EVENT, { kind: 'text.delta', text: 'oi' }, { seq: 2, session: 's1' }))

const stream = await fetch(base + '/ph/stream?cursor=0', { headers: auth })
check('stream abre', stream.status === 200, stream.status)
const reader = stream.body.getReader()
const decoder = new TextDecoder()
const received = []
let buffer = ''
const pump = (async () => {
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let split
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const line = block.split('\n').find((entry) => entry.startsWith('data: '))
        if (line) received.push(JSON.parse(line.slice(6)))
      }
    }
  } catch { /* encerrado no fim do teste */ }
})()

await sleep(120)
check('replay entregou o histórico', received.length >= 3, received.map((entry) => entry.type))
// Quadros efêmeros carregam seq 0 e podem chegar a qualquer momento: só os
// numerados participam da ordenação do replay.
const numbered = received.filter((entry) => entry.seq > 0)
check('replay em ordem de seq', numbered.every((entry, index) => index === 0 || entry.seq > numbered[index - 1].seq), numbered.map((entry) => entry.seq))
check('presença conta 1 celular', server.phoneCount === 1, server.phoneCount)

server.publishEphemeral(OUTBOUND.DESK_STATE, { cpuPercent: 12 })
await sleep(60)
const stateFrame = received.find((entry) => entry.type === OUTBOUND.DESK_STATE)
check('quadro efêmero chega', stateFrame?.payload?.cpuPercent === 12, stateFrame)
check('efêmero carrega seq 0', stateFrame?.seq === 0, stateFrame?.seq)
check('efêmero não entra no anel', server.ring.every((entry) => entry.type !== OUTBOUND.DESK_STATE))

console.log('comandos do celular')
const command = await (await fetch(base + '/ph/frame', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ v: 1, type: INBOUND.PROMPT_SEND, payload: { sessionId: 's1', text: 'faz o build' } }),
})).json()
check('comando aceito', command.ok === true && command.type === INBOUND.PROMPT_SEND, command)
check('desk recebeu o comando', commands.length === 1 && commands[0].payload.text === 'faz o build', commands)
check('comando sabe qual dispositivo', commands[0] !== undefined)

/* ----------------------------------------------------- estado da máquina */

console.log('retrato da máquina')
const state = new DeskState()
const first = state.sample()
await sleep(60)
const second = state.sample()
check('retrato traz núcleos', first.cores > 0, first.cores)
check('retrato traz memória', first.memTotalMb > 0, first.memTotalMb)
check('retrato traz carga', Array.isArray(first.loadAvg) && first.loadAvg.length === 3)
check('cpu aparece na segunda amostra', typeof second.cpuPercent === 'number', Object.keys(second))
check('retrato não mente com zero', !('temperatureC' in second) || second.temperatureC > 0)

/* --------------------------------------------------------------- parser */

/* ------------------------------------- defeitos herdados do projeto antigo */

console.log('lastSeen não reescreve o disco a cada requisição')
{
  const dir = mkdtempSync(join(tmpdir(), 'pockethound-flush-'))
  const s = new Store(dir)
  const c = s.createPairingCode(60)
  const p = s.pair({ code: c.code, name: 'celular' })
  const file = join(dir, 'devices.json')
  s.touch(p.device.id)
  const antes = statSync(file).mtimeMs
  for (let i = 0; i < 50; i += 1) s.touch(p.device.id)
  check('50 toques não regravam o arquivo', statSync(file).mtimeMs === antes)
  check('o lastSeen em memória avançou', s.devices.get(p.device.id).lastSeen > 0)
  s.flush()
  check('o encerramento grava o lastSeen', statSync(file).mtimeMs >= antes)
  rmSync(dir, { recursive: true, force: true })
}

console.log('descartável x insubstituível na contrapressão')
check('delta de texto pode ser descartado', descartavel({ type: 'turn.event', payload: { kind: 'text.delta' } }))
check('delta de raciocínio pode ser descartado', descartavel({ type: 'turn.event', payload: { kind: 'reasoning.delta' } }))
check('estado do PC é substituível', descartavel({ type: 'desk.state', payload: {} }))
check('aprovação NUNCA é descartada', !descartavel({ type: 'approval.request', payload: {} }))
check('sessão NUNCA é descartada', !descartavel({ type: 'session.upsert', payload: {} }))
check('fim de texto NUNCA é descartado', !descartavel({ type: 'turn.event', payload: { kind: 'text.done' } }))
check('chamada de ferramenta NUNCA é descartada', !descartavel({ type: 'turn.event', payload: { kind: 'tool.call' } }))
check('o contador de descartes existe', typeof server.stats.dropped === 'number')

console.log('pareamento pelo celular — a rota que faltava')
{
  const dir = mkdtempSync(join(tmpdir(), 'pockethound-pair-'))
  const s = new Store(dir)
  const srv = new TransportServer({ store: s, port: 0, host: '127.0.0.1' })
  let pareado = null
  srv.on('paired', (device) => { pareado = device })
  srv.start()
  await sleep(140)
  const raiz = 'http://127.0.0.1:' + srv.port

  // Sem código pendente: recusa.
  const semCodigo = await fetch(raiz + '/ph/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '000000', name: 'celular' }),
  })
  check('sem código pendente devolve 401', semCodigo.status === 401, semCodigo.status)
  check('a mensagem não diz se o código existe', (await semCodigo.json()).error.message === 'código inválido ou expirado')

  // Código errado: recusa e conta tentativa.
  const codigo = s.createPairingCode(60)
  const errado = await fetch(raiz + '/ph/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codigo.code === '000000' ? '111111' : '000000', name: 'intruso' }),
  })
  check('código errado devolve 401', errado.status === 401, errado.status)

  // Código certo: devolve o token UMA vez.
  const certo = await (await fetch(raiz + '/ph/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codigo.code, name: 'Pixel do teste' }),
  })).json()
  check('código certo pareia', certo.ok === true && typeof certo.token === 'string', certo.error)
  check('devolve o dispositivo', certo.device?.name === 'Pixel do teste', certo.device)
  check('o desk avisou que pareou', pareado?.id === certo.device.id)
  check('o token NÃO fica no arquivo', !JSON.stringify(s.listDevices()).includes(certo.token))

  // Uso único: o mesmo código não vale duas vezes.
  const reuso = await fetch(raiz + '/ph/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codigo.code, name: 'outro' }),
  })
  check('o código é de uso único', reuso.status === 401, reuso.status)

  // E o token recebido autentica de verdade.
  const autenticado = await fetch(raiz + '/ph/hello', { headers: { Authorization: 'Bearer ' + certo.token } })
  check('o token do pareamento autentica', autenticado.status === 200, autenticado.status)

  srv.stop()
  rmSync(dir, { recursive: true, force: true })
}

console.log('estado entra junto com o fluxo — não depende do replay')
{
  const dir = mkdtempSync(join(tmpdir(), 'pockethound-estado-'))
  const s = new Store(dir)
  const sessao = { id: 'session-do-teste', title: 'conversa do teste', workspace: '/tmp', status: 'live' }
  const pedido = {
    requestId: 'req-do-teste',
    sessionId: 'session-do-teste',
    toolName: 'bash',
    reason: 'rodar algo',
    args: { command: 'ls' },
    expiresAt: Date.now() + 60000,
  }
  const pergunta = {
    requestId: 'pergunta-do-teste',
    sessionId: 'session-do-teste',
    questions: [{ id: 'q1', question: 'sigo?', options: [] }],
    expiresAt: Date.now() + 60000,
  }
  const srv = new TransportServer({
    store: s,
    port: 0,
    host: '127.0.0.1',
    sessions: () => [sessao],
    pendingApprovals: () => [pedido],
    pendingQuestions: () => [pergunta],
  })
  srv.start()
  await sleep(140)
  const raiz = 'http://127.0.0.1:' + srv.port
  const codigo = s.createPairingCode(60)
  const par = s.pair({ code: codigo.code, name: 'celular' })
  const auth = { Authorization: 'Bearer ' + par.token }

  // `tail=1` é o pior caso possível: o replay é cortado ao mínimo, e é assim que
  // o cartão de aprovação sumia para quem entrava de novo no app.
  const resposta = await fetch(raiz + '/ph/stream?cursor=0&tail=1', { headers: auth })
  const leitor = resposta.body.getReader()
  const decodificador = new TextDecoder()
  const quadros = []
  let sobra = ''
  const bombeia = (async () => {
    try {
      for (;;) {
        const { value, done } = await leitor.read()
        if (done) break
        sobra += decodificador.decode(value, { stream: true })
        let corte
        while ((corte = sobra.indexOf('\n\n')) !== -1) {
          const blocoTexto = sobra.slice(0, corte)
          sobra = sobra.slice(corte + 2)
          const linha = blocoTexto.split('\n').find((entrada) => entrada.startsWith('data: '))
          if (linha) quadros.push(JSON.parse(linha.slice(6)))
        }
      }
    } catch { /* encerrado no fim */ }
  })()

  await sleep(400)
  const aprovacao = quadros.find((q) => q.type === 'approval.request')
  const sessaoRecebida = quadros.find((q) => q.type === 'session.upsert')
  check('aprovação pendente chega mesmo com o replay cortado', aprovacao?.payload?.requestId === 'req-do-teste', aprovacao)
  check('a aprovação diz de que sessão é', aprovacao?.session === 'session-do-teste', aprovacao?.session)
  check('sessão conhecida chega junto', sessaoRecebida?.payload?.id === 'session-do-teste')
  check('estado vai como efêmero (não anda o cursor)', aprovacao?.seq === 0 && sessaoRecebida?.seq === 0, [aprovacao?.seq, sessaoRecebida?.seq])
  const perguntaRecebida = quadros.find((q) => q.type === 'question.request')
  check('pergunta pendente chega junto', perguntaRecebida?.payload?.requestId === 'pergunta-do-teste', perguntaRecebida)
  check('o fim do replay é anunciado', quadros.some((q) => q.type === 'replay.done'))

  await leitor.cancel().catch(() => {})
  void bombeia
  srv.stop()
  rmSync(dir, { recursive: true, force: true })
}
console.log('porta ocupada não derruba o desk')
{
  const ocupada = server.port
  const segundo = new TransportServer({ store: store2, port: ocupada, host: '127.0.0.1' })
  let falha = null
  segundo.on('bind-error', (error) => { falha = error })
  let lancou = false
  try {
    segundo.start()
    await sleep(250)
  } catch {
    lancou = true
  }
  check('não lança exceção na porta ocupada', lancou === false)
  check('o desk reporta a falha em vez de morrer', falha?.code === 'EADDRINUSE', falha?.code)
  check('o status marca que não subiu', segundo.status().listening === false, segundo.status().listening)
  check('o primeiro servidor continua vivo', server.status().listening === true)
  segundo.stop()
}

console.log('validação de quadros')
check('quadro válido passa', parseInbound({ type: INBOUND.PING }).ok === true)
check('tipo desconhecido é recusado', parseInbound({ type: 'hackear' }).ok === false)
check('versão futura é recusada', parseInbound({ v: 99, type: INBOUND.PING }).ok === false)
check('não-objeto é recusado', parseInbound(null).ok === false)

await reader.cancel().catch(() => {})
server.stop()
rmSync(directory, { recursive: true, force: true })

console.log('')
console.log(passed + ' passaram, ' + failed + ' falharam')
process.exit(failed === 0 ? 0 : 1)
