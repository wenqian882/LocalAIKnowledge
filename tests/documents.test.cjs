const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../dist-electron/electron/store');
const { DatabaseSync } = require('node:sqlite');
const {
  localDocumentParser,
  parseBinaryDocument,
} = require('../dist-electron/electron/document-parser');
const { word, pdf, createDocuments } = require('./document-fixtures.cjs');
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-documents-'));
  const docs = await createDocuments(path.join(root, 'sources'));
  const store = new Store(path.join(root, 'data'));
  store.saveKnowledge({ name: '解析练习', description: '合成资料', type: 'personal' });
  t.after(() => {
    try {
      store.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, docs, store, kb: store.knowledge()[0] };
}
test('PDF片段边界不插入空格，保留英文单词间隔和换行', async () => {
  const bytes = pdf(['JSON STM32 Hello world Second line'], {
    textOperators: [
      'BT /F1 14 Tf 50 750 Td <004a0053> Tj /F2 14 Tf (ON ) Tj ' +
        '/F1 14 Tf <00530054004d> Tj /F2 14 Tf (32 Hello world) Tj ' +
        '0 -24 Td (Second line) Tj ET',
    ],
  });
  const parsed = await localDocumentParser.parse('fragmented-words.pdf', bytes);
  assert.match(parsed.pages[0].text, /JSON STM32 Hello world\nSecond line/);
  assert.doesNotMatch(parsed.text, /JS ON|STM 32|Helloworld/);
});

test('DOCX中文、段落、表格与链接正文：独立副本、不执行脚本或读取外链', async (t) => {
  const { docs, store, kb } = await fixture(t);
  const original = fs.readFileSync(docs.word);
  const result = await store.importFiles(kb.id, [docs.word, docs.word]);
  assert.equal(result.imported, 2, JSON.stringify(result));
  assert.deepEqual(result.errors, []);
  const [file, other] = store.files(kb.id);
  assert.notEqual(file.id, other.id);
  assert.equal(file.format, 'docx');
  assert.equal(file.indexStatus, 'not_indexed');
  const text = store.readFile(file.id);
  for (const phrase of ['星灯资料室', '每周二', '管理员：小林', '<script>', '外部参考链接'])
    assert.ok(text.includes(phrase), text);
  assert.deepEqual(fs.readFileSync(path.join(store.filesPath, kb.id, file.id)), original);
  fs.writeFileSync(docs.word, 'changed');
  assert.equal(store.readFile(file.id), text);
});
test('中文PDF本地CMap解析、页码与正文持久化，无PDF动作执行', async (t) => {
  const { docs, store, kb } = await fixture(t);
  const result = await store.importFiles(kb.id, [docs.pdf]);
  assert.equal(result.imported, 1, JSON.stringify(result));
  const file = store.files(kb.id)[0];
  assert.equal(file.pageCount, 2);
  assert.equal(file.format, 'pdf');
  const text = store.readFile(file.id);
  assert.match(text, /第 1 页/);
  assert.match(text, /公开手册/);
  assert.match(text, /小林/);
  assert.equal(globalThis.LOCALAI_PDF_ACTION_EXECUTED, undefined);
  const parsed = JSON.parse(
    fs.readFileSync(path.join(store.filesPath, kb.id, file.id + '.parsed.json'), 'utf8'),
  );
  assert.equal(parsed.pages[1].number, 2);
  assert.match(parsed.pages[1].text, /小林/);
});
test('扫描/空白、加密、损坏与旧DOC明确失败；混合批次保留成功项且清理失败副本', async (t) => {
  const { docs, store, kb } = await fixture(t);
  const result = await store.importFiles(kb.id, [
    docs.word,
    docs.pdf,
    docs.scan,
    docs.encrypted,
    docs.broken,
    docs.old,
  ]);
  assert.equal(result.imported, 2, JSON.stringify(result));
  assert.equal(result.errors.length, 4, JSON.stringify(result));
  for (const message of ['OCR', '加密', 'Word 文件无效', '.doc 暂不支持'])
    assert.ok(
      result.errors.some((error) => error.includes(message)),
      JSON.stringify(result),
    );
  assert.equal(store.files(kb.id).length, 2);
  assert.equal(fs.readdirSync(path.join(store.filesPath, kb.id)).length, 4);
});
test('部分无文字页记录警告，删除同时清理正文缓存且不删除原件', async (t) => {
  const { docs, store, kb } = await fixture(t);
  const original = fs.readFileSync(docs.mixed);
  assert.equal((await store.importFiles(kb.id, [docs.mixed])).imported, 1);
  const file = store.files(kb.id)[0];
  assert.match(file.warnings[0], /第 2 页/);
  store.removeFile(file.id);
  assert.equal(store.files(kb.id).length, 0);
  assert.equal(fs.readdirSync(path.join(store.filesPath, kb.id)).length, 0);
  assert.deepEqual(fs.readFileSync(docs.mixed), original);
});
test('重启保留解析正文/页码/警告，删除知识库清理副本与缓存，聊天保留', async (t) => {
  const { docs, store, kb, root } = await fixture(t);
  await store.importFiles(kb.id, [docs.word, docs.mixed]);
  const before = store.files(kb.id).map((file) => ({ file, text: store.readFile(file.id) }));
  const chat = store.createConversation();
  store.sendMessage(chat.id, '合成问题');
  store.setKnowledge(chat.id, [kb.id]);
  store.close();
  const reopened = new Store(path.join(root, 'data'));
  try {
    for (const value of before) assert.equal(reopened.readFile(value.file.id), value.text);
    assert.ok(reopened.files(kb.id).find((file) => file.format === 'pdf').warnings.length);
    reopened.deleteKnowledge(kb.id);
    assert.equal(fs.existsSync(path.join(reopened.filesPath, kb.id)), false);
    assert.equal(reopened.messages(chat.id).length, 2);
    assert.equal(fs.existsSync(docs.word), true);
  } finally {
    reopened.close();
  }
});
test('页数、ZIP解压大小及超时受限，超时后仍可再次解析', async () => {
  await assert.rejects(
    localDocumentParser.parse('many.pdf', pdf(Array(501).fill('page'))),
    /500 页/,
  );
  const bomb = await word(['valid']);
  const offset = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(60 * 1024 * 1024, offset + 24);
  await assert.rejects(localDocumentParser.parse('bomb.docx', bomb), /解压内容过大/);
  await assert.rejects(parseBinaryDocument('timeout.pdf', pdf(['small']), 1), /超过 30 秒/);
  assert.match(
    (await localDocumentParser.parse('okay.docx', await word(['再次解析成功']))).text,
    /再次解析成功/,
  );
});
test('保存失败原子清理Word原件副本和解析缓存，不留下假记录', async (t) => {
  const { docs, store, kb } = await fixture(t);
  store.db.exec(
    "CREATE TRIGGER reject_fixture BEFORE INSERT ON files BEGIN SELECT RAISE(FAIL,'synthetic failure'); END;",
  );
  const result = await store.importFiles(kb.id, [docs.word]);
  assert.equal(result.imported, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(store.files(kb.id).length, 0);
  assert.deepEqual(fs.readdirSync(path.join(store.filesPath, kb.id)), []);
  assert.equal(fs.existsSync(docs.word), true);
});

test('旧files表原TXT与聊天无损迁移，旧副本仍可预览', async (t) => {
  const { store, kb, root } = await fixture(t);
  const chat = store.createConversation();
  store.sendMessage(chat.id, '迁移前的合成问题');
  store.close();
  const file = path.join(root, 'data', 'knowledge.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(
    'DROP TABLE files; CREATE TABLE files (id TEXT PRIMARY KEY,kbId TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,importedAt TEXT NOT NULL); PRAGMA user_version=2;',
  );
  const text = '旧TXT正文仍保留';
  legacy
    .prepare('INSERT INTO files VALUES (?,?,?,?,?)')
    .run('legacy-file', kb.id, '旧资料.txt', Buffer.byteLength(text), '2026-11-16');
  const before = legacy.prepare('SELECT * FROM files').all();
  legacy.close();
  fs.mkdirSync(path.join(root, 'data', 'files', kb.id), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'files', kb.id, 'legacy-file'), text);
  const reopened = new Store(path.join(root, 'data'));
  try {
    assert.deepEqual(
      reopened.db.prepare('SELECT id,kbId,name,size,importedAt FROM files').all(),
      before,
    );
    assert.equal(reopened.readFile('legacy-file'), text);
    assert.equal(reopened.files(kb.id)[0].format, 'text');
    assert.equal(reopened.messages(chat.id).length, 2);
    assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 3);
    await assert.rejects(localDocumentParser.parse('空白.docx', await word([])), /未提取到正文/);
  } finally {
    reopened.close();
  }
});
