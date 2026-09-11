/**
 * Retrato da máquina que vai para o celular.
 *
 * Lê direto de `/proc` e `os` — sem dependência, sem subprocesso, sem sudo.
 * O que não existir na plataforma simplesmente não aparece no retrato, em vez
 * de virar zero (zero mente: "0% de CPU" e "não sei" são coisas diferentes).
 *
 * @module pockethound-desk/desk-state
 */

'use strict'

const { cpus, loadavg, totalmem, freemem, uptime, hostname, platform, release } = require('node:os')
const { existsSync, readFileSync } = require('node:fs')

/**
 * Lê um arquivo de texto do sistema, devolvendo null quando não existe.
 * @param {string} file - caminho.
 * @returns {string|null} conteúdo, ou null.
 */
function readText(file) {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  } catch {
    return null
  }
}

/** Coletor com memória entre leituras — CPU é uma taxa, precisa de duas amostras. */
class DeskState {
  constructor() {
    this.previous = null
    this.model = (cpus()[0]?.model ?? 'CPU').trim()
    this.cores = cpus().length
  }

  /**
   * Lê os contadores agregados de CPU do /proc/stat.
   * @returns {{idle: number, total: number}|null} contadores, ou null fora do Linux.
   */
  #cpuSample() {
    const text = readText('/proc/stat')
    if (!text) return null
    const line = text.split('\n').find((entry) => entry.startsWith('cpu '))
    if (!line) return null
    const parts = line.trim().split(/\s+/).slice(1).map(Number)
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0)
    const total = parts.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
    return { idle, total }
  }

  /**
   * Temperatura da CPU, quando o sistema expõe.
   * @returns {number|null} graus Celsius, ou null.
   */
  #temperature() {
    const zones = readText('/proc/stat') === null ? [] : []
    const candidates = [
      '/sys/class/thermal/thermal_zone0/temp',
      '/sys/class/hwmon/hwmon0/temp1_input',
      '/sys/class/hwmon/hwmon1/temp1_input',
    ]
    for (const file of candidates) {
      const text = readText(file)
      if (!text) continue
      const value = Number(text.trim())
      if (!Number.isFinite(value) || value <= 0) continue
      // thermal_zone reporta milésimos de grau; hwmon também, na maioria.
      const celsius = value > 1000 ? value / 1000 : value
      if (celsius > 0 && celsius < 150) return Math.round(celsius * 10) / 10
    }
    void zones
    return null
  }

  /**
   * Monta o retrato agora.
   * @returns {object} estado da máquina, só com o que foi possível medir.
   */
  sample() {
    const state = {
      at: Date.now(),
      hostname: hostname(),
      platform: platform(),
      release: release(),
      cpuModel: this.model,
      cores: this.cores,
      uptimeSeconds: Math.round(uptime()),
      loadAvg: loadavg().map((value) => Math.round(value * 100) / 100),
      memTotalMb: Math.round(totalmem() / 1048576),
      memUsedMb: Math.round((totalmem() - freemem()) / 1048576),
    }

    const current = this.#cpuSample()
    if (current && this.previous) {
      const totalDelta = current.total - this.previous.total
      const idleDelta = current.idle - this.previous.idle
      if (totalDelta > 0) {
        state.cpuPercent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10))
      }
    }
    if (current) this.previous = current

    const temperature = this.#temperature()
    if (temperature !== null) state.temperatureC = temperature

    return state
  }
}

module.exports = { DeskState }
