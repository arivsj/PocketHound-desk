# PocketHound — Design System

> A linguagem visual dos dois apps anteriores (CyberBot desktop e DoG CyberAgent)
> era **ciano elétrico** sobre quase-preto. O PocketHound mantém *tudo* dela —
> o fundo, o neon, o glow, a grade, a tipografia técnica, a chuva de caracteres —
> e desloca o eixo cromático para **violeta**. O que era `#00FFF7` vira
> `#B36BFF`.
>
> Este documento é a fonte da verdade para os dois lados: o CSS do app Electron
> e o `Color.kt` / `Theme.kt` do app Android saem daqui.

---

## 1. A paleta

### 1.1 Base — o quase-preto agora tem viés violeta

| Token | Hex | Substitui (projeto antigo) | Papel |
|---|---|---|---|
| `--ph-void` | `#06030E` | — | fundo absoluto, atrás de camadas e canvas |
| `--ph-bg` | `#0A0716` | `#0A0A1A` | fundo do app; fundo "afundado" de inputs; trilho da scrollbar |
| `--ph-surface` | `#140E28` | `#12122A` | superfície 1 — cards, painéis, sidebar |
| `--ph-surface-2` | `#1C1436` | `#1A1A3A` | superfície 2 — hover, elevado, trilhos de barra |
| `--ph-surface-3` | `#251A47` | — | superfície 3 — campos, chips, faixas |
| `--ph-border` | `#2E2154` | `#2A2A5A` | borda padrão, divisores, thumb da scrollbar |
| `--ph-border-hi` | `#4A3390` | — | borda em foco/hover/ativo |

### 1.2 Acentos neon

| Token | Hex | Substitui | Papel |
|---|---|---|---|
| `--ph-violet` | **`#B36BFF`** | `#00FFF7` | **acento primário / marca.** Todo neon do sistema antigo sai daqui |
| `--ph-violet-soft` | `#D6B4FF` | — | realce claro, texto sobre superfície escura, cabeça da chuva |
| `--ph-violet-deep` | `#7B3FE4` | — | fim de gradiente, estado pressionado |
| `--ph-magenta` | `#E45CFF` | `#FF00EA` | secundário — hover de card clicável, segunda série de gráfico |
| `--ph-indigo` | `#7C7CFF` | — | terciário frio — terceira série, links |
| `--ph-amber` | `#FF8A3D` | `#FF6B00` | atenção / em progresso — varredura, envio pendente |

### 1.3 Semânticos

| Token | Hex | Substitui | Papel |
|---|---|---|---|
| `--ph-ok` | `#35E39B` | `#00FF41` | sucesso, verificação aprovada |
| `--ph-warn` | `#FFB020` | — | aviso |
| `--ph-danger` | `#FF2E6A` | `#FF0044` | erro, perigo, parada, badge de pendência |
| `--ph-info` | `#6BA8FF` | — | informativo, estado neutro ativo |

### 1.4 Texto

| Token | Hex | Substitui | Papel |
|---|---|---|---|
| `--ph-text` | `#DCD2F5` | `#C0C0E0` | texto principal (lavanda, nunca branco puro) |
| `--ph-text-dim` | `#8A7BB5` | `#6060A0` | secundário: labels, legendas, cabeçalho de tabela |
| `--ph-text-mute` | `#5B4F7D` | — | terciário: placeholder, vazio, desabilitado |

### 1.5 Chuva de caracteres

| Token | Hex | Papel |
|---|---|---|
| `--ph-rain` | `#B36BFF` | corpo dos glifos no canvas |
| `--ph-rain-head` | `#F0E4FF` | "cabeça" clara que puxa o rastro |
| `--ph-rain-trace` | `rgba(10,7,22,0.05)` | véu que apaga o quadro anterior |

> O verde `#00FF41` da chuva original **sai de cena**: num sistema violeta ele
> brigava com tudo. O verde fica reservado ao significado "deu certo"
> (`--ph-ok`). A chuva passa a ser violeta — mesma animação, mesma leitura.

### 1.6 Canais RGB — a correção de manutenibilidade

O design system antigo tinha **22 ocorrências manuais de `rgba(0,255,247,α)`**
espalhadas pelo CSS e **20 literais hex dentro do JavaScript**. Trocar de cor
exigia caçar 42 lugares. Aqui cada acento publica o seu canal uma vez:

`~css
--ph-violet-rgb:  179 107 255;
--ph-magenta-rgb: 228  92 255;
--ph-danger-rgb:  255  46 106;
--ph-amber-rgb:   255 138  61;
--ph-ok-rgb:       53 227 155;
`~

E todo véu é derivado:

`~css
background: rgb(var(--ph-violet-rgb) / 0.15);
`~

Trocar a cor da marca passa a ser **uma linha**. O JavaScript lê os mesmos
canais de `getComputedStyle` — nunca repete um hex.

---

## 2. Tipografia

Mesma dupla do sistema anterior, mesma hierarquia.

| Família | Onde | Pesos |
|---|---|---|
| **Orbitron** | display, títulos, labels, valores, botões | 400, 700 |
| **JetBrains Mono** | corpo, tabelas, código, inputs | 400, 600 |

`~css
--ph-font-display: 'Orbitron', system-ui, sans-serif;
--ph-font-mono: 'JetBrains Mono', ui-monospace, monospace;
`~

**Escala** (px, literal — igual à anterior): 9 · 10 · 11 · 12 · 13 · 14 · 16 · 18 · 20 · 22 · 24 · 32 · 36

| Uso | Tamanho | Família | Peso | letter-spacing | transform |
|---|---|---|---|---|---|
| Badge de nav | 9 | Orbitron | 700 | 0 | — |
| Label de monitor | 10–11 | Orbitron | 400 | 1.5px | uppercase |
| Valor de card | 20–22 | Orbitron | 700 | 1px | — |
| Título de seção | 14 | Orbitron | 700 | 1px | uppercase |
| Título de página | 20 | Orbitron | 700 | 1px | uppercase |
| Logo | 22 | Orbitron | 700 | 2px | uppercase |
| Botão | 12 | Orbitron | 700 | 2px | uppercase |
| Corpo / tabela | 12–13 | JetBrains Mono | 400 | 0 | — |
| Código inline | 12 | JetBrains Mono | 400 | 0 | — |

**Regras que se mantêm:** `uppercase` em todo label, título e `th`;
`letter-spacing` de 1–2px neles; `line-height` 1.6 no corpo, 1.4 em descrições.

> Correção em relação ao sistema antigo: o CSS carregava o peso 900 do Orbitron
> sem nunca usá-lo e pedia `font-weight: 800` para uma família que não tem esse
> peso (negrito sintetizado). Aqui só se carrega **400 e 700**, e só se pede o
> que existe.

---

## 3. Espaçamento, raios, sombras

**Ritmo de 2px, escala efetiva:** 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 30 · 40.

| Contexto | Valor |
|---|---|
| Padding da sidebar | 20 |
| Padding do conteúdo | 30 |
| Padding de card | 20 |
| Padding de modal | 24 |
| Gap de grade de cards | 16 |
| Gap de navegação | 4 |

**Raios:** 4 (controles, barras) · 6 (nav, monitor) · 8 (cards, modais) · 10 (badges) · 12 (caixa de QR) · 50% (spinner).

**Sombras** — todas derivadas do canal:

`~css
--ph-glow-xs: 0 0 8px  rgb(var(--ph-violet-rgb) / .18);
--ph-glow-sm: 0 0 10px rgb(var(--ph-violet-rgb) / .22);
--ph-glow:    0 0 15px rgb(var(--ph-violet-rgb) / .30);
--ph-glow-lg: 0 0 22px rgb(var(--ph-violet-rgb) / .32);
--ph-glow-xl: 0 0 30px rgb(var(--ph-violet-rgb) / .20),
              inset 0 0 30px rgb(var(--ph-violet-rgb) / .05);
--ph-glow-danger: 0 0 15px rgb(var(--ph-danger-rgb) / .45);
--ph-elev: 0 10px 26px rgb(0 0 0 / .65);
`~

**Texto neon:** `0 0 8px currentColor` (hover/foco) · `0 0 10px, 0 0 20px` (destaque).

---

## 4. Layout

Mantido idêntico ao dashboard anterior.

- **Shell:** `display:flex; height:100vh; overflow:hidden`, `padding-top:32px` para a titlebar fixa.
- **Sidebar:** 280px fixos, fundo `--ph-surface`, `border-right`, `padding:20px`, coluna flex — logo, nav (flex:1, gap 4), monitor de sistema, controle do núcleo.
- **Conteúdo:** `flex:1; padding:30px; overflow-y:auto` — o scroll vive aqui.
- **Titlebar:** 32px, fixa, gradiente `surface-2 → surface`, `-webkit-app-region: drag`.
- **Grade de cards:** `repeat(auto-fill, minmax(220px, 1fr))`, gap 16.
- **Grade de seções:** `minmax(380px, 1fr)`, gap 12. Card largo: `grid-column: 1 / -1`.
- **Modais:** overlay `rgb(0 0 0 / .7)`, caixa `min-width:360px; max-width:600px; padding:24px`, raio 8.
- **Z-index:** 1 canvas · 2 conteúdo · 1000 modal · 2000 titlebar · 3000 dropdown.
- **Scrollbar:** 6px, trilho `--ph-bg`, thumb `--ph-border` → `--ph-violet` no hover.

**Sem `@media`** — como antes, a adaptação é fluida por `auto-fill`/`flex-wrap`.
Único acréscimo: um bloco `prefers-reduced-motion` que desliga as animações de
varredura e de chuva (o sistema antigo não tinha nenhum acesso de acessibilidade).

---

## 5. Animações

### 5.1 Os três keyframes herdados

| Nome | O que faz | Onde | Duração |
|---|---|---|---|
| `phPulse` | borda alterna âmbar ↔ violeta com glow interno | card em varredura | 1.2s ease-in-out ∞ |
| `phSpin` | rotação completa | spinner de progresso | 0.8s linear ∞ |
| `phBadge` | glow do badge de pendência 4px ↔ 14px | contador na nav | 2s ∞ |

### 5.2 Os novos, na mesma linguagem

| Nome | O que faz | Onde | Duração |
|---|---|---|---|
| `phBreathe` | opacidade 0.55 ↔ 1 e glow leve | indicador "vivo" da ponte P2P | 2.4s ease-in-out ∞ |
| `phDash` | `stroke-dashoffset` correndo | linha do túnel no mapa de transporte | 1.5s linear ∞ |
| `phRiseIn` | `translateY(8px)` + opacidade, entrada de balão | mensagem nova no chat | 0.22s ease-out |
| `phApprove` | `scaleX(0)→1` + flash violeta | confirmação de aprovação | 0.35s ease-out |
| `phReject` | tremida horizontal curta | rejeição | 0.3s ease-out |
| `phThinking` | três pontos pulsando em cascata | agente pensando | 1.1s ease-in-out ∞ |

### 5.3 Transições

`all .3s ease` em nav, cards, itens de lista · `all .2s` em botões ·
`background/color .15s` na titlebar · `border-color .3s` em inputs ·
`width .5s` em barras de gráfico · `color 1s` no valor do monitor.

### 5.4 Hover / foco / ativo

| Elemento | Repouso | Hover | Ativo |
|---|---|---|---|
| Item de nav | texto `--ph-text-dim` | fundo `--ph-surface-2` | fundo + borda + `--ph-glow-sm`, texto violeta |
| Card | borda `--ph-border` | borda violeta + glow suave | — |
| Card clicável | idem | borda **magenta** + glow magenta | — |
| Botão primário | contorno violeta, texto violeta | preenche violeta, texto `--ph-void`, `--ph-glow` | `--ph-violet-deep` |
| Botão de perigo | contorno `--ph-danger` | preenche danger, texto branco, `--ph-glow-danger` | — |
| Item de lista | — | glow + `translateY(-2px)` | — |
| Input | borda `--ph-border` | — | borda violeta + `--ph-glow-xs` |
| Texto clicável | — | `text-shadow: 0 0 8px currentColor` (instantâneo) | — |

### 5.5 A chuva de caracteres

Idêntica em comportamento à original, em violeta:

- canvas `position:absolute; inset:0; pointer-events:none`, opacidade 0.12 atrás
  do conteúdo da sidebar;
- fonte 12px monoespaçada; katakana + dígitos;
- avanço a cada 3 quadros, reset com 2.5% de chance;
- "cabeça" clara em ~8% dos glifos;
- rastro por véu `rgba(10,7,22,0.05)` por quadro — **nunca `clearRect`**, é o
  véu que cria o rastro;
- a cor do corpo **muda com o estado**: violeta em repouso, âmbar sob carga,
  `--ph-danger` em faixa crítica. O canvas lê os tokens uma vez e guarda em
  cache; não faz `getComputedStyle` por quadro.

---

## 6. Inventário de componentes

### 6.1 Compartilhados entre desktop e celular

| Componente | Desktop (CSS) | Android (Compose) |
|---|---|---|
| Superfície de card | `.ph-card` | `PhCard` |
| Botão | `.ph-btn`, `.ph-btn--danger`, `.ph-btn--ghost` | `PhButton` |
| Badge / chip | `.ph-badge`, `.ph-badge--ok/--warn/--danger` | `PhBadge` |
| Indicador de status | `.ph-status` + `.is-online/.is-offline/.is-busy` | `PhStatusDot` |
| Campo de texto | `.ph-input` | `PhTextField` |
| Cabeçalho de seção | `.ph-section-title` | `PhSectionTitle` |
| Barra de progresso | `.ph-bar` > `.ph-bar__fill` | `PhBar` |
| Estado vazio / carregando / erro | `.ph-empty`, `.ph-loading`, `.ph-error` | `PhState` |
| Chuva de caracteres | `MatrixRain` (canvas) | `PhRain` (canvas) |

### 6.2 Só no desktop

Titlebar própria (`.ph-titlebar`, `.ph-tb-btn`, `.ph-tb-menu`,
`.ph-tb-dropdown`) · monitor de sistema com canvas (`.ph-monitor` >
`.ph-monitor__row`) · tabela (`.ph-table`) · modal (`.ph-overlay` >
`.ph-modal`) · gráfico de barras manual (`.ph-chart`) · grade de cards
(`.ph-grid`).

### 6.3 Só no celular

Barra inferior (`PhBottomBar`) · balão de conversa (`PhMessageBubble`) ·
cartão de aprovação (`PhApprovalCard`) · bloco de raciocínio recolhível
(`PhReasoning`) · cartão de ferramenta (`PhToolCall`) · checklist
(`PhTodoList`) · leitor de QR (`PhQrScanner`) · seletor de sessão
(`PhSessionPicker`).

---

## 7. Telas

### 7.1 Desktop

Nav com 6 itens (mesmo padrão do sistema anterior: clique troca a classe
`is-active` e alterna `.is-hidden` nos módulos — sem router).

| # | Nav | O que mostra |
|---|---|---|
| 1 | ◆ Painel | estado da ponte e do harness, contadores, últimas sessões, dispositivos |
| 2 | ⬡ Sessões | lista de sessões vivas; abrir mostra a transcrição ao vivo |
| 3 | ⚿ Aprovações | fila de pedidos pendentes, histórico de decisões e as regras "não perguntar de novo" |
| 4 | ⇄ Transporte | modo ativo (direto/P2P), latência, caminho, intervalo de seq, gráfico de quadros |
| 5 | ▤ Dispositivos | celulares pareados, QR de pareamento, revogação |
| 6 | ⚙ Ajustes | porta da ponte, prazos, agrupamento, preferências visuais |

### 7.2 Celular

Barra inferior com 4 abas:

| Aba | O que faz |
|---|---|
| **Chat** | transcrição ao vivo, envio de prompt, cancelar turno, trocar de sessão |
| **Aprovar** | fila de aprovações, decisão com um toque, "não perguntar de novo" |
| **Frota** | sessões, estado do PC, transporte ativo |
| **Ajustes** | pareamento, transporte, prazo, limpar dados |

---

## 8. Acessibilidade — o que o sistema antigo não tinha

- `prefers-reduced-motion: reduce` desliga chuva, varredura, pulso e spinner.
- Todo controle clicável é `button` ou tem `role` + `tabindex`, com contorno de
  foco visível (`outline: 2px solid var(--ph-violet); outline-offset: 2px`).
- Contraste mínimo 4.5:1: `--ph-text` sobre `--ph-bg` dá 12.4:1;
  `--ph-text-dim` sobre `--ph-surface` dá 5.1:1. `--ph-text-mute` é decorativo.
- O **estado nunca é só cor**: cada cor de status vem acompanhada de um glifo
  (● ok, ▲ atenção, ✕ erro) e de texto.
- O canvas da chuva é `aria-hidden` e `pointer-events:none`.

---

## 9. Como os tokens chegam ao Android

`ui/theme/Color.kt` declara **exatamente** os mesmos valores hex do CSS, com os
mesmos nomes em camelCase, e `Theme.kt` os mapeia no `darkColorScheme`:

`~kotlin
val PhViolet  = Color(0xFFB36BFF)
val PhMagenta = Color(0xFFE45CFF)
val PhAmber   = Color(0xFFFF8A3D)
val PhDanger  = Color(0xFFFF2E6A)
val PhOk      = Color(0xFF35E39B)

private val PhColorScheme = darkColorScheme(
    primary = PhViolet,          onPrimary = PhVoid,
    secondary = PhMagenta,       tertiary = PhAmber,
    background = PhBg,           onBackground = PhText,
    surface = PhSurface,         onSurface = PhText,
    surfaceVariant = PhSurface2, onSurfaceVariant = PhTextDim,
    outline = PhBorder,          error = PhDanger,
)
`~

Sem `dynamicColor` e sem tema claro — mesmas decisões do sistema anterior.
