/**
 * Auditoria do design system — a paleta violeta não pode regredir.
 *
 *   node .dev/check-design.mjs
 *
 * Por que existe: o dashboard anterior tinha a cor escrita à mão em 22
 * \`rgba(0,255,247,a)\` no CSS e 20 hex dentro do JavaScript. Bastava um
 * \`git merge\` distraído para a paleta rachar em duas. Aqui a regra é
 * verificável: **um token por acento, todo véu derivado do canal, zero hex no
 * JavaScript**, e os mesmos valores nos dois apps.
 */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
// O repositório Android é irmão deste, mas não dentro dele: quem clona só o
// desk não tem o par. Caminho por variável de ambiente, com um palpite que
// funciona para quem segue o README — nada de caminho absoluto de uma máquina
// específica num repositório público.
const ANDROID = process.env.POCKETHOUND_ANDROID
  ?? join(homedir(), 'AndroidStudioProjects', 'PocketHound')

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
 * Lista arquivos de um diretório recursivamente, ignorando pastas pesadas.
 * @param {string} directory - raiz.
 * @param {string[]} extensions - extensões de interesse.
 * @returns {string[]} caminhos.
 */
function walk(directory, extensions) {
  const out = []
  const skip = new Set(['node_modules', '.git', '.shots', '.cache', '.npm-cache', '.electron-cache', 'build'])
  for (const entry of readdirSync(directory)) {
    if (skip.has(entry)) continue
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, extensions))
    else if (extensions.includes(extname(entry))) out.push(full)
  }
  return out
}

/* ------------------------------------------------- tokens do CSS */

console.log('tokens do design system')
/**
 * Remove comentários do código antes de auditar.
 * Comentário não é código: o próprio DESIGN.md e os comentários deste projeto
 * citam os hex antigos para explicar o que mudou, e isso não pode contar como
 * vazamento de paleta.
 *
 * @param {string} text - fonte.
 * @returns {string} fonte sem comentários.
 */
function semComentarios(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const css = semComentarios(readFileSync(join(root, 'src', 'renderer', 'style.css'), 'utf8'))

/** Paleta documentada em docs/DESIGN.md. */
const ESPERADO = {
  '--ph-void': '#06030E',
  '--ph-bg': '#0A0716',
  '--ph-surface': '#140E28',
  '--ph-surface-2': '#1C1436',
  '--ph-surface-3': '#251A47',
  '--ph-border': '#2E2154',
  '--ph-border-hi': '#4A3390',
  '--ph-violet': '#B36BFF',
  '--ph-violet-soft': '#D6B4FF',
  '--ph-violet-deep': '#7B3FE4',
  '--ph-magenta': '#E45CFF',
  '--ph-indigo': '#7C7CFF',
  '--ph-amber': '#FF8A3D',
  '--ph-ok': '#35E39B',
  '--ph-warn': '#FFB020',
  '--ph-danger': '#FF2E6A',
  '--ph-info': '#6BA8FF',
  '--ph-text': '#DCD2F5',
  '--ph-text-dim': '#8A7BB5',
  '--ph-text-mute': '#5B4F7D',
}

const ausentes = []
const divergentes = []
for (const [token, hex] of Object.entries(ESPERADO)) {
  const match = css.match(new RegExp(token.replace(/-/g, '\\-') + ':\\s*([^;]+);'))
  if (!match) { ausentes.push(token); continue }
  if (match[1].trim().toUpperCase() !== hex) divergentes.push({ token, esperado: hex, encontrado: match[1].trim() })
}
check('todos os 20 tokens de cor existem', ausentes.length === 0, ausentes)
check('nenhum token divergiu do DESIGN.md', divergentes.length === 0, divergentes)

/* --------------------------------------------- canais RGB */

console.log('canais RGB — a correção de manutenibilidade')
const CANAIS = {
  '--ph-violet-rgb': '179 107 255',
  '--ph-magenta-rgb': '228 92 255',
  '--ph-danger-rgb': '255 46 106',
  '--ph-amber-rgb': '255 138 61',
  '--ph-ok-rgb': '53 227 155',
  '--ph-info-rgb': '107 168 255',
}
const canaisAusentes = []
for (const [token, valor] of Object.entries(CANAIS)) {
  if (!css.includes(token + ':') || !css.replace(/\s+/g, ' ').includes(token + ': ' + valor)) canaisAusentes.push(token)
}
check('todo acento publica o canal RGB', canaisAusentes.length === 0, canaisAusentes)

/* ---------------------------------- ausência da paleta antiga */

console.log('a paleta antiga não pode reaparecer')
const ANTIGOS = {
  '#00FFF7': 'ciano antigo (acento primário)',
  '#00fff7': 'ciano antigo',
  '#0A0A1A': 'fundo antigo',
  '#0a0a1a': 'fundo antigo',
  '#12122A': 'superfície antiga',
  '#12122a': 'superfície antiga',
  '#1A1A3A': 'superfície 2 antiga',
  '#1a1a3a': 'superfície 2 antiga',
  '#FF00EA': 'magenta antigo',
  '#ff00ea': 'magenta antigo',
  '#FF6B00': 'laranja antigo',
  '#ff6b00': 'laranja antigo',
  '#FF0044': 'perigo antigo',
  '#ff0044': 'perigo antigo',
  '#C0C0E0': 'texto antigo',
  '#c0c0e0': 'texto antigo',
  '#6060A0': 'texto fraco antigo',
  '#6060a0': 'texto fraco antigo',
  '#2A2A5A': 'borda antiga',
  '#2a2a5a': 'borda antiga',
  '#00FF41': 'verde matrix antigo',
  '#00ff41': 'verde matrix antigo',
}

const fontes = [...walk(join(root, 'src'), ['.js', '.css', '.html']), ...walk(join(root, 'scripts'), ['.js'])]
const vazamentos = []
for (const file of fontes) {
  const text = semComentarios(readFileSync(file, 'utf8'))
  for (const [hex, descricao] of Object.entries(ANTIGOS)) {
    if (text.includes(hex)) vazamentos.push({ arquivo: file.replace(root + '/', ''), hex, descricao })
  }
}
check('nenhum resquício da paleta ciano/azul', vazamentos.length === 0, vazamentos)

/* ---------------------------------------- véus derivados, não manuais */

console.log('véus derivados do canal')
const rgbaManuais = []
for (const file of fontes.filter((f) => f.endsWith('.css'))) {
  const text = semComentarios(readFileSync(file, 'utf8'))
  const matches = text.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) ?? []
  if (matches.length) rgbaManuais.push({ arquivo: file.replace(root + '/', ''), ocorrencias: matches.length })
}
check('o CSS não repete rgba() numérico — usa rgb(var(--canal) / a)', rgbaManuais.length === 0, rgbaManuais)

/* -------------------------------- zero hex no JavaScript do renderer */

console.log('nenhuma cor escrita à mão no JavaScript')
// Arquivos autorizados a conter hex, com o motivo:
//
//   src/core/theme.js     espelho da paleta para o processo principal; o teste
//                         acima compara cada valor com o CSS
//   src/core/pairing-qr.js preto e branco PUROS no QR. Não é escolha de design:
//                         o leitor precisa de contraste real entre módulo e
//                         fundo, e um violeta sobre quase-preto não decodifica.
//                         O fundo branco do QR é o único bloco claro do sistema.
const PERMITIDOS = ['src/core/theme.js', 'src/core/pairing-qr.js']
const hexNoJs = []
for (const file of fontes.filter((f) => f.endsWith('.js'))) {
  const relativo = file.replace(root + '/', '')
  if (PERMITIDOS.includes(relativo)) continue
  if (relativo.includes('capture') || relativo.includes('check-pages')) continue
  const text = semComentarios(readFileSync(file, 'utf8'))
  const matches = text.match(/#[0-9a-fA-F]{6}\b/g) ?? []
  if (matches.length) hexNoJs.push({ arquivo: relativo, hex: [...new Set(matches)] })
}
check('o renderer não contém hex de cor', hexNoJs.length === 0, hexNoJs)

/* ------------------------------------ mesma paleta nos dois apps */

console.log('a paleta do Android é a mesma do desktop')
const colorKt = join(ANDROID, 'app/src/main/java/com/pockethound/app/ui/theme/Color.kt')
if (!existsSync(colorKt)) {
  console.log('  (repositório Android não encontrado — verificação pulada)')
} else {
  const kotlin = readFileSync(colorKt, 'utf8')
  const pares = {
    PhVoid: '#06030E', PhBg: '#0A0716', PhSurface: '#140E28', PhSurface2: '#1C1436',
    PhSurface3: '#251A47', PhBorder: '#2E2154', PhBorderHi: '#4A3390',
    PhViolet: '#B36BFF', PhVioletSoft: '#D6B4FF', PhVioletDeep: '#7B3FE4',
    PhMagenta: '#E45CFF', PhIndigo: '#7C7CFF', PhAmber: '#FF8A3D',
    PhOk: '#35E39B', PhWarn: '#FFB020', PhDanger: '#FF2E6A', PhInfo: '#6BA8FF',
    PhText: '#DCD2F5', PhTextDim: '#8A7BB5', PhTextMute: '#5B4F7D',
  }
  const errosAndroid = []
  for (const [nome, hex] of Object.entries(pares)) {
    const esperado = 'val ' + nome + ' = Color(0xFF' + hex.slice(1) + ')'
    if (!kotlin.includes(esperado)) errosAndroid.push({ nome, esperado })
  }
  check('Color.kt bate hex a hex com o CSS', errosAndroid.length === 0, errosAndroid)
  check('o Android também publica os canais RGB', kotlin.includes('PH_VIOLET_RGB') && kotlin.includes('179, 107, 255'))
  check('o Android não tem dynamicColor', !kotlin.toLowerCase().includes('dynamiccolor'))
}

/* ------------------------------- o Android não herdou os defeitos */

console.log('o app Android não repete os defeitos do projeto anterior')
if (existsSync(ANDROID)) {
  const ktFiles = walk(join(ANDROID, 'app/src/main/java'), ['.kt'])
  const ktText = ktFiles.map((file) => semComentarios(readFileSync(file, 'utf8'))).join('\n')

  const antigosKt = Object.entries(ANTIGOS)
    .filter(([hex]) => ktText.includes(hex))
    .map(([hex, descricao]) => ({ hex, descricao }))
  check('nenhum hex da paleta ciano no Kotlin', antigosKt.length === 0, antigosKt)

  const themeKt = readFileSync(join(ANDROID, 'app/src/main/java/com/pockethound/app/ui/theme/Theme.kt'), 'utf8')
  // O projeto anterior mapeava 12 papéis e deixava AlertDialog, OutlinedTextField,
  // FilterChip e companhia renderizando com o padrão do Material.
  const PAPEIS = [
    'primaryContainer', 'onPrimaryContainer', 'inversePrimary',
    'secondaryContainer', 'onSecondaryContainer',
    'tertiaryContainer', 'onTertiaryContainer',
    'surfaceTint', 'surfaceContainerHigh', 'surfaceContainerHighest',
    'surfaceContainerLow', 'surfaceContainerLowest', 'surfaceBright', 'surfaceDim',
    'inverseSurface', 'inverseOnSurface', 'outlineVariant',
    'errorContainer', 'onErrorContainer', 'scrim',
  ]
  const naoMapeados = PAPEIS.filter((papel) => !new RegExp(papel + '\\s*=').test(themeKt))
  check('todos os papéis do Material 3 estão mapeados', naoMapeados.length === 0, naoMapeados)

  const properties = readFileSync(join(ANDROID, 'gradle.properties'), 'utf8')
  check('nenhum caminho absoluto da máquina versionado',
    !/^android\.aapt2FromMavenOverride/m.test(properties))

  const themes = readFileSync(join(ANDROID, 'app/src/main/res/values/themes.xml'), 'utf8')
  check('a janela abre escura (sem flash branco)',
    !themes.includes('Material.Light') && themes.includes('windowBackground'))

  // O projeto anterior tinha o IP da máquina de desenvolvimento como valor
  // PADRÃO em cinco lugares, com três portas diferentes em circulação
  // (5000 no default, 5005 no texto de apoio, 5055 no QR de teste).
  const vazamentosIp = []
  for (const file of ktFiles) {
    const linhas = readFileSync(file, 'utf8').split('\n')
    linhas.forEach((linha, indice) => {
      if (/placeholder/i.test(linha)) return
      if (/=\s*"https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(linha)) {
        vazamentosIp.push({ arquivo: file.replace(ANDROID + '/', ''), linha: indice + 1, texto: linha.trim().slice(0, 80) })
      }
    })
  }
  check('nenhum IP privado como valor padrão no código', vazamentosIp.length === 0, vazamentosIp)

  // O projeto anterior misturava textos com e sem acento ("Diagnostico" ao lado
  // de "conexão"), o que denuncia string escrita às pressas.
  // Só o CONTEÚDO entre aspas conta — e linha a linha. Um regex com [^"] sobre o
  // arquivo inteiro atravessa quebras de linha e acusa nome de variável em
  // português (\`val sessao = ...\`) como se fosse texto de interface.
  const semAcento = []
  for (const file of ktFiles) {
    // Comentario nao e interface: um KDoc pode citar o sintoma de um bug
    // ("a camera nao le nada") sem que isso vire texto para o usuario.
    for (const linha of semComentarios(readFileSync(file, 'utf8')).split('\n')) {
      for (const conteudo of linha.match(/"([^"\\]*)"/g) ?? []) {
        const texto = conteudo.slice(1, -1)
        if (texto.length < 4) continue
        for (const palavra of ['nao ', 'conexao', 'codigo', 'endereco', 'sessao', 'aprovacao', 'configuracoes']) {
          if (texto.toLowerCase().includes(palavra)) {
            semAcento.push({ arquivo: file.replace(ANDROID + '/', ''), palavra, texto })
          }
        }
      }
    }
  }
  check('nenhuma string de interface sem acentuação', semAcento.length === 0, semAcento)

  const typeKt = readFileSync(join(ANDROID, 'app/src/main/java/com/pockethound/app/ui/theme/Type.kt'), 'utf8')
  check('as três famílias do app anterior estão presentes',
    typeKt.includes('val Orbitron') && typeKt.includes('val Rajdhani') && typeKt.includes('val JetBrainsMono'))
  // O anterior pedia font-weight 800 a uma família que não tinha esse peso.
  check('nenhum peso pedido sem arquivo correspondente',
    !typeKt.includes('FontWeight.ExtraBold') && !typeKt.includes('FontWeight.Black'))
} else {
  console.log('  (repositório Android não encontrado — verificações puladas)')
}

/* --------------------------- theme.js bate com o CSS (main.js) */

console.log('o JavaScript não duplica a paleta')
const themeText = readFileSync(join(root, 'src', 'core', 'theme.js'), 'utf8')
const divergenciasJs = []
for (const [token, hex] of Object.entries(ESPERADO)) {
  // O nome do token no JS é o mesmo, sem o prefixo --ph- e em camelCase.
  const nome = token.replace('--ph-', '').replace(/-(\w)/g, (_m, letra) => letra.toUpperCase())
  if (!themeText.includes(nome + ": '" + hex + "'")) divergenciasJs.push({ nome, hex })
}
check('src/core/theme.js espelha os tokens do CSS', divergenciasJs.length === 0, divergenciasJs)
check('main.js usa a constante, não um literal',
  readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('backgroundColor: BACKGROUND'))

/* --------------------------------------- assinatura visual herdada */

console.log('assinatura visual herdada do sistema anterior')
const ASSINATURA = [
  ['sidebar de 280px', /--ph-sidebar|width:\s*280px/],
  ['padding de conteúdo 30px', /padding:\s*30px/],
  ['grade de cards minmax(220px', /minmax\(220px/],
  ['grade de seções minmax(380px', /minmax\(380px/],
  ['padding de card 20px', /padding:\s*20px/],
  ['padding de modal 24px', /padding:\s*24px/],
  ['raio 4px nos controles', /--ph-r-sm:\s*4px/],
  ['raio 6px na navegação', /--ph-r-md:\s*6px/],
  ['raio 8px nos cards', /--ph-r-lg:\s*8px/],
  ['transição de 300ms', /\.3s ease/],
  ['transição de 200ms', /\.2s ease/],
  ['transição de 150ms', /\.15s/],
  ['keyframe de pulso', /@keyframes phPulse/],
  ['keyframe de rotação', /@keyframes phSpin/],
  ['keyframe do badge', /@keyframes phBadge/],
  ['glow de texto no destaque', /text-shadow:\s*0 0 8px currentColor/],
  ['Orbitron nos títulos', /--ph-font-display:\s*'Orbitron'/],
  ['JetBrains Mono no corpo', /--ph-font-mono:\s*'JetBrains Mono'/],
  ['uppercase nas legendas', /uppercase/],
]
const faltando = ASSINATURA.filter(([, pattern]) => !pattern.test(css)).map(([nome]) => nome)
check('a linguagem visual do sistema anterior foi mantida', faltando.length === 0, faltando)

/* ----------------------------------- correções que o antigo não tinha */

console.log('correções que o sistema anterior não tinha')
check('respeita prefers-reduced-motion', css.includes('prefers-reduced-motion'))
check('foco visível declarado', css.includes(':focus-visible'))
check('só carrega pesos que existem (400 e 700)', css.includes('Orbitron:wght@400;700') && !css.includes('wght@400;700;900'))
check('nenhum font-weight órfão', !/font-weight:\s*800/.test(css) && !/font-weight:\s*900/.test(css))

console.log('')
console.log(passed + ' passaram, ' + failed + ' falharam')
process.exit(failed === 0 ? 0 : 1)
