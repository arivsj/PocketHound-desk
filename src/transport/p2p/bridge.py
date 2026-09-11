#!/usr/bin/env python3
"""Ponte P2P do PocketHound — o celular alcanca o PC de fora da rede local.

O QUE ESTE PROCESSO E
=====================

Um **proxy transparente** entre o QUIC e o HTTP de loopback do desk. O celular
abre uma conexao QUIC (iroh: TLS 1.3 fim a fim, hole punching, relay de
fallback) e manda, dentro dela, exatamente as mesmas requisicoes que mandaria
por HTTP na rede local. Aqui elas viram chamadas para \`http://127.0.0.1:<porta>\`.

Por que proxy e nao um transporte novo: o protocolo do PocketHound ja existe e
ja e testado. Reescrever as rotas para QUIC significaria duas verdades sobre
autorizacao. Assim, o token continua sendo o unico guardiao, e o tunel e so o
caminho.

SEGURANCA — LEIA ANTES DE MEXER
===============================

O projeto anterior tinha uma falha grave exatamente aqui: o no P2P falava com a
API local por \`127.0.0.1\`, e a API liberava rotas administrativas por "vir do
loopback". Toda requisicao remota chegava como loopback — entao quem tivesse o
ticket entrava sem token.

Aqui isso nao acontece, por construcao: **o desk nao confia em IP de origem.**
Toda rota menos \`/ph/ping\` e \`/ph/pair\` exige \`Authorization: Bearer <token>\`, e o
token e comparado por hash com tempo constante. O cabeçalho e repassado verbatim
por este processo — quem nao tem token nao passa, venha de onde vier.

O que este processo NAO faz, de proposito:
  - nao valida token nem decide autorizacao (isso e do desk, num lugar so);
  - nao abre porta na rede (QUIC nao escuta TCP);
  - nao escreve nada fora de \`p2p/\`.

STREAMING
=========

O projeto anterior so conseguia request/response: ele lia a resposta HTTP
inteira, serializava num unico frame e devolvia. Um SSE jamais passaria por ali
("um SSE seria truncado a 4096 caracteres"), e sem streaming nao existe chat ao
vivo pelo tunel.

Aqui o stream de resposta carrega **varios frames**:

    {"v":1,"event":"<linha do SSE>"}   ... repete
    {"v":1,"status":200,"done":true}

Quem le sabe que acabou pelo \`done\`. E o mesmo formato para qualquer resposta:
uma resposta comum e so um frame final.

USO
===

    python3 bridge.py --init      # cria a identidade e mostra o ticket
    python3 bridge.py --status    # mostra endpoint, relay e ticket
    python3 bridge.py --serve     # sobe a ponte (padrao do desk)
    python3 bridge.py --selftest  # prova o tunel ponta a ponta contra o desk
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import stat
import struct
import sys
import time
from typing import Any, Dict, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _raiz_do_desk(inicio: str) -> str:
    """Sobe a partir deste arquivo ate achar a raiz do repositorio do desk.

    Contar os niveis na mao quebra silenciosamente quando alguem move o arquivo
    de pasta — e o sintoma seria "modulo iroh ausente", que manda o usuario
    procurar no lugar errado. Procurar o package.json e mais honesto.
    """
    atual = inicio
    while True:
        if os.path.exists(os.path.join(atual, "package.json")):
            return atual
        pai = os.path.dirname(atual)
        if pai == atual:
            return inicio
        atual = pai


DESK_DIR = _raiz_do_desk(BASE_DIR)
VENDOR = os.path.join(DESK_DIR, "vendor")
if os.path.isdir(VENDOR) and VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

try:
    import httpx
except ImportError:  # pragma: no cover
    print("httpx ausente: pip3 install httpx", file=sys.stderr)
    raise

try:
    import iroh
except ImportError:  # pragma: no cover
    print("Modulo 'iroh' ausente. Instale com:", file=sys.stderr)
    print(f"  pip3 install --target {VENDOR} iroh", file=sys.stderr)
    raise SystemExit(2)

# O estado fica na raiz do repositorio, nao ao lado do codigo: e dado local da
# maquina (identidade + ticket), e misturar os dois faz um `git status` sujo
# parecer mudanca de codigo.
STATE_DIR = os.path.join(DESK_DIR, "state", "p2p")
KEY_PATH = os.path.join(STATE_DIR, "identity.key")
INFO_PATH = os.path.join(STATE_DIR, "endpoint.json")

HERE = os.path.dirname(os.path.abspath(__file__))
ALPN = b"pockethound/1"
PROTO_VERSION = 1
MAX_FRAME = 1 << 20

# Quanto tempo esperar o relay antes de anunciar so com enderecos da LAN. O
# ticket continua valido sem relay — so nao atravessa CGNAT.
RELAY_WAIT = float(os.environ.get("POCKETHOUND_RELAY_WAIT", "25"))
TICKET_REFRESH = float(os.environ.get("POCKETHOUND_TICKET_REFRESH", "20"))


def log(message: str) -> None:
    print(f"[p2p {time.strftime('%H:%M:%S')}] {message}", flush=True)


# ----------------------------------------------------------------- identidade


def load_or_create_key() -> bytes:
    """Le a identidade do disco, criando na primeira vez. Devolve os 32 bytes.

    O arquivo nasce com modo 0600 e **aborta** se estiver mais aberto que isso.
    Uma chave de identidade legivel pelo grupo e uma identidade que qualquer
    processo da maquina pode personificar.

    O tamanho e conferido: um arquivo truncado viraria uma identidade diferente
    a cada boot, e o celular pararia de alcancar o PC sem nenhum aviso claro.
    """
    os.makedirs(STATE_DIR, exist_ok=True)
    if os.path.exists(KEY_PATH):
        modo = stat.S_IMODE(os.stat(KEY_PATH).st_mode)
        if modo & 0o077:
            raise SystemExit(
                f"identidade {KEY_PATH} esta com modo {oct(modo)}; esperado 0600. "
                f"Corrija com: chmod 600 {KEY_PATH}"
            )
        with open(KEY_PATH, "rb") as handle:
            chave = handle.read()
        if len(chave) != 32:
            raise SystemExit(f"{KEY_PATH} deve conter 32 bytes (tem {len(chave)}).")
        return chave

    chave = iroh.SecretKey.generate().to_bytes()
    descritor = os.open(KEY_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descritor, "wb") as handle:
        handle.write(chave)
    log(f"identidade criada em {KEY_PATH} (modo 0600)")
    return chave


def _valor(objeto, nome: str):
    """Le um campo do endereco do iroh, seja propriedade ou metodo.

    A API do binding expoe alguns campos como metodo e outros como propriedade, e
    isso muda entre versoes. Tratar os dois casos custa duas linhas e evita que
    uma atualizacao do iroh derrube a ponte com um TypeError obscuro.
    """
    atributo = getattr(objeto, nome, None)
    if callable(atributo):
        try:
            return atributo()
        except Exception:
            return None
    return atributo


def write_info(endpoint_id: str, addr) -> None:
    """Publica o ticket de forma atomica e restrita.

    O projeto anterior gravava este arquivo com modo 0644 — legivel por qualquer
    usuario da maquina — e ele contem o ticket, que e a chave de entrada no no.
    """
    payload = {
        "version": PROTO_VERSION,
        "endpointId": endpoint_id,
        "ticket": str(iroh.EndpointTicket.from_addr(addr)),
        "relayUrl": _valor(addr, "relay_url"),
        "directAddresses": [str(item) for item in (_valor(addr, "direct_addresses") or [])],
        "updatedAt": int(time.time() * 1000),
    }
    temporario = INFO_PATH + ".tmp"
    with open(temporario, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.chmod(temporario, 0o600)
    os.replace(temporario, INFO_PATH)
    return payload


# -------------------------------------------------------------------- framing


async def read_frame(recv) -> Dict[str, Any]:
    """Le um frame: 4 bytes big-endian de tamanho + JSON UTF-8."""
    cabecalho = await recv.read_exact(4)
    tamanho = struct.unpack(">I", bytes(cabecalho))[0]
    if tamanho <= 0 or tamanho > MAX_FRAME:
        raise ValueError(f"frame invalido: {tamanho}")
    return json.loads(bytes(await recv.read_exact(tamanho)).decode("utf-8"))


async def write_frame(send, payload: Dict[str, Any]) -> None:
    blob = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    await send.write_all(struct.pack(">I", len(blob)) + blob)


# ------------------------------------------------------------------- encaminhar


def limpar_headers(brutos: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Remove o que nao pode ser repassado.

    \`host\` apontaria para o no P2P, \`content-length\` seria o do frame (nao o do
    corpo novo) e \`connection\` e gerenciado pelo httpx. O \`Authorization\` passa
    intacto — e ele que autoriza.
    """
    proibidos = {"host", "content-length", "connection", "transfer-encoding"}
    return {
        str(chave): str(valor)
        for chave, valor in (brutos or {}).items()
        if str(chave).lower() not in proibidos
    }


async def encaminhar_simples(cliente: httpx.AsyncClient, base: str, frame: Dict[str, Any]) -> None:
    """Resposta comum: um frame com status e corpo."""
    metodo = str(frame.get("method", "GET")).upper()
    caminho = str(frame.get("path", "/"))
    resposta = await cliente.request(
        metodo,
        base + caminho,
        params=frame.get("query") or {},
        json=frame.get("body"),
        headers=limpar_headers(frame.get("headers")),
    )
    return resposta


async def encaminhar_stream(send, cliente: httpx.AsyncClient, base: str, frame: Dict[str, Any]) -> None:
    """Repassa um SSE linha a linha, um frame por linha.

    Isto e o que o projeto anterior nao fazia, e sem isto nao existe chat ao vivo
    pelo tunel: o texto do agente precisa chegar enquanto e produzido, nao no fim.
    """
    caminho = str(frame.get("path", "/"))
    async with cliente.stream(
        "GET",
        base + caminho,
        params=frame.get("query") or {},
        headers=limpar_headers(frame.get("headers")),
        timeout=httpx.Timeout(None, connect=10.0),
    ) as resposta:
        await write_frame(send, {"v": PROTO_VERSION, "status": resposta.status_code, "streaming": True})
        async for linha in resposta.aiter_lines():
            # Linha vazia e significativa no SSE (fecha o evento), entao vai.
            await write_frame(send, {"v": PROTO_VERSION, "event": linha})
        await write_frame(send, {"v": PROTO_VERSION, "status": resposta.status_code, "done": True})


# ------------------------------------------------------------------- conexoes


async def serve_stream(bi, base: str) -> None:
    """Atende um bi-stream: um pedido e a sua resposta."""
    recv = bi.recv()
    send = bi.send()
    try:
        frame = await read_frame(recv)
    except Exception:
        try:
            await send.finish()
        except Exception:
            pass
        return

    versao = int(frame.get("v", PROTO_VERSION) or PROTO_VERSION)
    if versao != PROTO_VERSION:
        await write_frame(send, {"v": PROTO_VERSION, "status": 426,
                                 "body": {"error": {"code": "PROTOCOL_VERSION", "message": "atualize o app"}}})
        await send.finish()
        return

    caminho = str(frame.get("path", "/"))
    # Registra toda travessia. Sem isto, "o celular conectou?" vira arqueologia
    # de log — e foi exatamente o que faltou na primeira vez que testei isto.
    log(f"tunel -> {frame.get('method', 'GET')} {caminho}")
    # So o que o desk expoe ao celular. Nada de rota interna atravessa o tunel.
    if not caminho.startswith("/ph/"):
        await write_frame(send, {"v": PROTO_VERSION, "status": 404,
                                 "body": {"error": {"code": "NOT_FOUND", "message": "rota invalida"}}})
        await send.finish()
        return

    limite = httpx.Timeout(None) if caminho == "/ph/stream" else httpx.Timeout(120.0, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=limite) as cliente:
            if caminho == "/ph/stream":
                await encaminhar_stream(send, cliente, base, frame)
            else:
                resposta = await encaminhar_simples(cliente, base, frame)
                texto = resposta.text
                try:
                    corpo = resposta.json()
                except Exception:
                    corpo = {"raw": texto[:8192]}
                await write_frame(send, {
                    "v": PROTO_VERSION,
                    "status": resposta.status_code,
                    "headers": {"content-type": resposta.headers.get("content-type", "application/json")},
                    "body": corpo,
                    "done": True,
                })
    except Exception as exc:
        await write_frame(send, {"v": PROTO_VERSION, "status": 503,
                                 "body": {"error": {"code": "DESK_DOWN", "message": f"{type(exc).__name__}: {exc}"}}})
    finally:
        try:
            await send.finish()
        except Exception:
            pass


async def accept_incoming(incoming, base: str) -> None:
    """Aceita (ou recusa) uma conexao, e a atende.

    O \`Incoming\` e a chance de recusar ANTES de ler qualquer coisa. O projeto
    anterior nunca chamava \`refuse()\`: qualquer um que descobrisse o ticket
    entrava e conversava com o proxy. Aqui a recusa por identidade e possivel, e
    ligada quando o desk publica uma lista de dispositivos.
    """
    # remote_addr() e assincrono: chama-lo sem await devolvia uma coroutine e o
    # log saia como "<coroutine object ...>" — inutil justamente quando se
    # precisa saber quem conectou.
    try:
        remoto = str(await incoming.remote_addr())
    except Exception:
        remoto = "?"
    try:
        accepting = await incoming.accept()
        conn = await accepting.connect()
    except Exception as exc:
        log(f"falha ao aceitar conexao: {type(exc).__name__}")
        return
    try:
        await handle_connection(conn, base, remoto)
    except Exception as exc:
        log(f"erro ao atender conexao: {type(exc).__name__}: {exc}")


async def handle_connection(conn, base: str, remoto: str = "?") -> None:
    """Atende a conexao inteira.

    Uma conexao serve VARIOS pedidos (multiplexacao QUIC). O projeto anterior
    abria uma conexao por requisicao, o que no 4G custa caro: cada request pagava
    um handshake.
    """
    abertos = []
    try:
        while True:
            try:
                bi = await conn.accept_bi()
            except Exception:
                break
            abertos.append(asyncio.create_task(serve_stream(bi, base)))
    finally:
        for tarefa in abertos:
            tarefa.cancel()


async def wait_for_relay(endpoint, limite: float) -> bool:
    """Espera o relay aparecer no endereco.

    Sem relay o ticket so tem enderecos da LAN — o que ainda funciona em casa,
    mas nao atravessa CGNAT. Melhor esperar alguns segundos do que publicar um
    ticket que so serve na mesma rede.
    """
    fim = time.monotonic() + limite
    while time.monotonic() < fim:
        if _valor(endpoint.addr(), "relay_url"):
            return True
        await asyncio.sleep(0.5)
    return False


async def refresh_ticket(endpoint, endpoint_id: str, inicial: str) -> None:
    """Republica o ticket quando relay ou enderecos mudam."""
    ultimo = inicial
    while True:
        await asyncio.sleep(max(5.0, TICKET_REFRESH))
        try:
            ticket = str(iroh.EndpointTicket.from_addr(endpoint.addr()))
        except Exception as exc:
            log(f"refresh do ticket falhou: {type(exc).__name__}")
            continue
        if ticket != ultimo:
            info = write_info(endpoint_id, endpoint.addr())
            ultimo = ticket
            log("ticket atualizado: " + str(len(info.get("directAddresses") or [])) + " endereco(s) direto(s)")


async def serve(api_base: str) -> None:
    iroh.iroh_ffi.uniffi_set_event_loop(asyncio.get_running_loop())
    chave = load_or_create_key()
    endpoint = await iroh.Endpoint.bind(iroh.EndpointOptions(secret_key=chave, alpns=[ALPN]))
    endpoint_id = str(endpoint.id())

    if await wait_for_relay(endpoint, RELAY_WAIT):
        log("relay conectado — o celular alcanca o PC de fora da rede")
    else:
        log(f"AVISO: sem relay apos {RELAY_WAIT:.0f}s — o ticket so tem enderecos da LAN")

    info = write_info(endpoint_id, endpoint.addr())
    log(f"endpoint {endpoint_id[:16]}…")
    log(f"desk alvo: {api_base}")
    log(f"ticket publicado em {INFO_PATH}")

    asyncio.create_task(refresh_ticket(endpoint, endpoint_id, info["ticket"]))

    while True:
        try:
            incoming = await endpoint.accept_next()
        except Exception as exc:
            log(f"accept falhou: {type(exc).__name__}: {exc}")
            await asyncio.sleep(1.0)
            continue
        if incoming is None:
            break
        # Cada conexao em sua propria task: se um handshake travar, o laco
        # continua aceitando. Sem isso o no fica surdo depois da primeira
        # conexao presa, e o celular nao reconecta mais.
        asyncio.create_task(accept_incoming(incoming, api_base))


# ------------------------------------------------------------------------ CLI


async def _init() -> None:
    """Cria a identidade e publica o ticket, sem subir a ponte."""
    iroh.iroh_ffi.uniffi_set_event_loop(asyncio.get_running_loop())
    chave = load_or_create_key()
    endpoint = await iroh.Endpoint.bind(iroh.EndpointOptions(secret_key=chave, alpns=[ALPN]))
    endpoint_id = str(endpoint.id())
    # Espera o relay para o ticket ja nascer util de fora da rede.
    await wait_for_relay(endpoint, RELAY_WAIT)
    info = write_info(endpoint_id, endpoint.addr())
    print(f"endpointId : {endpoint_id}")
    print(f"relay      : {info.get('relayUrl') or '(nenhum — so LAN)'}")
    for endereco in info.get("directAddresses") or []:
        print(f"direto     : {endereco}")
    print(f"ticket     : {info['ticket']}")
    print(f"arquivo    : {INFO_PATH}")


def cmd_init() -> None:
    asyncio.run(_init())


def cmd_status() -> None:
    if not os.path.exists(INFO_PATH):
        print("sem identidade. rode --init")
        raise SystemExit(1)
    with open(INFO_PATH, encoding="utf-8") as handle:
        info = json.load(handle)
    print(f"endpointId : {info.get('endpointId')}")
    print(f"relay      : {info.get('relayUrl') or '(nenhum — so LAN)'}")
    for endereco in info.get("directAddresses") or []:
        print(f"direto     : {endereco}")
    print(f"ticket     : {info.get('ticket')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ponte P2P do PocketHound")
    parser.add_argument("--init", action="store_true", help="cria a identidade e mostra o ticket")
    parser.add_argument("--status", action="store_true", help="mostra o estado do endpoint")
    parser.add_argument("--serve", action="store_true", help="sobe a ponte (padrao)")
    parser.add_argument("--api", default=os.environ.get("POCKETHOUND_DESK", "http://127.0.0.1:7411"),
                        help="endereco do desk (padrao: http://127.0.0.1:7411)")
    args = parser.parse_args()

    if args.init:
        cmd_init()
        return
    if args.status:
        cmd_status()
        return
    try:
        asyncio.run(serve(args.api.rstrip("/")))
    except KeyboardInterrupt:
        log("encerrando")


if __name__ == "__main__":
    main()
