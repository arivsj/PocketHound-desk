# PocketHound — Arquitetura

> **PocketHound** é um par de aplicativos que transforma o DeepSeek Harness (DSH) em algo
> operável do bolso: o celular manda o pedido, o PC executa no Harness, e **tudo o que o
> Harness pensa, escreve e pede volta para o celular em tempo real** — inclusive os
> **pedidos de aprovação**, que você decide de onde estiver.

Repositórios:

| Repositório | Caminho | Papel |
|---|---|---|
| [`dsh-plugins`](https://github.com/arivsj/dsh-plugins) | `~/dsh-plugins` | **dependência**: os plugins do Harness que fazem este app funcionar |
| ├─ `pockethound` | `~/dsh-plugins/pockethound` | Plugin do DSH: observa a sessão, expõe a ponte interna (**obrigatório**) |
| └─ `session-cost` | `~/dsh-plugins/session-cost` | Gasto da sessão em US$ e contexto (opcional: sem ele o rodapé não mostra o valor) |
| **PocketHound desk** | `/media/.../backup/dev/PocketHound desk` | App do PC: núcleo, P2P, UI desktop |
| **PocketHound** | `~/AndroidStudioProjects/PocketHound` | App Android: controle e aprovação |

Para instalar as dependências de uma vez: `cd ~/dsh-plugins && ./install-all.sh`, e
depois **reiniciar o Harness** (plugin só carrega no boot).

```
┌──────────────────────── PC ─────────────────────────┐
│                                                      │
│   DSH (dsh web / headless)                           │
│     │  session/event · approval/request              │
│     ▼                                                │
│   ┌──────────────────────┐                           │
│   │ dsh-pockethound      │  plugin host              │
│   │  • observa sessões   │                           │
│   │  • intercepta aprovações                         │
│   │  • ponte loopback    │  HTTP + SSE 127.0.0.1:P   │
│   └──────────┬───────────┘                           │
│              │                                       │
│   ┌──────────▼───────────┐                           │
│   │ PocketHound desk     │  Electron                 │
│   │  DshLink ─► Hub ─► Transport                      │
│   │  (cursor, replay, aprovações pendentes)           │
│   └──────────┬───────────┘                           │
│              │  P2P (QUIC/iroh + relay)              │
└──────────────┼───────────────────────────────────────┘
               │
   ┌───────────▼────────────┐
   │ PocketHound (Android)  │
   │  • chat em streaming   │
   │  • aprovar / rejeitar  │
   │  • codar pelo celular  │
   └────────────────────────┘
```

---

## 1. Por que o plugin não fala P2P

O plugin roda **dentro do processo do DSH**. Ele deve ser leve, previsível e não pode
depender de serviços que só existem em alguns perfis. Por isso ele:

- **não** abre porta na rede — só escuta em `127.0.0.1`;
- **não** conhece celular, QR code nem relay;
- **não** tem estado durável próprio além de um arquivo de anúncio.

Quem fala P2P é o **PocketHound desk**. Essa separação dá três coisas: o plugin pode
ser testado sem celular, o transporte pode ser trocado sem tocar no DSH, e o DSH
nunca fica exposto se o app do PC estiver fechado.

## 2. Descoberta da ponte

O plugin escreve, no boot, um arquivo de anúncio:

`~/.dsh/pockethound/bridge.json`
``json
{
  "version": 1,
  "pid": 41230,
  "port": 45517,
  "token": "32 bytes em hex",
  "startedAt": "2026-09-11T18:22:04.113Z",
  "harness": "0.1.0-rc.7"
}
```

O app do PC lê esse arquivo, conecta em `http://127.0.0.1:<port>` com
`Authorization: Bearer <token>` e mantém o SSE aberto. Se o arquivo sumir ou o
`pid` morrer, a ponte caiu — o app reconecta em laço. O `token` é regenerado a cada
boot do DSH e o arquivo é escrito com permissão `0600`.

## 3. A ponte (API interna do plugin)

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/health` | versão, pid, contadores, nº de sessões vivas |
| `GET` | `/sessions` | lista de sessões vivas (id, título, workspace, status) |
| `GET` | `/stream` | **SSE** — todo o fluxo: eventos de sessão, aprovações, estado |
| `POST` | `/prompt` | `{ sessionId, text, mode: 'followup'\|'steer' }` → injeta mensagem do usuário |
| `POST` | `/approval` | `{ requestId, outcome, remember? }` → resolve uma aprovação pendente |
| `POST` | `/cancel` | `{ sessionId, cause }` → cancela o turno ativo |
| `GET` | `/pending` | aprovações pendentes agora (para reconstruir estado ao reconectar) |

## 4. Quadros do protocolo PocketHound

Todo quadro é um objeto JSON, sempre com o mesmo envelope:

``json
{
  "v": 1,
  "seq": 1042,
  "ts": 1757617324113,
  "type": "turn.event",
  "session": "sess_01J8…",
  "payload": { }
}
```

`seq` é **monotônico por PC** (não por sessão). É a espinha do *replay*: ao reconectar,
o celular manda o último `seq` que processou e o PC reenvia tudo o que veio depois.

### PC → celular

| `type` | Quando | `payload` |
|---|---|---|
| `hello` | ao abrir a conexão | `{ name, version, sessions[], cursorMax }` |
| `session.upsert` | sessão criada/alterada | `{ id, title, workspace, status }` |
| `session.gone` | sessão encerrada | `{ id }` |
| `turn.event` | **o coração** — cada evento da sessão | `{ kind, … }` (ver §5) |
| `approval.request` | o Harness pediu permissão | `{ requestId, toolName, callId, reason, args, expiresAt }` |
| `approval.resolved` | decisão tomada (por qualquer canal) | `{ requestId, outcome }` |
| `desk.state` | a cada 2 s | `{ cpu, mem, gpu, temp, load, uptime }` |
| `notice` | aviso do app | `{ level, title, body }` |
| `pong` | resposta a `ping` | `{ echo }` |

### celular → PC

| `type` | `payload` |
|---|---|
| `hello.ack` | `{ deviceName, deviceId, lastSeq }` |
| `subscribe` | `{ cursor }` — reenvie tudo depois deste `seq` |
| `prompt.send` | `{ sessionId, text, mode }` |
| `approval.decide` | `{ requestId, outcome: 'allowed-once'\|'rejected', remember? }` |
| `session.cancel` | `{ sessionId }` |
| `session.select` | `{ sessionId }` — qual sessão a UI do celular está olhando |
| `ping` | `{ echo }` |

## 5. `turn.event` — o que o Harness está produzindo

Cada `turn.event` é a projeção, para o celular, de um evento real do log do DSH:

| `payload.kind` | Origem no DSH | Vai para a tela como |
|---|---|---|
| `turn.start` / `turn.end` | `turn/start`, `turn/end` | separador de turno |
| `step.start` | `step/start` | marcador "pensando" |
| `text.delta` | `assistant/chunk` com `text-delta` | **texto digitando ao vivo** |
| `reasoning.delta` | `assistant/chunk` com `reasoning-delta` | bloco "raciocínio" recolhível |
| `text.done` | `assistant/message` | consolida o balão (markdown) |
| `tool.call` | `tool/call` | card da ferramenta + argumentos |
| `tool.result` | `tool/result` | card com resultado/erro |
| `todo.write` | `todo/write` | checklist |
| `user.message` | `user/message` | o que você mandou |

Os deltas são **coalescidos** na ponte (janela de ~40 ms) para não inundar o rádio:
um quadro de delta carrega vários tokens, não um.

## 6. O caminho de uma aprovação

Este é o fluxo que justifica o projeto inteiro.

```
DSU host                    plugin                desk                 celular
  │                            │                    │                     │
  │ approval/request           │                    │                     │
  ├───────────────────────────►│                    │                     │
  │        (waterfall)         │  approval.request  │                     │
  │                            ├───────────────────►│  approval.request   │
  │                            │                    ├────────────────────►│
  │                            │                    │                     │
  │                            │                    │   approval.decide   │
  │                            │                    │◄────────────────────┤
  │                            │  outcome           │                     │
  │                            │◄───────────────────┤                     │
  │  'allowed-once'            │                    │                     │
  │◄───────────────────────────┤                    │                     │
```

Detalhes que importam:

- O plugin entra no **waterfall** `approval/request`. Se **nenhum celular estiver
  conectado**, ele chama `next()` e a decisão segue para o respondente normal
  (terminal/GUI). **Nada do fluxo atual muda quando o app está fechado.**
- O plugin tem um `timeout` (padrão **90 s**). No estouro, ele chama `next()` — nunca
  deixa a sessão travada.
- `abort` do `req.signal` (o turno foi cancelado) retira a pergunta do celular na hora.
- `remember: true` grava uma regra no desk (`toolName` + digest dos argumentos) que
  responde sozinha as próximas iguais **naquela sessão**. É o que torna "codar pelo
  celular" suportável: você aprova `bash` uma vez e segue.
- O resultado sempre é um dos quatro do vocabulário fechado do DSH:
  `allowed-once`, `rejected`, `cancelled`, `unavailable`.

## 7. Transporte P2P

O `Transport` é uma interface, com implementações selecionadas automaticamente:

| Modo | Quando | Como |
|---|---|---|
| `DIRECT` | mesmo Wi-Fi/LAN ou tailnet | HTTP + SSE direto em `http://<ip>:<porta>` |
| `P2P` | redes diferentes, CGNAT | QUIC (iroh): hole punching, relay quando não dá |
| `AUTO` (padrão) | sempre | sonda o direto com 1,5 s de limite; cai para P2P |

Regra de ouro herdada do projeto anterior e mantida aqui: **transporte seguro não é
autorização**. O canal protege o caminho; o *handshake* com token protege o comando.
Toda conexão — direta ou P2P — passa pelo mesmo `hello`/token e pelas mesmas regras.

Independência de evento: como todo quadro carrega `seq`, cair de P2P para direto (ou
trocar de rede) **não perde nada** — o celular manda `subscribe { cursor }` e o PC
reenvia o buraco.

## 8. Pareamento

1. No PC: **Parear novo dispositivo** → gera um código de 6 dígitos (TTL 120 s) e um QR.
2. O QR carrega `{ v, name, nodeId, addrs[], token, expiresAt }` assinado com a chave
   do desk. A tela do QR é `FLAG_SECURE` no Android.
3. O celular lê, guarda o token no armazenamento seguro (Tink/Keystore) e faz `hello`.
4. O PC lista o dispositivo. Revogar = apagar o token do lado do PC (o celular recebe
   `401` na próxima mensagem e volta para a tela de pareamento).

## 9. Ferramentas que o agente ganha

O plugin registra duas ferramentas para o agente **poder falar com você**:

| Ferramenta | Para quê |
|---|---|
| `pockethound_notify` | manda uma notificação no celular (tarefa longa terminou, build quebrou) |
| `pockethound_ask` | faz uma pergunta com opções e **espera a resposta do celular** |

É o inverso do fluxo de aprovação: em vez de o Harness pedir permissão, ele pede
**opinião**.

## 10. Herança dos dois repositórios

| Veio de | O que foi aproveitado |
|---|---|
| `Dog Assistent` (PC) | o vocabulário visual cyberpunk do dashboard Electron; a ideia de um `blueprint` de bridge com token próprio e rotas `/api/m/*`; o monitor de sistema na sidebar; o padrão de log de acesso |
| `Dog Assistent` (docs P2P) | a conclusão de que CGNAT exige hole punching ou relay; a regra "transporte ≠ autorização"; a interface `Transport` com `AUTO` e sonda com timeout |
| `DoGCyberAgent` (Android) | a arquitetura Kotlin/Compose + Hilt + Ktor + DataStore; a navegação `Nav` + `BottomBar` + `RootViewModel`; o pareamento por QR; as animações de matriz/glifo que dão a identidade visual |

O que **não** veio: o Telegram como transporte (o DSH já é o canal), o Flask como
backend (o plugin é Node, dentro do DSH) e o acoplamento a `/api/m/*` (o protocolo
aqui é orientado a eventos, não a comandos).

## 11. Identidade visual

A paleta cyberpunk dos dois apps anteriores era **ciano** (`#00FFF7`). O PocketHound
usa a mesma linguagem — fundo quase preto, neon, glow, grade, tipografia técnica — com
o eixo deslocado para **violeta** (`#B36BFF`). A especificação completa dos tokens,
componentes e animações está em [`DESIGN.md`](./DESIGN.md).
