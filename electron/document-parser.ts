import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { DocumentFormat, ParsedDocument } from '../shared/types';
import type { DocumentParser } from './providers';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 2_000_000;
const active = new Set<Worker>();
export function cancelDocumentParsing() {
  for (const worker of active) void worker.terminate();
}
export function documentFormat(name: string): DocumentFormat {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.txt') return 'text';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.docx') return 'docx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.doc') throw new Error('旧版 Word .doc 暂不支持，请在 Word 中另存为 .docx 后导入');
  throw new Error('仅支持 TXT、Markdown、Word（.docx）和 PDF；扫描件暂不支持 OCR');
}
export function parseBinaryDocument(
  name: string,
  bytes: Uint8Array,
  timeoutMs = 30_000,
): Promise<ParsedDocument> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'document-worker.js'), {
      workerData: { name, bytes },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
      stdout: true,
      stderr: true,
    });
    active.add(worker);
    // Parser diagnostics may contain document text. Do not forward them to logs.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error?: Error, parsed?: ParsedDocument) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(worker);
      void worker.terminate();
      if (error) reject(error);
      else resolve(parsed!);
    };
    const timer = setTimeout(
      () => finish(new Error('文档解析超过 30 秒，已停止；请拆分文档后再导入')),
      timeoutMs,
    );
    worker.once('message', (message: { document?: ParsedDocument; error?: string }) => {
      if (message.error) finish(new Error(message.error));
      else if (
        !message.document ||
        typeof message.document.text !== 'string' ||
        message.document.text.length > MAX_TEXT_CHARS
      )
        finish(new Error('文档解析结果无效，未导入'));
      else finish(undefined, message.document);
    });
    worker.once('error', () =>
      finish(new Error('文档解析进程异常，可能超出资源限制；请检查或拆分文件')),
    );
    worker.once('exit', () => finish(new Error('文档解析已停止，未完成导入')));
  });
}
export const localDocumentParser: DocumentParser = {
  extensions: ['txt', 'md', 'markdown', 'docx', 'pdf'],
  async parse(name, bytes) {
    const format = documentFormat(name);
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 10 MB 限制');
    if (format === 'pdf' || format === 'docx') return parseBinaryDocument(name, bytes);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      throw new Error('请先将文本转换为 UTF-8 编码');
    }
    if (bytes.includes(0)) throw new Error('文件包含二进制内容，请导入纯文本');
    if (text.length > MAX_TEXT_CHARS) throw new Error('提取正文超过 200 万字符，请拆分后导入');
    return { version: 1, format, text, warnings: [] };
  },
};
