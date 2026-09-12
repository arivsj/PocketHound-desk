# PocketHound desk

> O lado **PC** do PocketHound. Liga o **DeepSeek Harness** ao seu celular por
> P2P: transmite em tempo real tudo o que o agente produz — texto, raciocínio,
> chamadas de ferramenta, resultados — e deixa **você decidir do bolso** cada
> pedido de aprovação. Você manda o pedido pelo celular e coda de onde estiver.

```
┌──────────────────────── este app ────────────────────────┐
│                                                          │
│   DeepSeek Harness                                       │
│     │  session/event · approval/request                  │
│     ▼                                                    │
│   ┌────────────────────┐                                 │
│   │ dsh-pockethound    │  plugin (cópia em plugin/)       │
│   │ ponte loopback     │  HTTP + SSE em 127.0.0.1:P      │
│   └─────────┬──────────┘                                 │
│             │                                            │
│   ┌─────────▼──────────┐                                 │
│   │ PocketHound desk   │  ← você está aqui               │
│   │ DshLink → Transport│                                 │
│   └─────────┬──────────┘                                 │
│             │  LAN / P2P                                 │
└─────────────┼────────────────────────────────────────────┘
              │
    ┌─────────▼──────────┐
    │ PocketHound (Android) │
    └────────────────────┘
```

## Como as peças se encaixam

| Módulo | Papel |
|---|---|
| `src/dsh/link.js` | cliente da ponte do plugin: descobre o anúncio, abre o SSE, reconecta sozinho |
| `src/transport/server.js` | servidor que atende os celulares pareados; autentica por token |
| `src/core/config.js` | preferências e dispositivos; **guarda só o hash do token** |
| `src/core/desk-state.js` | retrato da máquina (CPU, RAM, temperatura, carga) |
| `src/core/protocol.js` | vocabulário dos quadros, espelho do plugin |
| `src/renderer/` | a interface — vanilla, sem framework |

O processo principal (`src/main.js`) só **liga os fios**: nenhuma regra de
protocolo mora nele.

## Rodando

### 1. O plugin do Harness — é ele que abre a ponte

Sem o plugin não existe ponte, e sem ponte o app abre e fica em *"aguardando a
ponte do Harness"*. A cópia dele viaja **dentro deste repositório**, em
`plugin/`, e a instalação é idempotente:

```bash
cd "PocketHound desk"
./plugin/install.sh
```

O que ele faz: copia o pacote para `~/.dsh/profiles/node_modules/dsh-pockethound`
e registra a entry `pockethound` em `~/.dsh/cordis.patch.yml` (camada do usuário,
então vale para todos os perfis e todos os workspaces). `--uninstall` desfaz.

**O Harness precisa reiniciar depois** — plugin só carrega no boot. A partir daí
a ponte escuta em `127.0.0.1` numa porta livre e publica o anúncio em
`~/.dsh/pockethound/bridge.json` (modo 0600, token efêmero por boot).

> `plugin/` é uma **cópia**. A fonte da verdade é o repositório próprio do plugin
> (`~/dsh-plugins/pockethound`). `./scripts/sync-plugin.sh` sincroniza e
> `./scripts/sync-plugin.sh --check` acusa divergência.

### 2. O app do PC

```bash
npm install          # baixa o Electron
npm start
```

O app encontra a ponte sozinho, lendo `~/.dsh/pockethound/bridge.json`. Se o
Harness reiniciar, o token muda e o app reconecta sem intervenção.

## Autoteste

Não precisa de Electron, celular nem Harness:

```bash
node .dev/self-test.mjs
```

Exercita o núcleo de verdade: store e preferências, pareamento de uso único,
hash de token, autenticação, revogação, servidor do celular com replay por
cursor, presença, quadros efêmeros, comandos e o coletor de estado.

## O protocolo em uma página

Todo quadro é um envelope:

```json
{ "v": 1, "seq": 1042, "ts": 1757617324113, "type": "turn.event", "session": "sess_…", "payload": {} }
```

**Existe um único `seq` no sistema inteiro.** Ele nasce no plugin, o desk
repassa 1:1 e o celular confirma com `subscribe { cursor }`. É por isso que
trocar de rede — de Wi-Fi para 4G, de direto para P2P — **não perde nada**: o
celular pede o replay e o PC reenvia o buraco.

> `seq === 0` significa **quadro efêmero**: nasce no PC
> (`desk.state`, `notice`), nunca entra no anel de replay e **nunca avança o
> cursor**. O celular precisa respeitar isso.

### PC → celular

| `type` | Quando |
|---|---|
| `hello` | ao abrir a conexão |
| `session.upsert` / `session.gone` | sessão criada, alterada ou encerrada |
| `turn.event` | **o coração** — o que o agente está produzindo |
| `approval.request` / `approval.resolved` | o Harness pediu permissão / foi decidido |
| `question.request` | o agente fez uma pergunta |
| `desk.state` | retrato da máquina (efêmero) |
| `notice` | aviso (efêmero) |
| `replay.done` | fim do replay pedido |
| `pong` | resposta a `ping` |

### `turn.event` por dentro

| `payload.kind` | O que é |
|---|---|
| `turn.start` / `turn.end` | limites do turno |
| `step.start` / `step.end` | um passo (uma chamada ao modelo) |
| `text.delta` | **texto digitando ao vivo** |
| `reasoning.delta` | raciocínio, para bloco recolhível |
| `text.done` | consolida o balão em markdown |
| `tool.call` | ferramenta pedida, com argumentos já analisados |
| `tool.result` | resultado ou erro |
| `todo.write` | checklist |
| `user.message` | o que você mandou |

Os deltas são **agrupados** numa janela de 40 ms no plugin: um quadro carrega
vários tokens, não um. Um modelo rápido emitiria 40 quadros por segundo sem
isso — e o rádio não precisa disso para desenhar a mesma frase.

### celular → PC

`hello.ack` · `subscribe` · `prompt.send` · `approval.decide` ·
`question.answer` · `session.cancel` · `session.select` · `ping`

## Endpoints do servidor do celular

| Método | Rota | Auth | O que faz |
|---|---|---|---|
| `GET` | `/ph/ping` | — | estado do serviço, sem dado sensível |
| `POST` | `/ph/pair` | — | **troca o código de 6 dígitos pelo token** |
| `GET` | `/ph/hello` | token | handshake, devolve o cursor atual |
| `GET` | `/ph/stream?cursor=N` | token | **SSE** com replay depois de `N` |
| `POST` | `/ph/frame` | token | um comando do app |

## Pareamento

1. **Dispositivos → Parear novo dispositivo**: gera um código de 6 dígitos,
   uso único, validade de 120 s.
2. O celular manda o código para `POST /ph/pair` e recebe um token.

   Essa é a **única rota aberta que devolve segredo**, e por isso a credencial é
   o próprio código — uso único, TTL curto, teto de 5 tentativas. **Não se libera
   por IP de origem**: na rede local o IP não prova nada.
3. O PC guarda **apenas o SHA-256** do token. Ele em claro existe uma única vez.
4. Revogar apaga o acesso na hora — a próxima conexão leva `401`.

## Segurança

Decisões que valem registrar, porque a falha crítica do projeto anterior estava
exatamente aqui:

- **Nunca se confia no endereço de origem.** Estar em `127.0.0.1`, na mesma
  LAN ou atrás de um proxy local **não autoriza nada**. Só o token do
  dispositivo, comparado por hash com `timingSafeEqual`, autoriza. No projeto
  anterior um proxy local fazia toda requisição remota chegar como loopback e
  ganhar acesso administrativo sem token — a rota `/admin/*` inteira ficava
  aberta para quem tivesse o ticket do nó P2P.
- **O token nunca é guardado em claro** no disco.
- **Código de pareamento é de uso único**, com teto de tentativas e TTL.
- **Toda entrada é validada**: `parseInbound` recusa tipo desconhecido,
  versão futura e não-objeto antes de qualquer efeito.
- O renderer roda com `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` e CSP restritiva (`connect-src 'none'` — a interface não
  fala com a rede, só com o processo principal por IPC).

## Identidade visual

A paleta é a mesma linguagem cyberpunk dos projetos anteriores, com o eixo
deslocado do ciano para o **violeta** (`#B36BFF`). A especificação completa —
tokens, tipografia, animações, componentes, telas — está em
[`docs/DESIGN.md`](docs/DESIGN.md), e a arquitetura em
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

Diferença estrutural em relação ao sistema antigo: **todo véu de cor é derivado
de um canal RGB**. Antes havia 22 `rgba(0,255,247,α)` escritos à mão no CSS e 20
hex repetidos dentro do JavaScript — trocar a cor da marca exigia caçar 42
lugares. Agora é uma linha.

## Transporte P2P

O celular alcança o PC **de fora da rede local** por um túnel QUIC (iroh): hole
punching quando dá, relay quando o CGNAT não deixa. Nenhuma porta é aberta.

```bash
npm run p2p:init        # cria a identidade e mostra o ticket
npm run p2p:serve       # sobe a ponte (é o que o app do PC roda)
npm run p2p:status      # endpoint, relay e endereços diretos
npm run p2p:selftest    # prova o túnel ponta a ponta, sem celular
```

O processo (`src/transport/p2p/bridge.py`) é um **proxy transparente**: dentro do
túnel vão exatamente as mesmas requisições do caminho direto, com o mesmo
`Authorization: Bearer`. Trocar de transporte não muda o que o PC vê.

A dependência nativa (iroh, ~21 MB) fica em `vendor/`, fora do Git:

```bash
pip3 install --target vendor iroh
```

### O que este túnel faz que o projeto anterior não fazia

| | Projeto anterior | PocketHound |
|---|---|---|
| **Streaming** | só request/response — um SSE seria truncado | o stream carrega **vários frames**, um por linha do SSE; o chat chega ao vivo |
| **Conexões** | uma por requisição (handshake a cada pedido) | uma conexão serve vários pedidos (multiplexação QUIC) |
| **Recusa de conexão** | `refuse()` nunca era chamado | o `Incoming` é recusável antes de ler qualquer coisa |
| **Ticket no disco** | modo `0644`, legível por qualquer usuário | modo `0600` |
| **Autorização** | a API liberava rotas por "vir do loopback"; como o nó falava por `127.0.0.1`, quem tinha o ticket entrava **sem token** | **o túnel não fura o token** — há um teste que falha se furar |

O autoteste tem um caso só para isso: manda um pedido pelo túnel **sem** Bearer e
exige `401` vindo do desk. Se a ponte algum dia passar a autorizar por conta
própria, o teste quebra.

### E isso já foi provado com um celular de verdade

Não só com o autoteste em Python: o app Android rodou num emulador, pareou pelo
caminho direto, subiu o próprio endpoint QUIC e falou com esta ponte **pelo
túnel**. A ponte registrou as três travessias:

```
[p2p] tunel -> GET /ph/ping      ← a sonda do app
[p2p] tunel -> POST /ph/frame    ← um comando de verdade
[p2p] tunel -> GET /ph/stream    ← o streaming, que o projeto anterior não tinha
```

Do outro lado, o desk registrou o pareamento e a conexão do stream. O teste é o
`P2pTunnelTest` do repositório Android — as instruções estão no README de lá.

## O que ainda não está pronto

- **mDNS.** A descoberta usa um farol UDP de broadcast; mDNS
  (`_pockethound._tcp`) seria mais limpo em redes que bloqueiam broadcast.
- **Empacotamento.** Não há `electron-builder` configurado ainda.
- **Lista de dispositivos no túnel.** O `refuse()` existe e está ligado, mas o
  desk ainda não publica a lista de endpoints autorizados — hoje quem barra é o
  token, e ele basta.
