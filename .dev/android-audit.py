"""Auditoria estática do app Android: imports mortos e consistência de idioma."""
import os
import re
import sys

raiz = sys.argv[1]
mortos = []
for dirpath, _, arquivos in os.walk(raiz):
    for nome in arquivos:
        if not nome.endswith('.kt'):
            continue
        caminho = os.path.join(dirpath, nome)
        texto = open(caminho, encoding='utf-8').read()
        linhas = texto.split('\n')
        imports, corpo, dentro = [], [], False
        for linha in linhas:
            if linha.startswith('import '):
                dentro = True
                imports.append(linha)
                continue
            if dentro and linha.strip() == '':
                continue
            dentro = False
            corpo.append(linha)
        corpo_texto = '\n'.join(corpo)
        for imp in imports:
            alvo = imp.replace('import ', '').strip()
            if alvo.endswith('.*'):
                continue
            simbolo = alvo.split('.')[-1]
            if not re.search(r'\b' + re.escape(simbolo) + r'\b', corpo_texto):
                mortos.append((os.path.relpath(caminho, raiz), alvo))

if mortos:
    for arquivo, alvo in mortos:
        print(arquivo + ': ' + alvo)
else:
    print('(nenhum import morto)')
