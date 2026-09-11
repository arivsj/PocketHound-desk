#!/usr/bin/env python3
"""Autoteste da ponte P2P — prova o tunel ponta a ponta, sem celular.

    python3 src/transport/p2p/selftest.py

Sobe um **desk de mentira** que exige token, sobe a ponte apontando para ele, e
conecta como se fosse o celular, de verdade, por QUIC.

O teste que mais importa e o de autorizacao: **o tunel nao pode furar o token**.
Foi exatamente essa a falha do projeto anterior — o no P2P falava com a API por
127.0.0.1 e a API liberava as rotas administrativas por "vir do loopback", entao
quem tinha o ticket entrava sem token. Aqui, se atravessar o tunel bastasse para
passar, este teste falha.
"""

from __future__ import annotations

import asyncio
import json
import os
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DESK_DIR = os.path.dirname(os.path.dirname(os.path.dirname(BASE_DIR)))
sys.path.insert(0, os.path.join(DESK_DIR, "vendor"))

import iroh  # noqa: E402  (precisa vir depois do sys.path)

sys.path.insert(0, BASE_DIR)
import bridge  # noqa: E402

TOKEN = "token-de-teste-1234567890"
passou = 0
falhou = 0


def check(rotulo: str, condicao: bool, detalhe=None) -> None:
    global passou, falhou
    if condicao:
        passou += 1
        print("  ok   " + rotulo)
    else:
        falhou += 1
        print("  FALHA " + rotulo + (" :: " + json.dumps(detalhe, ensure_ascii=False) if detalhe is not None else ""))


class DeskFalso(BaseHTTPRequestHandler):
    """O minimo do desk: as MESMAS regras de autorizacao.

    /ph/ping e /ph/pair sao abertos; todo o resto exige Bearer. E a regra que o
    tunel tem de respeitar — nao a que ele pode relaxar.
    """

    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def _autorizado(self) -> bool:
        return self.headers.get("Authorization") == "Bearer " + TOKEN

    def _json(self, status: int, corpo) -> None:
        texto = json.dumps(corpo).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(texto)))
        self.end_headers()
        self.wfile.write(texto)

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/ph/ping"):
            self._json(200, {"service": "pockethound", "v": 1})
            return
        if self.path.startswith("/ph/stream"):
            if not self._autorizado():
                self._json(401, {"error": {"code": "UNAUTHORIZED"}})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            # Chunked de verdade, como o desk real (o Node faz isso sozinho).
            # Sem isto um cliente HTTP/1.1 fica esperando o corpo terminar e o
            # SSE nunca chega — o teste mediria a si mesmo, nao a ponte.
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

            def enviar(pedaco: bytes) -> None:
                self.wfile.write(b"%x\r\n" % len(pedaco) + pedaco + b"\r\n")
                self.wfile.flush()

            # Tres eventos com pausa: e a pausa que prova que o tunel ENTREGA
            # enquanto o produtor ainda produz, e nao tudo no fim.
            for indice in range(3):
                enviar(('id: %d\ndata: {"seq":%d}\n\n' % (indice, indice)).encode())
                time.sleep(0.25)
            enviar(b": fim\n\n")
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            return
        self._json(404, {"error": {"code": "NOT_FOUND"}})

    def do_POST(self):  # noqa: N802
        tamanho = int(self.headers.get("Content-Length") or 0)
        corpo = self.rfile.read(tamanho) if tamanho else b""
        if self.path.startswith("/ph/pair"):
            self._json(200, {"ok": True, "device": {"id": "abc123", "name": "celular"}, "token": TOKEN})
            return
        if not self._autorizado():
            self._json(401, {"error": {"code": "UNAUTHORIZED"}})
            return
        self._json(200, {"ok": True, "recebido": json.loads(corpo or b"{}")})


async def ler_frame(recv):
    cabecalho = await recv.read_exact(4)
    tamanho = struct.unpack(">I", bytes(cabecalho))[0]
    return json.loads(bytes(await recv.read_exact(tamanho)).decode())


async def escrever_frame(send, payload):
    blob = json.dumps(payload, separators=(",", ":")).encode()
    await send.write_all(struct.pack(">I", len(blob)) + blob)


async def pedir(endpoint, alvo, metodo, caminho, corpo=None, headers=None, query=None):
    """Um pedido pela ponte, devolvendo o frame final."""
    conn = await endpoint.connect(alvo, bridge.ALPN)
    bi = await conn.open_bi()
    await escrever_frame(bi.send(), {
        "v": 1, "method": metodo, "path": caminho,
        "headers": headers or {}, "body": corpo, "query": query or {},
    })
    frame = await ler_frame(bi.recv())
    conn.close(0, b"")
    return frame


async def _aceitar(endpoint, base: str) -> None:
    while True:
        try:
            incoming = await endpoint.accept_next()
        except Exception:
            return
        if incoming is None:
            return
        asyncio.create_task(bridge.accept_incoming(incoming, base))


async def principal() -> None:
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), DeskFalso)
    porta = servidor.server_address[1]
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    print("desk de mentira em 127.0.0.1:%d" % porta)

    bridge.RELAY_WAIT = 4.0
    chave = bridge.load_or_create_key()
    endpoint_servidor = await iroh.Endpoint.bind(
        iroh.EndpointOptions(secret_key=chave, alpns=[bridge.ALPN])
    )
    info = bridge.write_info(str(endpoint_servidor.id()), endpoint_servidor.addr())
    base = "http://127.0.0.1:%d" % porta
    asyncio.create_task(_aceitar(endpoint_servidor, base))
    await asyncio.sleep(0.4)

    endpoint_cliente = await iroh.Endpoint.bind(iroh.EndpointOptions(alpns=[bridge.ALPN]))
    alvo = iroh.EndpointTicket.from_string(info["ticket"]).endpoint_addr()

    print()
    print("tunel")
    t0 = time.monotonic()
    ping = await pedir(endpoint_cliente, alvo, "GET", "/ph/ping")
    ms = (time.monotonic() - t0) * 1000
    check("o tunel abre e responde", ping.get("status") == 200, ping)
    check("a latencia e de tunel, nao de timeout", ms < 5000, round(ms))

    print()
    print("autorizacao — o tunel NAO pode furar o token")
    sem_token = await pedir(endpoint_cliente, alvo, "POST", "/ph/frame", corpo={"type": "ping"})
    check("sem token, a ponte recebe 401", sem_token.get("status") == 401, sem_token)
    codigo = (sem_token.get("body") or {}).get("error", {}).get("code")
    check("e o 401 veio do desk, nao da ponte", codigo == "UNAUTHORIZED", sem_token.get("body"))

    com_token = await pedir(
        endpoint_cliente, alvo, "POST", "/ph/frame",
        corpo={"type": "ping"}, headers={"Authorization": "Bearer " + TOKEN},
    )
    check("com token, passa", com_token.get("status") == 200, com_token)
    recebido = (com_token.get("body") or {}).get("recebido", {}).get("type")
    check("o corpo chegou inteiro", recebido == "ping", com_token.get("body"))

    print()
    print("pareamento pelo tunel")
    pareamento = await pedir(
        endpoint_cliente, alvo, "POST", "/ph/pair",
        corpo={"code": "123456", "name": "celular de teste"},
    )
    check("o pareamento atravessa o tunel", pareamento.get("status") == 200, pareamento)
    check("e devolve o token", (pareamento.get("body") or {}).get("token") == TOKEN)

    print()
    print("streaming — o que o projeto anterior nao tinha")
    conn = await endpoint_cliente.connect(alvo, bridge.ALPN)
    bi = await conn.open_bi()
    await escrever_frame(bi.send(), {
        "v": 1, "method": "GET", "path": "/ph/stream",
        "headers": {"Authorization": "Bearer " + TOKEN}, "query": {"cursor": "0"},
    })
    recv = bi.recv()
    primeiro = await asyncio.wait_for(ler_frame(recv), timeout=10)
    check("a ponte anuncia o modo streaming", primeiro.get("streaming") is True, primeiro)

    chegada = []
    while True:
        frame = await asyncio.wait_for(ler_frame(recv), timeout=10)
        chegada.append((("evento" if "event" in frame else "fim"), time.monotonic(), frame))
        if frame.get("done"):
            break

    eventos = [item for item in chegada if item[0] == "evento"]
    dados = [item for item in eventos if str(item[2].get("event", "")).startswith("data:")]
    check("chegaram os eventos do stream", len(dados) >= 3, len(dados))
    if len(dados) >= 2:
        # A pausa entre eventos e de 250 ms no desk de mentira. Se a ponte
        # bufferizasse a resposta, a diferenca seria ~0.
        intervalo = dados[1][1] - dados[0][1]
        check("os eventos chegam ESPALHADOS, nao no fim", intervalo > 0.1, round(intervalo, 3))
    check("o ultimo frame marca o fim", chegada[-1][2].get("done") is True, chegada[-1][2])

    print()
    print("rotas")
    proibida = await pedir(endpoint_cliente, alvo, "GET", "/api/segredo")
    check("rota fora de /ph/ e recusada na ponte", proibida.get("status") == 404, proibida)
    versao = await pedir(endpoint_cliente, alvo, "GET", "/ph/ping")
    check("versao do protocolo bate", versao.get("v") == 1)

    # close() e assincrono no binding: sem o await, o aviso aparece no fim do
    # teste e o endpoint so fecha quando o processo morre.
    await endpoint_cliente.close()
    await endpoint_servidor.close()
    servidor.shutdown()

    print()
    print("%d passaram, %d falharam" % (passou, falhou))
    sys.exit(0 if falhou == 0 else 1)


if __name__ == "__main__":
    asyncio.run(principal())
