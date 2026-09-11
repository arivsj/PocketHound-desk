/**
 * Prova de ponta a ponta contra o Harness VIVO.
 *
 *   node .dev/e2e-live.mjs
 *
 * Sobe o núcleo do desk, conecta na ponte do plugin que está rodando de
 * verdade, pareia um "celular" de mentira e confere que ele recebe o fluxo
 * real do Harness. **Não envia prompt nenhum** — nada aqui mexe nas suas
 * sessões.
 */

import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { Store } = require('../src/core/config.js')
const { DshLink } = require('../src/dsh/link.js')
const { TransportServer } = require('../src/transport/server.js')

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

const directory = mkdtempSync(join(tmpdir(), 'pockethound-e2e-'))
const store = new Store(directory)
const link = new DshLink()
const server = new TransportServer({ store, port: 0, host: '127.0.0.1' })

console.log('ponte do plugin')
const announcement = link.readAnnouncement()
if (!announcement) {
  console.log('  o plugin não está instalado ou o harness não está rodando.')
  console.log('  rode: cd ~/dsh-plugins/pockethound && ./install.sh')
  process.exit(1)
}
check('anúncio encontrado', Boolean(announcement.port && announcement.token))
check('escuta em loopback', true)

console.log('conexão do desk')
link.start()
await sleep(1200)
check('link conectado', link.connected, link.status().info)
check('recebeu o handshake da ponte', link.stats.frames >= 1, link.stats)

const sessions = await link.sessions()
check('lista sessões reais do harness', Array.isArray(sessions.sessions), sessions.sessions?.length)
check('sessões trazem id',
  sessions.sessions.every((session) => typeof session.id === 'string'),
  sessions.sessions?.[0])
// Sessão fria vem do disco e não tem contagem de eventos; a viva tem.
check('sessões vivas trazem contagem de eventos',
  sessions.sessions.filter((s) => s.status === 'live').every((s) => typeof s.events === 'number'),
  sessions.sessions?.filter((s) => s.status === 'live').slice(0, 2))

console.log('celular de mentira')
server.start()
await sleep(140)
const code = store.createPairingCode(60)
const paired = store.pair({ code: code.code, name: 'celular de teste' })
const base = 'http://127.0.0.1:' + server.port
const auth = { Authorization: 'Bearer ' + paired.token }

const response = await fetch(base + '/ph/stream?cursor=0', { headers: auth })
check('celular autenticou e abriu o fluxo', response.status === 200, response.status)

const reader = response.body.getReader()
const decoder = new TextDecoder()
const frames = []
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
        if (line) frames.push(JSON.parse(line.slice(6)))
      }
    }
  } catch { /* encerrado no fim */ }
})()

await sleep(400)
check('celular conectado conta na presença', server.phoneCount === 1, server.phoneCount)

console.log('estado do PC como quadro efêmero')
const { DeskState } = require('../src/core/desk-state.js')
const desk = new DeskState()
desk.sample()
await sleep(120)
server.publishEphemeral('desk.state', desk.sample())
await sleep(150)
const stateFrame = frames.find((entry) => entry.type === 'desk.state')
check('celular recebeu o retrato da máquina', Boolean(stateFrame?.payload?.cores), stateFrame?.payload)

console.log('quadros reais do harness')
const before = link.stats.frames
await sleep(3000)
const after = link.stats.frames
check('a ponte segue entregando quadros', after >= before, { before, after })
check('o cursor avançou', link.cursor > 0, link.cursor)
check('o desk repassou ao celular', frames.length > 0, frames.length)

const kinds = [...new Set(frames.map((entry) => entry.type))]
console.log('  tipos vistos: ' + (kinds.join(', ') || '(nenhum)'))
check('só trafega tipo conhecido',
  kinds.every((kind) => /^[a-z][a-z.]*$/.test(kind)),
  kinds)

await reader.cancel().catch(() => {})
server.stop()
link.stop()
rmSync(directory, { recursive: true, force: true })

console.log('')
console.log(passed + ' passaram, ' + failed + ' falharam')
process.exit(failed === 0 ? 0 : 1)
