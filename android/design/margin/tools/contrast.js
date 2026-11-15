// WCAG contrast check for the Margin tokens. Usage: node tools/contrast.js
const T = require('../DESIGN_TOKENS.json');
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const parse = c => { const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(c); return m ? { rgb: [+m[1], +m[2], +m[3]], a: +m[4] } : { rgb: hex(c), a: 1 }; };
const over = (fg, bg) => { const f = parse(fg), b = parse(bg).rgb; return f.rgb.map((v, i) => v * f.a + b[i] * (1 - f.a)); };
const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const rows = [];
for (const mode of ['light', 'dark']) {
  const c = T.color[mode], k = T.color.kindTiles[mode];
  const pair = (name, fg, bg, need) => { const bgc = over(bg, c.page), r = ratio(over(fg, '#' + bgc.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')), bgc); rows.push([mode, name, r.toFixed(2), need, r >= need ? 'pass' : 'FAIL']); };
  for (const bg of ['page', 'panel']) {
    for (const fg of ['ink', 'ink2', 'mute', 'cobalt', 'coral', 'warn']) pair(fg + ' on ' + bg, c[fg], c[bg], 4.5);
    pair('ok on ' + bg + ' (dot only)', c.ok, c[bg], 3); pair('star on ' + bg + ' (glyph only)', c.star, c[bg], 3);
  }
  pair('ink on mark over page', c.ink, '#' + over(c.mark, c.page).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''), 4.5);
  pair('onCobalt on cobalt', c.onCobalt, c.cobalt, 4.5); pair('onCoral on coral', c.onCoral, c.coral, 4.5);
  pair('page on ink (selected chip)', c.page, c.ink, 4.5); pair('cobalt on soft (active tab)', c.cobalt, c.soft, 3); pair('ink2 on soft (search, draft)', c.ink2, c.soft, 4.5);
  for (const t of Object.keys(k)) pair(t + ' tile glyph', k[t].fg, k[t].bg, 3);
}
const w = [5, 34, 6, 5, 5];
console.log(rows.map(r => r.map((v, i) => String(v).padEnd(w[i])).join(' ')).join('\n'));
console.log(rows.some(r => r[4] === 'FAIL') ? '\nSome pairs fail.' : '\nAll pairs pass.');
