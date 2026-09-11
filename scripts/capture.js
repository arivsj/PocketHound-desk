/**
 * Captura de tela da interface — só para desenvolvimento.
 *
 *   xvfb-run -a npx electron scripts/capture.js
 *
 * Abre a janela real, espera a chuva desenhar alguns quadros e salva um PNG em
 * `.shots/`. Serve para revisar o visual sem depender de olhar a tela.
 *
 * @module pockethound-desk/capture
 */

'use strict'

const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/** Nome da página a capturar, vindo de `--page=nome`. */
const pageArgument = process.argv.find((value) => value.startsWith('--page='))
const page = pageArgument ? pageArgument.split('=')[1] : 'painel'

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    show: false,
    backgroundColor: '#0A0716',
    webPreferences: {
      preload: join(__dirname, 'capture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await window.loadFile(join(__dirname, '..', 'src', 'renderer', 'index.html'))
  // A chuva precisa de alguns quadros para o rastro aparecer.
  await new Promise((resolve) => setTimeout(resolve, 1400))

  if (page !== 'painel') {
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-page=\"" + page + "\"]').click(); true",
    )
    await new Promise((resolve) => setTimeout(resolve, 700))
  }

  const image = await window.webContents.capturePage()
  const directory = join(__dirname, '..', '.shots')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, page + '.png')
  writeFileSync(file, image.toPNG())
  process.stdout.write('captura salva em ' + file + '\n')
  app.quit()
})
