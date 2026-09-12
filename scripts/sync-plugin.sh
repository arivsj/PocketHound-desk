#!/usr/bin/env bash
# Sincroniza a copia do plugin do Harness que viaja neste repositorio.
#
# A FONTE DA VERDADE e o repositorio proprio do plugin:
#
#   ~/dsh-plugins/pockethound      (na maquina de desenvolvimento)
#
# Aqui dentro do desk vive uma COPIA, e ela existe por um motivo pratico: sem a
# ponte o app nao tem com quem falar, e quem clona este repositorio precisa
# conseguir usar — nao adianta mandar procurar um diretorio que so existe na
# maquina de quem escreveu.
#
#   ./scripts/sync-plugin.sh          copia a fonte para plugin/
#   ./scripts/sync-plugin.sh --check  so compara; sai com 1 se divergir
#
# PH_PLUGIN_SRC aponta para outro lugar, quando a fonte nao estiver no caminho
# padrao.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGEM="${PH_PLUGIN_SRC:-$HOME/dsh-plugins/pockethound}"
DESTINO="$RAIZ/plugin"

if [ ! -d "$ORIGEM" ]; then
  echo "nao achei a fonte do plugin em $ORIGEM" >&2
  echo "defina PH_PLUGIN_SRC=<caminho do repositorio do plugin>" >&2
  exit 2
fi

if [ ! -d "$DESTINO" ]; then
  echo "nao existe $DESTINO — rode sem --check para criar" >&2
  exit 2
fi

# node_modules nunca entra: o plugin nao tem dependencia de execucao.
if diff -r --exclude=node_modules "$ORIGEM" "$DESTINO" >/dev/null 2>&1; then
  echo "copia em dia com $ORIGEM"
  exit 0
fi

if [ "${1:-}" = "--check" ]; then
  echo "copia DIVERGENTE de $ORIGEM:" >&2
  diff -r --exclude=node_modules "$ORIGEM" "$DESTINO" | head -20 >&2
  exit 1
fi

rm -rf "$DESTINO"
cp -a "$ORIGEM" "$DESTINO"
echo "plugin sincronizado: $ORIGEM -> $DESTINO"
