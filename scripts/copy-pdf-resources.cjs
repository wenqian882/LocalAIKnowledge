const fs = require('node:fs');
const path = require('node:path');
const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
const target = path.resolve(__dirname, '../dist-electron/electron/pdf-resources');
fs.mkdirSync(target, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts'])
  fs.cpSync(path.join(source, directory), path.join(target, directory), { recursive: true });
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'PDFJS-LICENSE'));

fs.copyFileSync(
  path.resolve(__dirname, '../assets/licenses/CORE-JS-LICENSE'),
  path.join(target, 'CORE-JS-LICENSE'),
);
