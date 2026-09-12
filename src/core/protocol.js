/**
 * Protocolo PocketHound — lado PC.
 *
 * Espelho de `dsh-pockethound/lib/protocol.js`. O plugin projeta os eventos do
 * Harness; aqui só reembalamos, acrescentamos o que é do PC (estado da máquina,
 * presença de celular) e assinamos o transporte.
 *
 * Regra que não se quebra: **um único `seq` no sistema inteiro**. Ele nasce no
 * plugin, o desk repassa 1:1 e o celular confirma com `subscribe { cursor }`.
 * É isso que faz trocar de rede não perder nada.
 *
 * @module pockethound-desk/protocol
 */

'use strict'

/** Versão do protocolo. Precisa bater com a do plugin e com a do app. */
const PROTOCOL_VERSION = 1

/** Quadros que o PC envia ao celular. */
const OUTBOUND = Object.freeze({
  HELLO: 'hello',
  SESSION_UPSERT: 'session.upsert',
  SESSION_GONE: 'session.gone',
  TURN_EVENT: 'turn.event',
  APPROVAL_REQUEST: 'approval.request',
  APPROVAL_RESOLVED: 'approval.resolved',
  QUESTION_REQUEST: 'question.request',
  DESK_STATE: 'desk.state',
  NOTICE: 'notice',
  PONG: 'pong',
  REPLAY_DONE: 'replay.done',
  BRIDGE_STATE: 'bridge.state',
  /** Resposta a `workspace.list`: a lista de workspaces do harness. */
  WORKSPACE_LIST: 'workspace.list',
})

/** Quadros que o celular envia ao PC. */
const INBOUND = Object.freeze({
  HELLO_ACK: 'hello.ack',
  SUBSCRIBE: 'subscribe',
  PROMPT_SEND: 'prompt.send',
  WORKSPACE_LIST: 'workspace.list',
  SESSION_CREATE: 'session.create',
  APPROVAL_DECIDE: 'approval.decide',
  QUESTION_ANSWER: 'question.answer',
  SESSION_CANCEL: 'session.cancel',
  SESSION_SELECT: 'session.select',
  PING: 'ping',
})

/** Modos de transporte, do mais direto ao mais mediado. */
const TransportMode = Object.freeze({
  AUTO: 'auto',
  DIRECT: 'direct',
  P2P: 'p2p',
})

/** Estados possíveis do vínculo com o celular. */
const LinkState = Object.freeze({
  OFFLINE: 'offline',
  DIRECT: 'direct',
  P2P: 'p2p',
})

/**
 * Monta um quadro pronto para ir ao celular.
 * @param {string} type - tipo do quadro (ver OUTBOUND).
 * @param {object} payload - conteúdo específico do tipo.
 * @param {object} [extra] - campos adicionais (`session`, `seq`, `ts`).
 * @returns {object} o quadro.
 */
function frame(type, payload, extra = {}) {
  return {
    v: PROTOCOL_VERSION,
    seq: extra.seq ?? 0,
    ts: extra.ts ?? Date.now(),
    type,
    session: extra.session,
    payload,
  }
}

/**
 * Valida um quadro recebido do celular.
 * Recusa cedo o que não tem o mínimo para ser entendido — o resto do código
 * pode confiar no formato.
 * @param {unknown} value - valor cru recebido.
 * @returns {{ok: true, frame: object}|{ok: false, error: string}} veredito.
 */
function parseInbound(value) {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'quadro não é objeto' }
  const type = value.type
  if (typeof type !== 'string' || !Object.values(INBOUND).includes(type)) {
    return { ok: false, error: 'tipo desconhecido: ' + String(type) }
  }
  const version = Number(value.v ?? PROTOCOL_VERSION)
  if (version > PROTOCOL_VERSION) return { ok: false, error: 'versão do app é mais nova que a do PC' }
  return { ok: true, frame: { v: version, type, seq: Number(value.seq ?? 0), payload: value.payload ?? {} } }
}

module.exports = {
  PROTOCOL_VERSION,
  OUTBOUND,
  INBOUND,
  TransportMode,
  LinkState,
  frame,
  parseInbound,
}
