import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import type { ParsedDocument } from '../shared/types';

const MAX_TEXT = 2_000_000;
function checkZip(bytes: Buffer) {
  // Bound the declared expansion before Mammoth/JSZip decompress anything.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Word 文件无效或已加密，请另存为未加密的 .docx 后导入');
  const entries = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt32LE(end + 4) !== 0 ||
    entries === 65535 ||
    start === 0xffffffff ||
    entries > 1000 ||
    start + size > end
  )
    throw new Error('Word 压缩结构过大或格式不支持，请拆分或另存为 .docx');
  let offset = start,
    total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > start + size || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Word 压缩结构损坏，未导入');
    if (bytes.readUInt16LE(offset + 8) & 1)
      throw new Error('Word 文件已加密，请解密后另存为 .docx');
    const expanded = bytes.readUInt32LE(offset + 24);
    total += expanded;
    if (expanded > 20 * 1024 * 1024 || total > 50 * 1024 * 1024)
      throw new Error('Word 解压内容过大，请拆分后导入');
    offset +=
      46 +
      bytes.readUInt16LE(offset + 28) +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
    if (offset > start + size) throw new Error('Word 压缩结构损坏，未导入');
  }
  if (offset !== start + size) throw new Error('Word 压缩结构损坏，未导入');
}
class LocalBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory =
      kind === 'cMapUrl' ? 'cmaps' : kind === 'standardFontDataUrl' ? 'standard_fonts' : null;
    if (!directory || !/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes('..'))
      throw new Error('Unsupported local PDF resource');
    return new Uint8Array(
      await fs.readFile(path.join(__dirname, 'pdf-resources', directory, filename)),
    );
  }
}
async function extract(name: string, bytes: Buffer): Promise<ParsedDocument> {
  if (path.extname(name).toLowerCase() === '.docx') {
    checkZip(bytes);
    let result;
    try {
      result = await mammoth.extractRawText({ buffer: bytes });
    } catch {
      throw new Error('Word 正文解析失败，文件可能损坏或格式不兼容；请另存为 .docx 后重试');
    }
    const text = result.value.replace(/\r\n?/g, '\n').trim();
    if (!text) throw new Error('Word 未提取到正文，可能为空或只有图片；本版尚未支持 OCR');
    if (text.length > MAX_TEXT) throw new Error('提取正文超过 200 万字符，请拆分后导入');
    return {
      version: 1,
      format: 'docx',
      text,
      warnings: result.messages.length
        ? ['部分 Word 内容未识别，图片、文本框或复杂排版可能遗漏，请核对原文。']
        : [],
    };
  }
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new Error('PDF 文件格式无效，可能已损坏或扩展名不正确');
  // Pure JS serverless PDF.js. No render/viewer, embedded actions or remote URLs.
  const { getDocumentProxy } = require('unpdf');
  let pdf: any;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      isEvalSupported: false,
      enableScripting: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
      maxImageSize: 0,
      BinaryDataFactory: LocalBinaryDataFactory,
      cMapPacked: true,
    });
    if (pdf.numPages > 500) throw new Error('PDF 超过 500 页，请拆分后导入');
    const pages: { number: number; text: string }[] = [],
      empty: number[] = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        // Text items can split a word at font/style boundaries. PDF.js already
        // includes word spaces; an item boundary is not an extra word separator.
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      text = text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      length += text.length;
      if (length > MAX_TEXT) throw new Error('提取正文超过 200 万字符，请拆分后导入');
      if (!text) empty.push(number);
      pages.push({ number, text });
      page.cleanup();
    }
    if (empty.length === pages.length)
      throw new Error('PDF 未提取到文字，可能是扫描件、图片或空白文件；本版尚未支持 OCR');
    return {
      version: 1,
      format: 'pdf',
      pageCount: pages.length,
      pages,
      text: pages
        .map((page) => `【第 ${page.number} 页】\n${page.text || '（此页未提取到文字）'}`)
        .join('\n\n'),
      warnings: empty.length
        ? [
            `第 ${empty.slice(0, 20).join('、')}${empty.length > 20 ? ' 等' : ''} 页未提取到文字，可能为空白或扫描页；尚未执行 OCR，请核对原文。`,
          ]
        : [],
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('PDF 已加密或需要密码，请先解密后导入');
    if (error instanceof Error && /^(PDF |提取正文)/.test(error.message)) throw error;
    throw new Error('PDF 正文解析失败，文件可能损坏或不兼容，请检查后重新导出');
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
  }
}
void extract(workerData.name, Buffer.from(workerData.bytes)).then(
  (document) => parentPort!.postMessage({ document }),
  (error) =>
    parentPort!.postMessage({
      error: error instanceof Error ? error.message : '文档解析失败，未导入',
    }),
);
