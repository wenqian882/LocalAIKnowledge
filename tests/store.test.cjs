const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../dist-electron/electron/store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-store-'));
  const data = path.join(root, 'data');
  const original = path.join(root, '原始学习笔记.md');
  fs.writeFileSync(
    original,
    '# 学习笔记\n公开合成测试资料。<script>throw new Error("untrusted")</script>',
  );
  const store = new Store(data);
  t.after(() => {
    try {
      store.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, data, original, store };
}
test('知识库验证、更新、类别与文件计数', async (t) => {
  const { store } = fixture(t);
  assert.throws(
    () => store.saveKnowledge({ name: ' ', description: '', type: 'personal' }),
    /名称/,
  );
  assert.throws(
    () => store.saveKnowledge({ name: 'test', description: '', type: 'public' }),
    /类型/,
  );
  store.saveKnowledge({ name: '学习笔记', description: '初始简介', type: 'personal' });
  const kb = store.knowledge()[0];
  assert.equal(kb.fileCount, 0);
  store.saveKnowledge({ name: '公开手册', description: '更新简介', type: 'general' }, kb.id);
  assert.equal(store.knowledge()[0].name, '公开手册');
  assert.equal(store.knowledge()[0].type, 'general');
  assert.throws(
    () => store.saveKnowledge({ name: 'a'.repeat(81), description: '', type: 'personal' }),
    /80/,
  );
});
test('导入独立副本、读取原始文本、同名文件不覆盖、移除不删原件', async (t) => {
  const { store, original } = fixture(t);
  store.saveKnowledge({ name: '笔记', description: '', type: 'personal' });
  const kb = store.knowledge()[0];
  assert.equal((await store.importFiles(kb.id, [original])).imported, 1);
  assert.equal((await store.importFiles(kb.id, [original])).imported, 1);
  assert.equal(store.knowledge()[0].fileCount, 2);
  const files = store.files(kb.id);
  assert.notEqual(files[0].id, files[1].id);
  const old = store.readFile(files[0].id);
  fs.writeFileSync(original, '原件已变化');
  assert.equal(store.readFile(files[0].id), old);
  assert.match(old, /<script>/);
  assert.equal(files[0].indexStatus, 'not_indexed');
  store.removeFile(files[0].id);
  assert.equal(store.files(kb.id).length, 1);
  assert.equal(fs.readFileSync(original, 'utf8'), '原件已变化');
  assert.throws(() => store.readFile('../../private'), /不存在/);
});
test('部分导入反馈：格式、编码、二进制、大小、目录、缺失文件', async (t) => {
  const { store, original, root } = fixture(t);
  store.saveKnowledge({ name: 'test', description: '', type: 'personal' });
  const kb = store.knowledge()[0];
  const names = [
    'unsupported.pdf',
    'bad.txt',
    'binary.md',
    'large.txt',
    'missing.txt',
    'folder.md',
  ];
  fs.writeFileSync(path.join(root, names[0]), 'not pdf');
  fs.writeFileSync(path.join(root, names[1]), Buffer.from([0xff, 0xfe, 0x61]));
  fs.writeFileSync(path.join(root, names[2]), Buffer.from([0x61, 0, 0x62]));
  fs.writeFileSync(path.join(root, names[3]), Buffer.alloc(10 * 1024 * 1024 + 1, 97));
  fs.mkdirSync(path.join(root, names[5]));
  const result = await store.importFiles(kb.id, [
    original,
    ...names.map((name) => path.join(root, name)),
  ]);
  assert.equal(result.imported, 1);
  assert.equal(result.errors.length, 6);
  assert.match(result.errors.join('\n'), /UTF-8/);
  assert.equal(store.files(kb.id).length, 1);
});
test('发送原子保存且演示显式标注，清空消息拒绝', async (t) => {
  const { store } = fixture(t);
  const conversation = store.createConversation();
  assert.throws(() => store.sendMessage(conversation.id, '   '), /消息/);
  assert.throws(() => store.sendMessage(conversation.id, 'a'.repeat(20001)), /20000/);
  store.sendMessage(conversation.id, '我的第一个问题');
  const messages = store.messages(conversation.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].isDemo, true);
  assert.match(messages[1].content, /没有读取或检索/);
  assert.equal(store.conversations()[0].title, '我的第一个问题');
});
test('重开数据库保留文件、会话、关联；删除级联清理且保留聊天与原件', async (t) => {
  const { store, data, original } = fixture(t);
  store.saveKnowledge({ name: '持久化资料', description: '重启验证', type: 'general' });
  const kb = store.knowledge()[0];
  await store.importFiles(kb.id, [original]);
  const file = store.files(kb.id)[0];
  const conversation = store.createConversation();
  store.setKnowledge(conversation.id, [kb.id]);
  store.sendMessage(conversation.id, '持久化问题');
  assert.throws(() => store.setKnowledge(conversation.id, ['missing']), /不存在/);
  assert.deepEqual(store.conversations()[0].kbIds, [kb.id]);
  store.close();
  const reopened = new Store(data);
  try {
    assert.equal(reopened.knowledge().length, 1);
    assert.equal(reopened.messages(conversation.id).length, 2);
    assert.deepEqual(reopened.conversations()[0].kbIds, [kb.id]);
    assert.match(reopened.readFile(file.id), /学习笔记/);
    reopened.deleteKnowledge(kb.id);
    assert.equal(reopened.knowledge().length, 0);
    assert.deepEqual(reopened.conversations()[0].kbIds, []);
    assert.equal(reopened.messages(conversation.id).length, 2);
    assert.equal(fs.existsSync(path.join(reopened.filesPath, kb.id)), false);
    assert.equal(fs.existsSync(original), true);
  } finally {
    reopened.close();
  }
});
test('文件复制失败不留下导入记录或虚假计数', async (t) => {
  const { store, original } = fixture(t);
  store.saveKnowledge({ name: '失败验证', description: '', type: 'personal' });
  const kb = store.knowledge()[0];
  fs.writeFileSync(path.join(store.filesPath, kb.id), '占用目录名');
  const result = await store.importFiles(kb.id, [original]);
  assert.equal(result.imported, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(store.knowledge()[0].fileCount, 0);
});
