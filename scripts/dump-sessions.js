const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1180, height: 780, show: false, webPreferences: { preload: join(__dirname, 'capture-preload.js'), contextIsolation: true } })
  await w.loadFile(join(__dirname, '..', 'src', 'renderer', 'index.html'))
  await new Promise(r => setTimeout(r, 1600))
  const out = await w.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-page="sessoes"]').click();
    const cartoes = [...document.querySelectorAll('#sessionList .ph-list__item')];
    return JSON.stringify({
      ativa: document.querySelector('.ph-page.is-active').id,
      cartoes: cartoes.map(c => ({
        titulo: c.querySelector('.ph-list__title').textContent,
        meta: c.querySelector('.ph-list__meta').textContent,
        selo: c.querySelector('.ph-badge').textContent,
        temBotaoLog: Boolean(c.querySelector('[data-reveal]')),
      })),
    }, null, 2)
  })()`)
  console.log(out)
  app.quit()
})
