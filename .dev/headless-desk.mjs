/**
 * Desk headless — sobe só o servidor do celular, sem Electron.
 *
 *   node .dev/headless-desk.mjs [porta]
 *
 * Existe para testar de verdade contra o app Android num emulador: o teste de
 * instrumentação precisa de um PC real do outro lado, e abrir a janela do
 * Electron para isso seria pesado e frágil.
 *
 * Imprime o código de pareamento no stdout e fica vivo até receber SIGTERM.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Store } = require('../src/core/config.js')
const { TransportServer } = require('../src/transport/server.js')

const porta = Number(process.argv[2] ?? 7411)
const estado = mkdtempSync(join(tmpdir(), 'pockethound-headless-'))
const store = new Store(estado)
store.updateConfig({ port: porta, bindHost: '0.0.0.0' })

const servidor = new TransportServer({ store, port: porta, host: '0.0.0.0' })

servidor.on('listening', ({ port }) => {
  const { code, expiresAt } = store.createPairingCode(600)
  // O código vai para um arquivo para o orquestrador ler sem depender de parsing.
  writeFileSync(join(estado, 'pair.json'), JSON.stringify({ code, expiresAt, port }))
  console.log('HEADLESS_READY ' + JSON.stringify({ port, pairFile: join(estado, 'pair.json'), code }))
})

servidor.on('phones', (n) => console.log('HEADLESS_PHONES ' + n))
servidor.on('paired', (d) => console.log('HEADLESS_PAIRED ' + JSON.stringify({ id: d.id, name: d.name })))
servidor.on('bind-error', (e) => console.log('HEADLESS_BIND_ERROR ' + e.message))

servidor.start()

process.on('SIGTERM', () => {
  servidor.stop()
  process.exit(0)
})
