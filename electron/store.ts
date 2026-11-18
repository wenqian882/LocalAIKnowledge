import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Conversation,
  ImportResult,
  KnowledgeBase,
  KnowledgeFile,
  KnowledgeInput,
  Message,
  ParsedDocument,
} from '../shared/types';
import { demoReply } from './providers';
import type { GeneratedReply } from './model-service';
import { documentFormat, localDocumentParser, MAX_FILE_BYTES } from './document-parser';

const now = () => new Date().toISOString();
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  const result = value.trim();
  if (required && !result) throw new Error(`请填写${label}`);
  if (result.length > max) throw new Error(`${label}最多 ${max} 个字符`);
  return result;
}
export class Store {
  readonly db: DatabaseSync;
  readonly filesPath: string;
  constructor(readonly dataPath: string) {
    fs.mkdirSync(dataPath, { recursive: true });
    this.filesPath = path.join(dataPath, 'files');
    fs.mkdirSync(this.filesPath, { recursive: true });
    this.db = new DatabaseSync(path.join(dataPath, 'knowledge.sqlite'));
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS knowledge (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('personal','general')), updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, kbId TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL, importedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_knowledge (conversationId TEXT REFERENCES conversations(id) ON DELETE CASCADE, kbId TEXT REFERENCES knowledge(id) ON DELETE CASCADE, PRIMARY KEY(conversationId,kbId));
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, isDemo INTEGER NOT NULL, createdAt TEXT NOT NULL);
      PRAGMA user_version=1;`);
    const columns = this.db
      .prepare('PRAGMA table_info(messages)')
      .all()
      .map((column) => column.name);
    if (!columns.includes('provider'))
      this.db.exec('ALTER TABLE messages ADD COLUMN provider TEXT');
    if (!columns.includes('model')) this.db.exec('ALTER TABLE messages ADD COLUMN model TEXT');
    const fileColumns = this.db
      .prepare('PRAGMA table_info(files)')
      .all()
      .map((column) => column.name);
    for (const [name, type] of [
      ['format', 'TEXT'],
      ['pageCount', 'INTEGER'],
      ['textLength', 'INTEGER'],
      ['parseWarnings', "TEXT NOT NULL DEFAULT '[]'"],
    ])
      if (!fileColumns.includes(name)) this.db.exec(`ALTER TABLE files ADD COLUMN ${name} ${type}`);
    this.db.exec('PRAGMA user_version=3');
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private requireKnowledge(id: string) {
    if (!this.db.prepare('SELECT id FROM knowledge WHERE id=?').get(id))
      throw new Error('知识库不存在，请刷新后重试');
  }
  private requireConversation(id: string) {
    if (!this.db.prepare('SELECT id FROM conversations WHERE id=?').get(id))
      throw new Error('对话不存在');
  }
  knowledge(): KnowledgeBase[] {
    return this.db
      .prepare(
        'SELECT k.*, (SELECT COUNT(*) FROM files f WHERE f.kbId=k.id) AS fileCount FROM knowledge k ORDER BY updatedAt DESC, rowid DESC',
      )
      .all() as unknown as KnowledgeBase[];
  }
  saveKnowledge(input: KnowledgeInput, id?: string): void {
    if (!input || !['personal', 'general'].includes(input.type))
      throw new Error('请选择个人或通用类型');
    const name = text(input.name, '名称', 80, true);
    const description = text(input.description, '简介', 500);
    if (id) {
      this.requireKnowledge(id);
      this.db
        .prepare('UPDATE knowledge SET name=?,description=?,type=?,updatedAt=? WHERE id=?')
        .run(name, description, input.type, now(), id);
    } else
      this.db
        .prepare('INSERT INTO knowledge VALUES (?,?,?,?,?)')
        .run(randomUUID(), name, description, input.type, now());
  }
  deleteKnowledge(id: string): void {
    this.requireKnowledge(id);
    // Stage owned copies first, so a database failure can restore them.
    const original = path.join(this.filesPath, id);
    const staged = path.join(this.filesPath, `${id}.trash`);
    const exists = fs.existsSync(original);
    if (exists) fs.renameSync(original, staged);
    try {
      this.db.prepare('DELETE FROM knowledge WHERE id=?').run(id);
    } catch (error) {
      if (exists) fs.renameSync(staged, original);
      throw error;
    }
    if (exists) fs.rmSync(staged, { recursive: true, force: true });
  }
  files(kbId: string): KnowledgeFile[] {
    this.requireKnowledge(kbId);
    return this.db
      .prepare(
        "SELECT *, 'not_indexed' AS indexStatus FROM files WHERE kbId=? ORDER BY importedAt DESC, rowid DESC",
      )
      .all(kbId)
      .map((row) => {
        const { parseWarnings, ...value } = row;
        return {
          ...value,
          format: row.format ?? documentFormat(row.name as string),
          warnings: JSON.parse((parseWarnings as string) || '[]'),
        };
      }) as unknown as KnowledgeFile[];
  }
  async importFiles(kbId: string, paths: string[]): Promise<ImportResult> {
    this.requireKnowledge(kbId);
    if (!Array.isArray(paths) || paths.length > 100) throw new Error('一次最多导入 100 个文件');
    const result: ImportResult = { imported: 0, errors: [] };
    for (const source of paths) {
      let copied: string | undefined;
      let parsedCopy: string | undefined;
      if (typeof source !== 'string') {
        result.errors.push('文件路径格式不正确');
        continue;
      }
      const name = path.basename(source);
      try {
        documentFormat(name);
        const stat = fs.statSync(source);
        if (!stat.isFile()) throw new Error('请选择普通文件');
        if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过 10 MB 限制');
        const bytes = fs.readFileSync(source);
        if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 10 MB 限制');
        const id = randomUUID();
        const directory = path.join(this.filesPath, kbId);
        fs.mkdirSync(directory, { recursive: true });
        copied = path.join(directory, id);
        fs.writeFileSync(copied, bytes, { flag: 'wx' });
        const parsed = await localDocumentParser.parse(name, bytes);
        if (parsed.format === 'docx' || parsed.format === 'pdf') {
          parsedCopy = `${copied}.parsed.json`;
          fs.writeFileSync(parsedCopy, JSON.stringify(parsed), { encoding: 'utf8', flag: 'wx' });
        }
        this.transaction(() => {
          this.requireKnowledge(kbId);
          this.db
            .prepare(
              'INSERT INTO files (id,kbId,name,size,importedAt,format,pageCount,textLength,parseWarnings) VALUES (?,?,?,?,?,?,?,?,?)',
            )
            .run(
              id,
              kbId,
              name,
              bytes.length,
              now(),
              parsed.format,
              parsed.pageCount ?? null,
              parsed.text.length,
              JSON.stringify(parsed.warnings),
            );
          this.db.prepare('UPDATE knowledge SET updatedAt=? WHERE id=?').run(now(), kbId);
        });
        result.imported++;
      } catch (error) {
        if (parsedCopy && fs.existsSync(parsedCopy)) fs.unlinkSync(parsedCopy);
        if (copied && fs.existsSync(copied)) fs.unlinkSync(copied);
        result.errors.push(`${name}：${error instanceof Error ? error.message : '导入失败'}`);
      }
    }
    return result;
  }
  private file(id: string): KnowledgeFile {
    const file = this.db.prepare('SELECT * FROM files WHERE id=?').get(id) as unknown as
      KnowledgeFile | undefined;
    if (!file) throw new Error('文件不存在');
    return file;
  }
  readFile(id: string): string {
    const file = this.file(id);
    const format = documentFormat(file.name);
    if (format === 'pdf' || format === 'docx') {
      try {
        const parsed: ParsedDocument = JSON.parse(
          fs.readFileSync(path.join(this.filesPath, file.kbId, `${file.id}.parsed.json`), 'utf8'),
        );
        if (typeof parsed.text !== 'string') throw new Error();
        return parsed.text;
      } catch {
        throw new Error('提取正文副本缺失或损坏，请移除该文件后重新导入；用户原文件不会被删除');
      }
    }
    return fs
      .readFileSync(path.join(this.filesPath, file.kbId, file.id), 'utf8')
      .replace(/^\uFEFF/, '');
  }
  removeFile(id: string): void {
    const file = this.file(id);
    const original = path.join(this.filesPath, file.kbId, file.id);
    const staged: [string, string][] = [];
    try {
      for (const source of [original, `${original}.parsed.json`]) {
        if (fs.existsSync(source)) {
          fs.renameSync(source, `${source}.trash`);
          staged.push([source, `${source}.trash`]);
        }
      }
      this.transaction(() => {
        this.db.prepare('DELETE FROM files WHERE id=?').run(id);
        this.db.prepare('UPDATE knowledge SET updatedAt=? WHERE id=?').run(now(), file.kbId);
      });
    } catch (error) {
      for (const [source, target] of staged.reverse()) fs.renameSync(target, source);
      throw error;
    }
    for (const [, target] of staged) fs.unlinkSync(target);
  }
  conversations(): Conversation[] {
    const rows = this.db
      .prepare('SELECT * FROM conversations ORDER BY updatedAt DESC, rowid DESC')
      .all();
    return rows.map((row) => ({
      ...row,
      kbIds: this.db
        .prepare('SELECT kbId FROM conversation_knowledge WHERE conversationId=?')
        .all(row.id)
        .map((item) => item.kbId),
    })) as unknown as Conversation[];
  }
  createConversation(): Conversation {
    const conversation: Conversation = {
      id: randomUUID(),
      title: '新对话',
      kbIds: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.db
      .prepare('INSERT INTO conversations VALUES (?,?,?,?)')
      .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt);
    return conversation;
  }
  setKnowledge(id: string, kbIds: string[]): void {
    this.requireConversation(id);
    if (!Array.isArray(kbIds) || kbIds.some((value) => typeof value !== 'string'))
      throw new Error('知识库选择格式不正确');
    this.transaction(() => {
      this.db.prepare('DELETE FROM conversation_knowledge WHERE conversationId=?').run(id);
      for (const kbId of new Set(kbIds)) {
        this.requireKnowledge(kbId);
        this.db.prepare('INSERT INTO conversation_knowledge VALUES (?,?)').run(id, kbId);
      }
    });
  }
  messages(id: string): Message[] {
    this.requireConversation(id);
    return this.db
      .prepare('SELECT * FROM messages WHERE conversationId=? ORDER BY rowid')
      .all(id)
      .map((row) => ({ ...row, isDemo: Boolean(row.isDemo) })) as unknown as Message[];
  }
  validateMessage(id: string, value: string): string {
    this.requireConversation(id);
    return text(value, '消息', 20000, true);
  }
  sendMessage(id: string, value: string, generated?: GeneratedReply | null): void {
    const content = this.validateMessage(id, value);
    this.transaction(() => {
      const isFirst = this.messages(id).length === 0;
      const insert = this.db.prepare(
        'INSERT INTO messages (id,conversationId,role,content,isDemo,createdAt,provider,model) VALUES (?,?,?,?,?,?,?,?)',
      );
      insert.run(randomUUID(), id, 'user', content, 0, now(), null, null);
      insert.run(
        randomUUID(),
        id,
        'assistant',
        generated?.content ?? demoReply,
        generated ? 0 : 1,
        now(),
        generated?.provider ?? null,
        generated?.model ?? null,
      );
      if (isFirst)
        this.db
          .prepare('UPDATE conversations SET title=?,updatedAt=? WHERE id=?')
          .run(content.slice(0, 32), now(), id);
      else this.db.prepare('UPDATE conversations SET updatedAt=? WHERE id=?').run(now(), id);
    });
  }
  close() {
    this.db.close();
  }
}
