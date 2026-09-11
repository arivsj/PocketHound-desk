/**
 * A paleta, do lado do JavaScript.
 *
 * **Este arquivo espelha `src/renderer/style.css`.** O CSS é a fonte da
 * verdade para a interface; aqui ficam só os valores que o processo principal
 * precisa antes de existir uma janela — hoje, a cor de fundo da BrowserWindow,
 * que evita o flash branco no boot.
 *
 * No sistema anterior esse valor estava duplicado à mão no `main.js`
 * (`backgroundColor: "#0a0a1a"`) e saía de sincronia com `--bg` em silêncio.
 * Aqui `.dev/check-design.mjs` compara os dois e falha se divergirem.
 *
 * @module pockethound-desk/theme
 */

'use strict'

/** Paleta completa, idêntica aos tokens do CSS e ao Color.kt do Android. */
const PALETTE = Object.freeze({
  void: '#06030E',
  bg: '#0A0716',
  surface: '#140E28',
  surface2: '#1C1436',
  surface3: '#251A47',
  border: '#2E2154',
  borderHi: '#4A3390',
  violet: '#B36BFF',
  violetSoft: '#D6B4FF',
  violetDeep: '#7B3FE4',
  magenta: '#E45CFF',
  indigo: '#7C7CFF',
  amber: '#FF8A3D',
  ok: '#35E39B',
  warn: '#FFB020',
  danger: '#FF2E6A',
  info: '#6BA8FF',
  text: '#DCD2F5',
  textDim: '#8A7BB5',
  textMute: '#5B4F7D',
})

module.exports = { PALETTE, BACKGROUND: PALETTE.bg }
