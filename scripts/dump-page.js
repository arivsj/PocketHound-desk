const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1180, height: 780, show: false, webPreferences: { preload: join(__dirname, 'capture-preload.js'), contextIsolation: true } })
  await w.loadFile(join(__dirname, '..', 'src', 'renderer', 'index.html'))
  await new Promise(r => setTimeout(r, 1600))
  const text = await w.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-page="aprovacoes"]').click();
    const page = document.getElementById('page-aprovacoes');
    const card = page.querySelector('.ph-approval');
    return JSON.stringify({
      ativa: document.querySelector('.ph-page.is-active').id,
      titulo: page.querySelector('h1').textContent,
      cartaoDestacado: card ? card.querySelector('.ph-approval__tool').textContent : null,
      prazo: card ? card.querySelector('.ph-badge').textContent : null,
      argumentos: card ? card.querySelector('.ph-approval__pre').textContent : null,
      secoes: [...page.querySelectorAll('.ph-section-title')].map(e => e.textContent),
      historico: [...page.querySelectorAll('#historyRows tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join(' | ')),
      regras: [...page.querySelectorAll('#ruleList .ph-list__item')].map(e => e.textContent.trim()),
      badge: document.getElementById('navBadge').textContent,
    }, null, 2)
  })()`)
  console.log(text)
  app.quit()
})
