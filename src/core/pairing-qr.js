/**
 * QR de pareamento — o que o celular lê para entrar.
 *
 * O QR carrega o **ticket do túnel P2P**, e é isso que faz o pareamento
 * funcionar de qualquer rede. Sem ele, o celular teria de alcançar o PC por
 * HTTP, o que só acontece na mesma rede local — e no seu caso o PC está no
 * cabo (192.168.42.x) e o telefone no Wi-Fi (192.168.0.x), então nem se
 * enxergam.
 *
 * Formato (o mesmo que o app decodifica em `PairingPayload.kt`):
 *
 *   pockethound://pair?v=1&n=<pc>&t=<ticket>&k=<endpointId>&x=<expira>&a=<endereço>&c=<código>
 *
 *   t  ticket do iroh     — obrigatório; é o caminho até o PC
 *   k  endpointId         — obrigatório; identifica o PC no túnel
 *   x  validade (ms)      — obrigatório; o código morre junto
 *   a  endereço direto    — opcional; atalho quando estão na mesma rede
 *   c  código de 6 dígitos— opcional; o QR já preenche, mas digitar também vale
 *
 * @module pockethound-desk/pairing-qr
 */

'use strict'

const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { hostname } = require('node:os')

/** Quanto tempo o QR fica válido, em milissegundos. */
const QR_TTL_MS = 300000

/** Esquema e host que o app exige. Qualquer outro é recusado por ele. */
const SCHEME = 'pockethound'
const HOST = 'pair'
const VERSION = 1

/**
 * Lê o anúncio do túnel P2P, publicado pela ponte.
 *
 * @param {string} deskDir - raiz do repositório do desk.
 * @returns {{ticket: string, endpointId: string, relayUrl?: string}|null} o anúncio, ou null quando a ponte não subiu.
 */
function lerTunel(deskDir) {
  const arquivo = join(deskDir, 'state', 'p2p', 'endpoint.json')
  try {
    if (!existsSync(arquivo)) return null
    const dados = JSON.parse(readFileSync(arquivo, 'utf8'))
    if (!dados?.ticket || !dados?.endpointId) return null
    return dados
  } catch {
    return null
  }
}

/**
 * Monta o texto do QR.
 *
 * @param {object} entrada - o que entra no QR.
 * @param {string} entrada.code - código de pareamento de 6 dígitos.
 * @param {number} entrada.expiresAt - quando o código expira (ms epoch).
 * @param {string} [entrada.address] - endereço direto, quando houver.
 * @param {object|null} [entrada.tunel] - anúncio do túnel P2P.
 * @param {string} [entrada.pcName] - nome do PC.
 * @returns {string} a URI de pareamento.
 */
function montarPayload({ code, expiresAt, address, tunel, pcName }) {
  const parametros = new URLSearchParams()
  parametros.set('v', String(VERSION))
  parametros.set('n', pcName || hostname())

  if (tunel?.ticket) parametros.set('t', tunel.ticket)
  if (tunel?.endpointId) parametros.set('k', tunel.endpointId)
  parametros.set('x', String(expiresAt))

  if (address) parametros.set('a', address)
  if (code) parametros.set('c', code)

  return SCHEME + '://' + HOST + '?' + parametros.toString()
}

/**
 * Gera o QR como SVG.
 *
 * SVG e não PNG porque a interface desenha direto e a caixa branca do QR
 * (exigência do leitor) fica sendo só o fundo do elemento — não precisa de
 * arquivo, buffer nem caminho temporário.
 *
 * @param {string} texto - conteúdo do QR.
 * @returns {Promise<string>} o SVG.
 */
async function gerarSvg(texto) {
  // require tardio: a dependência só é tocada quando alguém pede um QR, e o
  // desk sobe mesmo sem ela instalada.
  const QRCode = require('qrcode')
  return QRCode.toString(texto, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' },
  })
}

/**
 * Junta tudo o que a tela precisa para mostrar o pareamento.
 *
 * @param {object} entrada - dados do pareamento.
 * @param {string} entrada.deskDir - raiz do repositório do desk.
 * @param {string} entrada.code - código de 6 dígitos.
 * @param {number} entrada.expiresAt - validade do código (ms epoch).
 * @param {string} [entrada.address] - endereço direto do servidor do celular.
 * @param {string} [entrada.pcName] - nome do PC.
 * @returns {Promise<object>} payload, SVG e um resumo do que o QR carrega.
 */
async function montarPareamento({ deskDir, code, expiresAt, address, pcName }) {
  const tunel = lerTunel(deskDir)
  const payload = montarPayload({ code, expiresAt, address, tunel, pcName })
  const svg = await gerarSvg(payload)

  return {
    payload,
    svg,
    code,
    expiresAt,
    // A tela usa isto para dizer a verdade ao usuário: com túnel, funciona de
    // qualquer rede; sem, só na mesma rede.
    viaTunel: Boolean(tunel?.ticket),
    relayUrl: tunel?.relayUrl ?? null,
    endpointId: tunel?.endpointId ?? null,
    address: address ?? null,
    ttlMs: QR_TTL_MS,
  }
}

module.exports = { montarPareamento, montarPayload, lerTunel, gerarSvg, QR_TTL_MS, SCHEME, HOST, VERSION }
