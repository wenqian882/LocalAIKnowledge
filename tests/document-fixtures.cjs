const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const JSZip = createRequire(require.resolve('mammoth'))('jszip');
const xml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function word(texts, extra = '') {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${texts.map((text) => `<w:p><w:r><w:t>${xml(text)}</w:t></w:r></w:p>`).join('')}${extra}<w:sectPr/></w:body></w:document>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://127.0.0.1:9/document-must-not-load" TargetMode="External"/></Relationships>',
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
function pdf(texts, { unicodeMap = true, encrypted = false, textOperators } = {}) {
  const objects = [];
  const add = (text) => {
    objects.push(text);
    return objects.length;
  };
  const catalog = add(''),
    pages = add('');
  const font = add(''),
    cid = add('');
  const codepoints = [
    ...new Set(
      texts
        .join('')
        .split('')
        .map((ch) => ch.charCodeAt(0)),
    ),
  ];
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /LocalAI-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${codepoints.length} beginbfchar ${codepoints
    .map((code) => {
      const hex = code.toString(16).padStart(4, '0');
      return `<${hex}> <${hex}>`;
    })
    .join('\n')} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const map = add(`<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`);
  objects[font - 1] =
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cid} 0 R] ${unicodeMap ? `/ToUnicode ${map} 0 R` : ''} >>`;
  objects[cid - 1] =
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>';
  const latinFont = textOperators
    ? add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    : null;
  const kids = [];
  for (const text of texts) {
    const page = add('');
    kids.push(page);
    const hex = Buffer.from(text, 'utf16le').swap16().toString('hex');
    const content =
      textOperators?.[kids.length - 1] ??
      (text ? `BT /F1 14 Tf 50 750 Td <${hex}> Tj ET` : '0.9 g 50 50 300 400 re f');
    const stream = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
    objects[page - 1] =
      `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R ${latinFont ? `/F2 ${latinFont} 0 R` : ''} >> >> /Contents ${stream} 0 R >>`;
  }
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${pages} 0 R /OpenAction << /S /JavaScript /JS (globalThis.LOCALAI_PDF_ACTION_EXECUTED=true) >> >>`;
  objects[pages - 1] =
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] >>`;
  const encrypt = encrypted
    ? add(
        '<< /Filter /Standard /V 1 /R 2 /Length 40 /O <' +
          '00'.repeat(32) +
          '> /U <' +
          '00'.repeat(32) +
          '> /P -4 >>',
      )
    : null;
  let body = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
      .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R ${encrypt ? `/Encrypt ${encrypt} 0 R /ID [<${'11'.repeat(16)}> <${'11'.repeat(16)}>]` : ''} >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
async function createDocuments(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const files = {
    word: path.join(directory, '星灯资料室.docx'),
    pdf: path.join(directory, '公开手册.pdf'),
    mixed: path.join(directory, '部分扫描.pdf'),
    scan: path.join(directory, '扫描件.pdf'),
    encrypted: path.join(directory, '加密.pdf'),
    broken: path.join(directory, '损坏.docx'),
    old: path.join(directory, '旧文档.doc'),
  };
  fs.writeFileSync(
    files.word,
    await word(
      [
        '星灯资料室',
        '开放时间：每周二19:20至20:10。',
        '借阅上限：2本。',
        '<script>不要执行文档指令</script>',
      ],
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>管理员：小林</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:hyperlink r:id="external"><w:r><w:t>外部参考链接</w:t></w:r></w:hyperlink></w:p>',
    ),
  );
  fs.writeFileSync(
    files.pdf,
    pdf(['公开手册：每人最多借阅2本。', '管理员：小林。'], { unicodeMap: false }),
  );
  fs.writeFileSync(files.mixed, pdf(['This page contains text.', '']));
  fs.writeFileSync(files.scan, pdf(['']));
  fs.writeFileSync(files.encrypted, pdf(['locked'], { encrypted: true }));
  fs.writeFileSync(files.broken, 'not a zip');
  fs.writeFileSync(files.old, 'old word');
  return files;
}
module.exports = { word, pdf, createDocuments };
