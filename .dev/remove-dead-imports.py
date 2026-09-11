"""Remove imports mortos confirmados manualmente.

A lista e explicita de proposito: um removedor automatico apagaria
androidx.compose.runtime.getValue/setValue, que sao operadores exigidos pela
delegacao 'by remember' e parecem nao usados para qualquer heuristica de texto.
"""
import pathlib
import sys

RAIZ = pathlib.Path(sys.argv[1])

MORTOS = {
    'ui/common/PhComponents.kt': [
        'androidx.compose.ui.graphics.Shape',
        'com.pockethound.app.ui.theme.PhBorderHi',
        'com.pockethound.app.ui.theme.PhSurface3',
        'com.pockethound.app.ui.theme.PhVoid',
    ],
    'ui/chat/ChatScreen.kt': [
        'com.pockethound.app.ui.common.PhCard',
        'com.pockethound.app.ui.theme.PhBorder',
        'com.pockethound.app.ui.theme.PhMagenta',
    ],
    'ui/pairing/PairingScreen.kt': ['androidx.compose.foundation.layout.Column'],
    'ui/settings/SettingsScreen.kt': [
        'androidx.compose.foundation.layout.Column',
        'com.pockethound.app.ui.theme.PhText',
    ],
    'ui/nav/PhBottomBar.kt': ['com.pockethound.app.ui.theme.PhBg'],
    'ui/nav/PhNav.kt': ['com.pockethound.app.core.model.PhTab'],
}

total = 0
for relativo, alvos in MORTOS.items():
    caminho = RAIZ / relativo
    linhas = caminho.read_text(encoding='utf-8').splitlines()
    alvo_set = {'import ' + a for a in alvos}
    novas = [l for l in linhas if l.strip() not in alvo_set]
    removidos = len(linhas) - len(novas)
    caminho.write_text('\n'.join(novas) + '\n', encoding='utf-8')
    total += removidos
    print(relativo + ': ' + str(removidos) + ' import(s) removido(s)')

print('total: ' + str(total))
