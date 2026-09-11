/**
 * Quadros de exemplo do protocolo — a fonte da verdade compartilhada.
 *
 *   node .dev/contract-fixtures.mjs            # imprime
 *   node .dev/contract-fixtures.mjs --write    # grava docs/fixtures.json
 *
 * Por que isto existe: o projeto anterior sofreu **deriva de esquema** entre o
 * PC e o celular — o app chamava rotas que não existiam no bridge, e havia três
 * portas diferentes em circulação. Aqui há um arquivo só, e o Android tem um
 * teste que desserializa exatamente estes quadros. Se um lado mudar o formato, o
 * outro quebra no teste, não em produção.
 */

import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { frame, OUTBOUND, INBOUND, PROTOCOL_VERSION } = require('../src/core/protocol.js')

const now = 1757617324113
const session = 'session-e13ee8d4-9d1f-4a2b'

/** Quadros PC → celular, na ordem em que um turno real os produz. */
const outbound = [
  frame(OUTBOUND.HELLO, {
    name: 'workstation',
    version: PROTOCOL_VERSION,
    sessions: [{ id: session, title: 'Refatorar o transporte', workspace: '/dev/pockethound', status: 'live' }],
    cursorMax: 1042,
  }, { seq: 1040, ts: now }),
  frame(OUTBOUND.SESSION_UPSERT, { id: session, title: 'Refatorar o transporte', workspace: '/dev/pockethound', status: 'live', events: 120 }, { seq: 1041, ts: now, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'turn.start', turn: 1, at: now, sessionId: session }, { seq: 1041, ts: now, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'user.message', text: 'faz o build e publica', source: 'user', at: now, sessionId: session }, { seq: 1041, ts: now, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'step.start', turn: 1, step: 1, sessionId: session }, { seq: 1041, ts: now, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'reasoning.delta', turn: 1, step: 1, index: 0, text: 'Preciso ver o script de build antes.', sessionId: session }, { seq: 1041, ts: now, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'text.delta', turn: 1, step: 1, index: 1, text: 'Vou compilar e publicar. ', sessionId: session }, { seq: 1041, ts: now, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'text.done', turn: 1, step: 1, at: now, text: 'Vou compilar e publicar. Primeiro o build.', reasoning: 'Preciso ver o script de build antes.', calls: [{ callId: 'call_01H', name: 'bash', args: { command: 'npm run build' } }], usage: { input: 1840, output: 96, total: 1936 }, sessionId: session }, { seq: 1042, ts: now, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'tool.call', turn: 1, step: 1, at: now, callId: 'call_01H', name: 'bash', args: { command: 'npm run build', description: 'Compila o projeto' }, sessionId: session }, { seq: 1043, ts: now, session }),
  frame(OUTBOUND.APPROVAL_REQUEST, {
    requestId: 'req_01HZZ9',
    sessionId: session,
    toolName: 'bash',
    callId: 'call_01H',
    reason: 'O comando escreve fora do workspace.',
    args: { command: 'cp -r dist/ /var/www/pockethound' },
    digest: '9f21c4ab77e0d138',
    expiresAt: now + 90000,
  }, { seq: 1044, ts: now, session }),
  frame(OUTBOUND.APPROVAL_RESOLVED, { requestId: 'req_01HZZ9', outcome: 'allowed-once', by: 'phone', toolName: 'bash' }, { seq: 1045, ts: now + 3000, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'tool.result', turn: 1, step: 1, at: now + 4000, callId: 'call_01H', isError: false, text: 'build ok\n47 arquivos publicados', sessionId: session }, { seq: 1046, ts: now + 4000, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'todo.write', at: now + 4200, todos: [{ content: 'Compilar', status: 'completed' }, { content: 'Publicar', status: 'in_progress' }], sessionId: session }, { seq: 1047, ts: now + 4200, session }),
  frame(OUTBOUND.TURN_EVENT, { kind: 'turn.end', turn: 1, reason: 'completed', at: now + 5000, sessionId: session }, { seq: 1048, ts: now + 5000, session }),
  frame(OUTBOUND.QUESTION_REQUEST, { requestId: 'req_01HZZA', sessionId: session, questions: [{ id: 'q1', question: 'Sigo com o deploy?', header: 'Confirmar', options: [{ label: 'Sim, publique' }, { label: 'Não, espere' }] }], expiresAt: now + 300000 }, { seq: 1049, ts: now + 6000, session }),
  frame(OUTBOUND.DESK_STATE, { at: now, hostname: 'workstation', platform: 'linux', release: '6.9.0', cpuModel: 'AMD Ryzen 7', cores: 16, uptimeSeconds: 84213, loadAvg: [0.42, 0.61, 0.55], memTotalMb: 32000, memUsedMb: 12480, cpuPercent: 17.4, temperatureC: 48.5 }, { seq: 0, ts: now }),
  frame(OUTBOUND.NOTICE, { level: 'success', title: 'Build publicado', body: '47 arquivos foram para produção.', at: now }, { seq: 0, ts: now }),
  frame(OUTBOUND.REPLAY_DONE, { from: 0, to: 1049 }, { seq: 0, ts: now }),
  frame(OUTBOUND.PONG, { echo: 'abc123' }, { seq: 0, ts: now }),
]

/** Quadros celular → PC. */
const inbound = [
  { v: PROTOCOL_VERSION, type: INBOUND.HELLO_ACK, seq: 0, payload: { deviceName: 'Pixel do Ari', deviceId: 'a1b2c3d4e5f60718', lastSeq: 1042 } },
  { v: PROTOCOL_VERSION, type: INBOUND.SUBSCRIBE, seq: 0, payload: { cursor: 1042 } },
  { v: PROTOCOL_VERSION, type: INBOUND.PROMPT_SEND, seq: 0, payload: { sessionId: session, text: 'agora roda os testes', mode: 'followup' } },
  { v: PROTOCOL_VERSION, type: INBOUND.APPROVAL_DECIDE, seq: 0, payload: { requestId: 'req_01HZZ9', outcome: 'allowed-once', remember: true, rememberAll: false } },
  { v: PROTOCOL_VERSION, type: INBOUND.QUESTION_ANSWER, seq: 0, payload: { requestId: 'req_01HZZA', answers: [{ id: 'q1', selected: ['Sim, publique'] }] } },
  { v: PROTOCOL_VERSION, type: INBOUND.SESSION_CANCEL, seq: 0, payload: { sessionId: session } },
  { v: PROTOCOL_VERSION, type: INBOUND.SESSION_SELECT, seq: 0, payload: { sessionId: session } },
  { v: PROTOCOL_VERSION, type: INBOUND.PING, seq: 0, payload: { echo: 'abc123' } },
]

const document = {
  protocol: PROTOCOL_VERSION,
  generatedAt: new Date().toISOString(),
  note: 'Quadros canônicos do PocketHound. O app Android desserializa exatamente estes.',
  outbound,
  inbound,
}

const text = JSON.stringify(document, null, 2)

if (process.argv.includes('--write')) {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = join(here, '..', 'docs', 'fixtures.json')
  writeFileSync(file, text + '\n')
  process.stdout.write('gravado em ' + file + ' (' + outbound.length + ' de ida, ' + inbound.length + ' de volta)\n')
} else {
  process.stdout.write(text + '\n')
}
