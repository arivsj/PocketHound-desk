const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1180, height: 780, show: false, webPreferences: { preload: join(__dirname, 'capture-preload.js'), contextIsolation: true } })
  await w.loadFile(join(__dirname, '..', 'src', 'renderer', 'index.html'))
  await new Promise(r => setTimeout(r, 1500))
  const report = await w.webContents.executeJavaScript(`(async () => {
    const out = [];
    for (const btn of document.querySelectorAll('.ph-nav__item')) {
      btn.click();
      await new Promise(r => setTimeout(r, 60));
      const active = document.querySelector('.ph-page.is-active');
      out.push({
        nav: btn.dataset.page,
        paginaAtiva: active ? active.id : null,
        navAtiva: document.querySelector('.ph-nav__item.is-active')?.dataset.page,
        visiveis: [...document.querySelectorAll('.ph-page.is-active *')].filter(e => e.offsetParent !== null).length,
        titulo: active?.querySelector('h1')?.textContent ?? null,
        linhasTabela: active ? active.querySelectorAll('tbody tr').length : 0,
        cards: active ? active.querySelectorAll('.ph-card').length : 0,
      });
    }
    const sheet = [...document.styleSheets].find(s => (s.href || '').includes('style.css'));
    let regras = 0; try { regras = sheet.cssRules.length } catch (e) {}
    return { paginas: out, regrasCss: regras, variavelVioleta: getComputedStyle(document.documentElement).getPropertyValue('--ph-violet').trim(), fundo: getComputedStyle(document.body).backgroundColor };
  })()`)
  console.log(JSON.stringify(report, null, 2))
  app.quit()
})
