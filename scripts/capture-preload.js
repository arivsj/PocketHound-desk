/**
 * Preload de captura — só para desenvolvimento.
 *
 * Fornece dados de exemplo no lugar do processo principal, para que a interface
 * possa ser renderizada e fotografada sem Harness, sem celular e sem tocar em
 * nada real. Nunca é usado pelo app de verdade.
 *
 * @module pockethound-desk/capture-preload
 */

'use strict'

const { contextBridge } = require('electron')

/** Sessões de exemplo. */
const SESSIONS = [
  {
    id: 'session-e13ee8d4',
    title: 'Refatorar o módulo de transporte e cobrir com testes',
    status: 'live',
    events: 60803,
    workspace: '/dev/PocketHound desk',
    logPath: '/home/u/.dsh/sessions/--dev--/session-e13ee8d4/session.jsonl.zstd',
  },
  {
    id: 'session-78c58bd4',
    title: 'Ajustar o menu inferior do app e revisar o contraste',
    status: 'live',
    events: 1204,
    workspace: '/dev/PocketHound',
    logPath: '/home/u/.dsh/sessions/--dev--/session-78c58bd4/session.jsonl.zstd',
  },
  // Sessão fria: existe só como log no disco. É o que permite abrir o app
  // depois e continuar uma conversa que ficou pela metade no PC.
  {
    id: 'bcfce385',
    title: '',
    status: 'cold',
    workspace: '/dev/PocketHound',
    origin: 'subagent',
    depth: 1,
    logPath: '/home/u/.dsh/sessions/--dev--/bcfce385/session.jsonl.zstd',
  },
]

const SNAPSHOT = {
  version: 1,
  bridge: { connected: true, cursor: 1042, info: { port: 41749, pid: 906765 }, stats: { frames: 1042, reconnects: 3 } },
  transport: { listening: true, host: '0.0.0.0', port: 7411, phones: 1, ring: 1042, stats: { framesIn: 1042, framesOut: 1042, connects: 2, rejects: 1 } },
  devices: [
    { id: 'a1b2c3d4e5f60718', name: 'Pixel do Ari', createdAt: Date.now() - 86400000, lastSeen: Date.now() - 4000, revoked: false },
    { id: 'ffee001122334455', name: 'Tablet antigo', createdAt: Date.now() - 604800000, lastSeen: Date.now() - 259200000, revoked: true },
  ],
  config: { port: 7411, approvalTimeoutMs: 90000, transportMode: 'auto', advertise: true, rain: true, bindHost: '0.0.0.0' },
  sessions: SESSIONS,
  counters: Array.from({ length: 60 }, (_, index) => Math.max(0, Math.round(Math.sin(index / 6) * 14 + 16 + (index % 7)))),
  pendingCount: 1,
  recentFrames: Array.from({ length: 9 }, (_, index) => ({
    seq: 1042 - index,
    type: ['turn.event', 'tool.call', 'approval.request', 'tool.result', 'session.upsert', 'turn.event', 'desk.state', 'text.done', 'approval.resolved'][index],
    ts: Date.now() - index * 1400,
    session: 'session-e13ee8d4',
  })).reverse(),
}

const PENDING = [{
  requestId: 'req-9f21',
  sessionId: 'session-e13ee8d4',
  toolName: 'bash',
  reason: 'O comando escreve fora do workspace e precisa da sua autorização.',
  args: { command: 'npm run build && cp -r dist/ /var/www/pockethound', description: 'Compila e publica' },
  expiresAt: Date.now() + 74000,
}]

const HISTORY = [
  { requestId: 'req-8a10', toolName: 'edit', outcome: 'allowed-once', by: 'phone', at: Date.now() - 42000 },
  { requestId: 'req-7f03', toolName: 'bash', outcome: 'allowed-once', by: 'rule', at: Date.now() - 190000 },
  { requestId: 'req-6e99', toolName: 'write', outcome: 'rejected', by: 'phone', at: Date.now() - 420000 },
]

const RULES = [
  { toolName: 'bash', outcome: 'allowed-once', all: false, at: Date.now() - 190000 },
  { toolName: 'edit', outcome: 'allowed-once', all: true, at: Date.now() - 600000 },
]

const LOGS = [
  { at: Date.now() - 2000, level: 'info', message: 'ponte conectada na porta 41749' },
  { at: Date.now() - 5000, level: 'info', message: 'celular "Pixel do Ari" entrou' },
  { at: Date.now() - 9000, level: 'warn', message: 'ponte caiu — tentando de novo' },
  { at: Date.now() - 12000, level: 'info', message: 'servidor do celular em 7411' },
]

contextBridge.exposeInMainWorld('pockethound', {
  snapshot: async () => SNAPSHOT,
  sessions: async () => SESSIONS,
  pending: async () => PENDING,
  history: async () => HISTORY,
  rules: async () => RULES,
  pairCode: async () => ({ code: '482913', expiresAt: Date.now() + 118000 }),
  revoke: async () => ({ ok: true }),
  configure: async (patch) => ({ ...SNAPSHOT.config, ...patch }),
  revealPath: async () => undefined,
  window: { minimize: () => {}, maximize: () => {}, close: () => {} },
  on: () => () => {},
})
