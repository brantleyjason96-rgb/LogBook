// Screenshots every screen of the mockup. Usage: node tools/shoot.js   (from android/design/margin)
// Needs Playwright with Chromium. Writes PNGs to screens/ and prints console errors and clipped text.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'screens');
const url = 'file://' + path.join(root, 'index.html');

const SCREENS = [
  ['01-feed', 'feed'], ['01-feed-empty', 'feed?state=empty'], ['01-feed-offline', 'feed', 'offline'], ['01-feed-waiting', 'feed', 'waiting'],
  ['02-feed-people', 'feed?filter=people'], ['03-feed-things', 'feed?filter=things'], ['03-feed-thoughts', 'feed?filter=thoughts'],
  ['03-feed-places', 'feed?filter=places'], ['03-feed-loops', 'feed?filter=loops'],
  ['04-search-empty', 'search'], ['04-search-results', 'search?q=rubric'], ['04-search-none', 'search?q=zebra'],
  ['05-nudges', 'nudges'], ['05-nudges-empty', 'nudges?state=empty'],
  ['06-speed-dial', 'capture'],
  ['07-capture-met', 'capture/met'], ['07-capture-met-filled', 'capture/met?demo=1'], ['07-capture-met-keyboard', 'capture/met?demo=1&kb=1'], ['07-capture-met-offline', 'capture/met?demo=1', 'offline'],
  ['08-capture-thought', 'capture/note'], ['08-capture-went', 'capture/any'], ['08-capture-media', 'capture/media'],
  ['08-capture-media-results', 'capture/media?q=past'], ['08-capture-media-nokey', 'capture/media?state=nokey&q=past'],
  ['08-capture-media-noresults', 'capture/media?q=zzz'], ['08-capture-media-offline', 'capture/media?q=past', 'offline'], ['08-capture-rate', 'capture/media/rate'],
  ['09-person', 'person/n:dr-okafor'], ['09-person-on-track', 'person/n:maria-alvarez'],
  ['10-item', 'item/b:braiding-sweetgrass'], ['10-item-unrated', 'item/t:severance'],
  ['11-review', 'review'],
  ['12-today', 'today/2026-11-13'], ['12-today-picker', 'today/2026-11-13?pick=1'], ['12-today-empty', 'today/2026-11-09'],
  ['13-account', 'account'], ['13-account-offline', 'account', 'offline'], ['13-account-wrongkey', 'account', 'wrongkey'],
  ['13-settings', 'settings'], ['13-settings-wrongkey', 'settings', 'wrongkey'], ['13-settings-oldscript', 'settings', 'oldscript'],
  ['13-reminders', 'settings/reminders'], ['13-connect', 'connect', 'none'], ['13-connect-paste', 'connect?paste=1', 'none'], ['13-connect-oldscript', 'connect', 'oldscript'],
  ['14-notification', 'outside/notification'], ['14-widget', 'outside/widget'], ['14-shortcuts', 'outside/shortcuts']
];
const SIZES = [['360', 360, 800], ['411', 411, 914]];
const BIG = [['01-feed', 'feed'], ['09-person', 'person/n:dr-okafor'], ['07-capture-met-filled', 'capture/met?demo=1']];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const problems = [];
  async function shot(name, route, o) {
    const page = await browser.newPage({ viewport: { width: o.w, height: o.h }, colorScheme: o.theme });
    page.on('console', m => { if (m.type() === 'error') problems.push(name + ': console ' + m.text()); });
    page.on('pageerror', e => problems.push(name + ': ' + e.message));
    const q = new URLSearchParams({ bare: '1', theme: o.theme, sync: o.sync || 'synced', fs: String(o.fs || 1), device: o.device });
    await page.goto(url + '?' + q + '#' + route);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    // text that is cut off: an element whose content is wider than its box and hides the overflow
    const clipped = await page.evaluate(() => [...document.querySelectorAll('#stage *')].filter(el => {
      if (el.closest('.kb, .fch, svg, .status') || !el.childNodes.length) return false;
      const cs = getComputedStyle(el);
      return el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && el.clientWidth > 0;
    }).map(el => el.className + ' "' + el.textContent.trim().slice(0, 40) + '"'));
    clipped.forEach(c => problems.push(name + ': clipped ' + c));
    const wide = await page.evaluate(() => { const s = document.querySelector('#scr, #gal'); return [...s.querySelectorAll('*')].filter(el => !el.closest('.fch, .kb') && el.getBoundingClientRect().right > s.getBoundingClientRect().right + 1 && el.getBoundingClientRect().width > 0).map(el => el.className + ' "' + el.textContent.trim().slice(0, 30) + '"').slice(0, 3); });
    wide.forEach(c => problems.push(name + ': past the right edge ' + c));
    await (o.full ? page.screenshot({ path: path.join(out, name + '.png'), fullPage: true }) : page.locator('#scr').screenshot({ path: path.join(out, name + '.png') }));
    await page.close();
  }
  for (const theme of ['light', 'dark']) {
    for (const [sn, w, h] of SIZES) for (const [name, route, sync] of SCREENS) await shot(`${name}_${sn}_${theme}`, route, { w, h, theme, sync, device: sn });
    for (const [name, route] of BIG) await shot(`${name}_360_font200_${theme}`, route, { w: 360, h: 800, theme, fs: 2, device: '360' });
    await shot(`15-tablet-feed-person_${theme}`, 'person/n:dr-okafor', { w: 1024, h: 720, theme, device: 'tablet' });
    await shot(`00-components_${theme}`, 'components', { w: 1040, h: 900, theme, device: '360', full: true });
  }
  await browser.close();
  console.log(fs.readdirSync(out).length + ' screenshots in screens/');
  console.log(problems.length ? 'PROBLEMS\n' + [...new Set(problems)].join('\n') : 'No console errors, no clipped text, nothing past the right edge.');
})();
