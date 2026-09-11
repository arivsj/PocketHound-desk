# PocketHound — o que já existe e o que falta

> Estado em 11/09/2026. Os três repositórios foram criados a partir da ideia dos
> dois projetos anteriores (o CyberBot de PC e o DoG CyberAgent de Android),
> mas nenhum dos dois foi modificado: são fonte de referência, não base de
> código.

---

## Onde cada coisa está

| Repositório | Caminho | Estado |
|---|---|---|
| `dsh-pockethound` | `~/dsh-plugins/pockethound` | **funcional**, instalado no harness, 26 testes passando |
| **PocketHound desk** | `/media/.../backup/dev/PocketHound desk` | **núcleo funcional**, 33 testes passando + 13 de ponta a ponta |
| **PocketHound** (Android) | `~/AndroidStudioProjects/PocketHound` | **compila, 51 testes de JVM + 1 no aparelho, APK gerado** |

---

## Fase 1 — a espinha (pronta)

Provar que a ideia central funciona de ponta a ponta, sem celular e sem P2P no
meio. É a fase que responde "dá para fazer?".

- [x] **Plugin dentro do Harness** que observa `session/event` de todas as
      sessões vivas e projeta cada evento num protocolo enxuto.
- [x] **Interceptação de `approval/request`** no waterfall, com vocabulário
      fechado (`allowed-once`/`rejected`/`cancelled`/`unavailable`) e
      **delegação quando não há celular** — o fluxo atual não muda com o app
      fechado.
- [x] **Ponte de loopback** com token efêmero, anúncio `0600` e replay por
      cursor.
- [x] **Ferramentas do agente**: `pockethound_notify` e `pockethound_ask`.
- [x] **Agrupamento de deltas** de texto (janela de 40 ms) para não inundar o
      rádio.
- [x] **Regra "não perguntar de novo"** por sessão, ferramenta e digest dos
      argumentos.
- [x] **Núcleo do desk**: store, pareamento de uso único, hash de token,
      servidor do celular com SSE e replay, presença, farol UDP de descoberta.
- [x] **Interface desktop** com a paleta violeta, chuva de caracteres e as seis
      páginas.
- [x] **Testes**: `node .dev/self-test.mjs` nos dois repositórios e
      `.dev/e2e-live.mjs` no desk, que roda **contra o harness vivo**.

**Verificado ao vivo:** o plugin está instalado no harness em execução e já
enxerga as 8 sessões reais; o desk conectou, recebeu os quadros e os repassou a
um cliente de teste autenticado.

---

## Fase 2 — o celular de verdade

O app Android **compila, roda 32 testes e gera APK**. O transporte e a sessão
existem; falta ligar as telas a eles.

- [x] **Compilar**: o JDK 21 do JetBrains Runtime do Android Studio
      (o JetBrains Runtime do Android Studio) destravou o build. Antes disso
      tudo era verificado só por leitura.
- [x] **Cliente SSE** (`core/transport/Sse.kt`): decodificador puro, testado sem
      servidor — trata batimento, concatenação de `data:` e **não perde o último
      evento** quando a conexão fecha sem a linha vazia final.
- [x] **Transporte direto** (`core/transport/Transport.kt`): Ktor para
      `POST /ph/frame`, `GET /ph/stream` e `GET /ph/ping` com Bearer em tudo.
- [x] **Cliente de sessão** (`core/session/SessionClient.kt`): reconexão com recuo
      exponencial, cursor persistido e repasso dos quadros. Um único lugar fala
      com o PC.
- [x] **Teste de contrato** (`ContractTest`): o app desserializa exatamente os
      quadros que o PC emite. **Reprovou três divergências reais** na primeira
      execução — `turn`/`step` ausentes, `version` como texto, e um
      `desk.state` com campos que não existem.
- [ ] **Ligar as telas ao `SessionClient`**: o `HoundRepository` ainda mostra
      dados de exemplo; os quadros chegam mas não alimentam a UI.
- [ ] `SecureStore` guardando o token com Tink AEAD + Keystore (a interface já
      está escrita; falta o uso).
- [ ] Leitor de QR de pareamento (`pockethound://pair?...`).
- [ ] Chat em streaming de verdade na tela de Chat, com balões por tipo de
      `turn.event` e bloco de raciocínio recolhível.
- [ ] Tela de Aprovações ligada ao `approval.request`, com os botões
      **Aprovar**, **Rejeitar** e **Não perguntar de novo**.
- [ ] Notificação local quando chega uma aprovação com o app em segundo plano
      (foreground service `dataSync`).
- [ ] Teste de contrato: os mesmos quadros de exemplo alimentando o parser do
      Android, para impedir a deriva de esquema que o projeto anterior sofreu
      (rotas chamadas pelo app que não existiam no PC, três portas diferentes em
      circulação).

---

## Fase 3 — P2P fora da LAN — **feito**

O túnel existe e está provado: `npm run p2p:selftest` sobe um desk de mentira,
a ponte e um cliente QUIC de verdade, e verifica 14 pontos, incluindo o que
importa mais — **o túnel não fura o token**.

- [x] **iroh** como transporte (QUIC + NAT traversal + relay). Mesmo caminho que
      o projeto anterior provou, agora com streaming de verdade.
- [x] **Streaming sobre QUIC**: o stream carrega vários frames, não uma resposta
      bufferizada. É o que permite chat ao vivo pelo túnel.
- [x] **Multiplexação**: uma conexão atende vários pedidos.
- [x] **Ticket em 0600** (o anterior gravava 0644, com o ticket legível).
- [x] **Identidade aborta se o modo estiver frouxo**, em vez de seguir.
- [x] **Teste de que o token governa** mesmo atravessando o túnel.
- [ ] **Publicar a lista de dispositivos** para a ponte recusar por EndpointId —
      o `refuse()` está no lugar, falta o desk alimentar a lista.
- [ ] **mDNS** para a descoberta na LAN, no lugar do farol UDP.

### Desenho original da fase (mantido para referência)

Hoje o celular só acha o PC na **mesma rede**. Fora dela não há caminho: o
projeto anterior provou que o link do usuário está atrás de **CGNAT**, então
abrir porta não resolve — tem que ser hole punching ou relay.

- [ ] Escolher e integrar o transporte. O caminho já provado neste parque é o
      **iroh** (QUIC + NAT traversal + relay), que os dois projetos anteriores já
      usaram com sucesso — binding Python no PC e AAR no Android.
- [ ] Sonda com limite curto (1,5 s) antes de cair para P2P, como o
      `TransportSelector` do projeto anterior fazia.
- [ ] Mostrar na interface **qual caminho está ativo** (direto ou relay) e a
      latência — o projeto anterior só registrava isso em log.
- [ ] **Amarrar o dispositivo à identidade criptográfica**: o token sozinho não
      basta. No projeto anterior o vínculo `EndpointId` ↔ token foi projetado e
      nunca implementado, e a autenticação prometida em três camadas virou duas.
- [ ] **Remover a confiança por IP**, que já não existe aqui por decisão de
      projeto — mas vale um teste que trave a regressão.

---

## Fase 4 — o que faz valer a pena codar do celular

- [ ] **Edição de arquivo pelo celular**: ver o diff que o agente propôs e
      aprovar por trecho, não o arquivo inteiro.
- [ ] **Aprovação por prévia**: hoje o celular recebe os argumentos da
      ferramenta; falta renderizar um diff legível em vez de JSON.
- [ ] **Múltiplas sessões**: escolher qual sessão acompanhar, e o seletor
      refletindo o que cada uma está fazendo.
- [ ] **Modo plano**: mostrar e aprovar o plano do `plan mode` do Harness pelo
      celular.
- [ ] **Metas e subagentes**: acompanhar as rodadas de um objetivo longo e a
      árvore de subagentes.
- [ ] **Enviar imagem e arquivo** do celular para o agente.
- [ ] **Voz**: ditar o prompt (o parque já tem o plugin `voice-input`, mas com
      Whisper no PC — do celular o áudio teria que subir).

---

## Fase 5 — robustez

- [x] **Contrapressão no fluxo do celular**: quando o rádio está lento, o PC
      descarta o que o próximo quadro substitui (deltas de texto, estado do PC) e
      **nunca** o que decide algo (aprovação, sessão, fim de texto, ferramenta).
      Sem isso, o buffer do socket cresce na velocidade do modelo e o celular
      consome na velocidade do rádio. O contador aparece na tela de Transporte.
- [x] **Decisão de aprovação idempotente**: o celular reenvia quando a rede cai
      no meio; reenvio da mesma decisão é sucesso, decisão contrária a uma já
      aplicada é recusada.
- [x] **`lastSeen` deixou de reescrever o disco**: o projeto anterior regravava
      o JSON inteiro de dispositivos a cada requisição autenticada. A memória é a
      verdade; o disco é atualizado no máximo a cada 30 s e no encerramento.
- [ ] **Persistência do cursor** no desk, para sobreviver a um reinício do app
      sem pedir replay completo.
- [ ] **Replay durável**: hoje o anel vive na memória do plugin e do desk. Um
      reinício do harness perde o histórico; o log da sessão no disco continua
      sendo a fonte da verdade.
- [ ] **Empacotamento**: `electron-builder` para o desk (deb/AppImage), como o
      projeto anterior tinha, e APK assinado para o Android.
- [ ] **mDNS** (`_pockethound._tcp`) no lugar do farol UDP, para redes que
      bloqueiam broadcast.
- [ ] **Cifra de ponta a ponta na aplicação** por cima do túnel, com as chaves
      trocadas no QR — para o caso de o relay ser de terceiro.
- [ ] **Teste de contrato entre os três repositórios**: um arquivo de quadros de
      exemplo que o plugin gera, o desk repassa e o Android consome, tudo no CI.
      (O arquivo já existe: `docs/fixtures.json`, gerado por
      `.dev/contract-fixtures.mjs` e reprodutível. Falta o lado Android consumi-lo.)

### Do relatório de P2P que ainda não foi feito

Itens do desenho proposto na análise do projeto anterior que ficaram de fora
desta entrega, com o motivo:

| Item | Situação |
|---|---|
| **Contrapressão por crédito** (`{t:"credit", n}`) | feito em versão mais simples: descarte do substituível em vez de janela negociada. O crédito dá controle mais fino e volta se o rádio se mostrar imprevisível |
| **Enquadramento binário** (magic `CYB1` + cabeçalho fixo) | não feito. Hoje é JSON com `seq` no envelope; o cabeçalho binário só compensa quando houver blocos binários a transportar |
| **Upload em blocos com SHA-256 e retomada por `offset`** | não feito. Sem ele, anexar arquivo pelo celular só funciona na LAN |
| **Token com TTL curto + refresh + `epoch` por dispositivo** | não feito. O token de hoje é eterno até ser revogado |
| **Revogação fechar as conexões abertas** | não feito. Revogar hoje barra a *próxima* conexão; a atual segue viva até cair |
| **Vínculo dispositivo ↔ EndpointId** | depende do P2P. Hoje só o token autoriza — que é o suficiente enquanto o caminho é HTTP direto e o token é secreto |
| **Log de replay durável** | não feito; o anel é memória. O log da sessão no disco continua sendo a fonte da verdade |
| **Contrato único gerado de um schema** | parcial: `docs/fixtures.json` é a fonte compartilhada, mas escrita à mão, não gerada |

### Duas coisas que o harness **não** deixa fazer

Descobertas na auditoria de disco, registradas para ninguém tentar implementar:

- **Não existe API de deleção de sessões.** O próprio backend diz: *"Nothing
  deletes session files — logs accumulate under root until removed externally
  (the seam has no deletion API)"*. O celular pode listar e retomar sessões,
  **nunca apagar**. Um botão "excluir" na tela de Sessões seria mentira.
- **O log em disco não é JSONL puro de um evento por linha.** O backend
  empacota runs de `assistant/chunk` em linhas `text-chunks` /
  `reasoning-chunks` / `tool-call-chunks` — um arquivo de 442 linhas físicas
  chega a `seq` 31933. Quem for fazer backfill **não pode** parsear o
  `.jsonl.zstd` na mão: use `ctx.sessionPersistence.readRaw(id)`, que
  descomprime e decodifica. O caminho em tempo real não é afetado — o firehose
  entrega cada chunk individualmente.

---

## Decisões que valem registrar

| Decisão | Por quê |
|---|---|
| O plugin **não** fala P2P | ele roda dentro do processo do harness; mantê-lo em loopback evita expor o DSH e deixa o transporte trocável sem tocar no harness |
| `inject = []` no plugin | qualquer serviço obrigatório que não exista num perfil deixa a entry pendente e o `assertEntriesActivated` **derruba o boot** |
| Um único `seq` no sistema | cair de P2P para direto não pode perder evento; com um cursor só, o replay cobre qualquer buraco |
| `seq === 0` = efêmero | quadros que nascem no PC não têm lugar na linha do tempo do harness |
| Aprovação **delega** quando não há celular | "acrescente ao lado do que já existe": com o app fechado, o comportamento é exatamente o de antes |
| Nunca confiar no IP de origem | foi a falha crítica do projeto anterior; um proxy local fazia requisição remota chegar como loopback e ganhar `/admin/*` sem token |
| Só o hash do token no disco | roubar o arquivo não dá acesso |
| `userQuestions` só se o assento estiver vago | o `registerProvider` lança se já houver provedor; a UI web do harness não pode ser deslocada |
| Paleta vinda de canais RGB | o sistema anterior repetia a cor em 42 lugares entre CSS e JS |
| Descartar delta, nunca controle | uma aprovação perdida trava a sessão; um delta de texto perdido não custa nada, porque o `text.done` seguinte consolida a mensagem inteira |
| `lastSeen` em memória com descida periódica | regravar um arquivo por mensagem não escala num protocolo de eventos |
| Decisão de aprovação idempotente | a rede móvel cai no meio do POST; sem isso o celular acha que falhou e o humano decide de novo |
| HTTP claro é risco aceito e datado | a Network Security Config não aceita faixas CIDR e o IP do PC muda por DHCP; sai na fase P2P, quando o túnel for TLS 1.3 fim a fim |
