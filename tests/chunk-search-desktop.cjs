const { _electron: electron, expect } = require('playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../dist-electron/electron/store');
const { splitText } = require('../dist-electron/shared/chunking');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-keyword-'));
const userData = path.join(temporary, 'appdata');
const data = path.join(userData, 'data');
const name = '公开资料关键词练习.md';
const text = Array.from(
  { length: 50 },
  (_, i) =>
    `项目 ${i + 1}：公开资料整理\n${'资料说明，核对原文和保留来源。'.repeat(16)}\n${i === 44 ? '导出 EXCEL、CSV、JSON。[REF]' : '这里没有目标格式词。'}\n\n`,
).join('');
const source = path.join(temporary, name);
fs.writeFileSync(source, text);
let desktop;
(async () => {
  try {
    // Setup only; existing import/CRUD and splitting are not re-accepted here.
    const store = new Store(data);
    store.saveKnowledge({ name: '关键词练习', description: '合成资料', type: 'personal' });
    const kb = store.knowledge()[0];
    await store.importFiles(kb.id, [source]);
    const file = store.files(kb.id)[0];
    const before = JSON.stringify(store.db.prepare('SELECT * FROM files ORDER BY id').all());
    store.close();
    const env = { ...process.env, LOCALAI_TEST_DATA: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await electron.launch({ args: [root], env });
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await desktop.evaluate(({ session }) => {
      globalThis.__keywordRequests = 0;
      session.fromPartition('localai-model-api').fetch = async () => {
        globalThis.__keywordRequests++;
        throw new Error('Keyword lookup must be local');
      };
    });
    await page.getByRole('button', { name: '知识库', exact: true }).click();
    await page.getByRole('button', { name: '打开知识库 关键词练习', exact: true }).click();
    await page.getByRole('button', { name: '查看正文', exact: true }).click();
    await page.getByRole('button', { name: '查看分块', exact: true }).click();
    const input = page.getByRole('textbox', { name: '分块关键词', exact: true });
    const target = splitText(text, 300).find((chunk) => chunk.text.includes('EXCEL'));
    assert.ok(target.number > 20, 'Target must start outside the first visible page');
    await input.fill('  eXcEl  ');
    await expect(page.locator('.chunk-item')).toHaveCount(1);
    await expect(page.locator('.chunk-heading strong')).toHaveText(`第 ${target.number} 块`);
    await expect(page.locator('.chunk-text')).toContainText('EXCEL、CSV、JSON');
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    console.log(
      'PASS keyword lookup includes later-page chunks, trims query, ignores case and keeps source numbers',
    );

    await input.fill('PPT');
    await expect(page.locator('.chunk-item')).toHaveCount(0);
    await expect(page.locator('.chunk-no-results')).toContainText('没有找到包含“PPT”的分块');
    await expect(page.locator('.chunk-no-results')).toContainText('未命中不代表资料一定没有答案');
    await expect(page.locator('.chunk-no-results')).not.toContainText('不支持');
    await page.getByRole('button', { name: '清空分块关键词', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(page.locator('.chunk-item')).toHaveCount(20);
    await expect(page.locator('.chunk-heading strong').first()).toHaveText('第 1 块');
    await input.fill('[REF]');
    await expect(page.locator('.chunk-item')).toHaveCount(1);
    await expect(page.locator('.chunk-text')).toContainText('[REF]');
    console.log('PASS zero-hit uncertainty, explicit clearing and literal punctuation match');

    await input.fill('资料');
    await page.getByRole('button', { name: '下一页分块', exact: true }).click();
    await input.fill('Excel');
    await expect(page.locator('.chunk-item')).toHaveCount(1);
    await expect(page.locator('.chunk-heading strong')).toHaveText(`第 ${target.number} 块`);
    await page.getByRole('combobox', { name: '分块大小', exact: true }).selectOption('600');
    await expect(input).toHaveValue('Excel');
    const larger = splitText(text, 600).find((chunk) => chunk.text.includes('EXCEL'));
    await expect(page.locator('.chunk-item')).toHaveCount(1);
    await expect(page.locator('.chunk-heading strong')).toHaveText(`第 ${larger.number} 块`);
    assert.equal(await page.locator('.chunk-list').evaluate((el) => el.scrollTop), 0);
    fs.mkdirSync(path.join(root, 'docs/screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'docs/screenshots/keyword-retrieval.png') });
    assert.deepEqual(errors, []);
    assert.equal(await desktop.evaluate(() => globalThis.__keywordRequests), 0);
    await desktop.close();
    desktop = null;
    const db = new DatabaseSync(path.join(data, 'knowledge.sqlite'), { readOnly: true });
    try {
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM files ORDER BY id').all()), before);
    } finally {
      db.close();
    }
    assert.equal(fs.readFileSync(source, 'utf8'), text);
    assert.equal(fs.readFileSync(path.join(data, 'files', kb.id, file.id), 'utf8'), text);
    console.log(
      'PASS filtered pagination/size reset, query preserved, document unchanged and API requests zero',
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('localai-keyword-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})();
