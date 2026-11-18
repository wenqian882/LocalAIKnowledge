const { _electron: electron, expect } = require('playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../dist-electron/electron/store');
const { splitText } = require('../dist-electron/shared/chunking');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-chunks-'));
const userData = path.join(temporary, 'appdata');
const data = path.join(userData, 'data');
const name = '分块学习资料.md';
const text = Array.from(
  { length: 45 },
  (_, i) =>
    `项目 ${i + 1}：星灯资料室\n${'将公开资料整理成可以核对的文字，观察标题与描述是否保留在同一块。'.repeat(6)}\n<script>globalThis.__chunkExecuted=true</script>\n\n`,
).join('');
const source = path.join(temporary, name);
fs.writeFileSync(source, text);
const dataRows = (db) => db.prepare('SELECT * FROM files ORDER BY id').all();
let desktop;
(async () => {
  try {
    // Existing import is fixture setup only, not a repeated acceptance check.
    const store = new Store(data);
    store.saveKnowledge({ name: '分块练习', description: '合成资料', type: 'personal' });
    const kb = store.knowledge()[0];
    await store.importFiles(kb.id, [source]);
    const file = store.files(kb.id)[0];
    const before = JSON.stringify(dataRows(store.db));
    store.close();
    const env = { ...process.env, LOCALAI_TEST_DATA: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    const packaged = process.argv.includes('--packaged');
    desktop = await electron.launch({
      ...(packaged
        ? {
            executablePath: path.join(
              root,
              'release/LocalAI Knowledge-win32-x64/LocalAIKnowledge.exe',
            ),
            args: [],
          }
        : { args: [root] }),
      env,
    });
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await desktop.evaluate(({ session }) => {
      globalThis.__chunkRequests = 0;
      session.fromPartition('localai-model-api').fetch = async () => {
        globalThis.__chunkRequests++;
        throw new Error('Chunk preview must remain offline');
      };
    });
    await page.getByRole('button', { name: '知识库', exact: true }).click();
    await page.getByRole('button', { name: '打开知识库 分块练习', exact: true }).click();
    await page.getByRole('button', { name: '查看正文', exact: true }).click();
    await expect(page.locator('.document-text')).toHaveText(text);
    await page.getByRole('button', { name: '查看分块', exact: true }).click();
    const panel = page.getByRole('region', { name: '分块预览', exact: true });
    await expect(panel.getByRole('status')).toHaveText(`共 ${splitText(text, 300).length} 块`);
    await expect(page.locator('.chunk-item')).toHaveCount(20);
    const shown = await page.locator('.chunk-text').allTextContents();
    assert.deepEqual(
      shown,
      splitText(text, 300)
        .slice(0, 20)
        .map((chunk) => chunk.text),
    );
    console.log('PASS chunk entry, 300-character blocks and source text match');

    await page.getByRole('button', { name: '下一页分块', exact: true }).click();
    await expect(page.locator('.chunk-heading strong').first()).toHaveText('第 21 块');
    await page.getByRole('combobox', { name: '分块大小', exact: true }).selectOption('600');
    await expect(panel.getByRole('status')).toHaveText(`共 ${splitText(text, 600).length} 块`);
    assert.ok(splitText(text, 600).length < splitText(text, 300).length);
    await expect(page.locator('.chunk-heading strong').first()).toHaveText('第 1 块');
    assert.equal(await page.locator('.chunk-list').evaluate((el) => el.scrollTop), 0);
    await expect(page.locator('.chunk-list')).toContainText('<script>');
    assert.equal(await page.evaluate(() => globalThis.__chunkExecuted), undefined);
    await page.getByRole('button', { name: '正文', exact: true }).click();
    await expect(page.locator('.document-text')).toHaveText(text);
    await page.getByRole('button', { name: '查看分块', exact: true }).click();
    fs.mkdirSync(path.join(root, 'docs/screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'docs/screenshots/chunk-preview.png') });
    assert.deepEqual(errors, []);
    assert.equal(await desktop.evaluate(() => globalThis.__chunkRequests), 0);
    console.log('PASS 600-character comparison, pagination reset, text toggle and safe plain text');

    await desktop.close();
    desktop = null;
    const db = new DatabaseSync(path.join(data, 'knowledge.sqlite'), { readOnly: true });
    try {
      assert.equal(JSON.stringify(dataRows(db)), before);
    } finally {
      db.close();
    }
    assert.equal(fs.readFileSync(source, 'utf8'), text);
    assert.equal(fs.readFileSync(path.join(data, 'files', kb.id, file.id), 'utf8'), text);
    console.log('PASS chunk preview did not write document records or files; model requests zero');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('localai-chunks-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})();
