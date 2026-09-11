/**
 * Ponte segura entre a interface e o processo principal.
 *
 * O renderer não tem Node: ele só vê esta lista fechada de funções. Toda
 * decisão de segurança (token, dispositivo, porta) fica do lado de cá.
 *
 * @module pockethound-desk/preload
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/** Canais que o renderer pode escutar. */
const EVENTS = ['snapshot', 'frame', 'log']

contextBridge.exposeInMainWorld('pockethound', {
  /** @returns {Promise<object>} retrato completo do app. */
  snapshot: () => ipcRenderer.invoke('ph:snapshot'),

  /** @returns {Promise<object>} sessões vivas na ponte. */
  sessions: () => ipcRenderer.invoke('ph:sessions'),

  /** @returns {Promise<object>} aprovações pendentes. */
  pending: () => ipcRenderer.invoke('ph:pending'),

  /** @returns {Promise<object>} aprovações decididas recentemente. */
  history: () => ipcRenderer.invoke('ph:history'),

  /** @returns {Promise<object>} regras "não perguntar de novo". */
  rules: () => ipcRenderer.invoke('ph:rules'),

  /**
   * Gera um código de pareamento.
   * @param {number} [ttlSeconds] - validade em segundos.
   * @returns {Promise<object>} código e validade.
   */
  pairCode: (ttlSeconds) => ipcRenderer.invoke('ph:pair-code', ttlSeconds),

  /**
   * Gera o QR de pareamento (payload + SVG).
   * @param {number} [ttlSeconds] - validade em segundos.
   * @returns {Promise<object>} o que a tela precisa para desenhar.
   */
  pairQr: (ttlSeconds) => ipcRenderer.invoke('ph:pair-qr', ttlSeconds),

  /**
   * Revoga um dispositivo.
   * @param {string} id - identificador.
   * @returns {Promise<object>} resultado.
   */
  revoke: (id) => ipcRenderer.invoke('ph:revoke', id),

  /**
   * Altera preferências.
   * @param {object} patch - campos.
   * @returns {Promise<object>} configuração resultante.
   */
  configure: (patch) => ipcRenderer.invoke('ph:configure', patch),

  /**
   * Abre uma pasta no gerenciador de arquivos do sistema.
   * @param {string} path - caminho.
   * @returns {Promise<void>} conclusão.
   */
  revealPath: (path) => ipcRenderer.invoke('ph:reveal', path),

  /** Controles da janela. */
  window: {
    minimize: () => ipcRenderer.invoke('ph:win', 'minimize'),
    maximize: () => ipcRenderer.invoke('ph:win', 'maximize'),
    close: () => ipcRenderer.invoke('ph:win', 'close'),
  },

  /**
   * Escuta um evento do processo principal.
   * @param {string} channel - um de EVENTS.
   * @param {(payload: unknown) => void} handler - tratador.
   * @returns {() => void} função para cancelar a escuta.
   */
  on: (channel, handler) => {
    if (!EVENTS.includes(channel)) return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('ph:' + channel, listener)
    return () => ipcRenderer.removeListener('ph:' + channel, listener)
  },
})
