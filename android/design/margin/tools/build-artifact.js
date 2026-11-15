// Joins index.html, css and js into one file for publishing as a single page. Usage: node tools/build-artifact.js <out.html>
const fs = require('fs'), path = require('path'), root = path.resolve(__dirname, '..');
const r = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = r('index.html'), body = /<!--BODY-->([\s\S]*?)<!--\/BODY-->/.exec(html)[1];
const fonts = html.split('\n').filter(l => /fonts\.g/.test(l)).join('\n');
fs.writeFileSync(process.argv[2], '<title>Logbook Margin Design</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + fonts + '\n<style>\n' + r('css/margin.css') + '</style>\n' + body + '<script>\n' + r('js/data.js') + '</script>\n<script>\n' + r('js/app.js') + '</script>\n');
