const { _electron: electron, expect } = require('playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createDocuments } = require('./document-fixtures.cjs');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-docs-desktop-'));
const userData = path.join(temporary, 'appdata');
const packaged = process.argv.includes('--packaged');
let desktop, page, docs;
const passed = [],
  errors = [];
async function check(name, work) {
  await work();
  passed.push(name);
  console.log('PASS ' + name);
}
async function launch() {
  const env = { ...process.env, LOCALAI_TEST_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({
    ...(packaged
      ? {
          executablePath:
            process.env.LOCALAI_TEST_EXECUTABLE ||
            path.join(root, 'release/LocalAI Knowledge-win32-x64/LocalAIKnowledge.exe'),
          args: [],
        }
      : { args: [root] }),
    env,
  });
  page = await desktop.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '知识库', exact: true }).waitFor();
  await desktop.evaluate(({ session }) => {
    globalThis.__documentRequests = [];
    session.fromPartition('localai-model-api').fetch = async (url, init) => {
      globalThis.__documentRequests.push({ url, body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: '合成协议回复，未检索文件' }],
            },
          ],
        }),
      );
    };
  });
}
async function choose(paths) {
  await desktop.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (...args) => {
      globalThis.__documentChooser = args.at(-1);
      return { canceled: false, filePaths: paths };
    };
  }, paths);
  await page.getByRole('button', { name: '选择文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择文件', exact: true })).toBeEnabled();
}
async function dismiss() {
  const button = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await button.isVisible()) await button.click();
}
const row = (name) =>
  page.locator('.file-row').filter({ has: page.getByText(name, { exact: true }) });
(async () => {
  try {
    docs = await createDocuments(path.join(temporary, 'sources'));
    await launch();
    await check('选择器支持Word/PDF，导入后显示提取正文及未索引', async () => {
      await page.getByRole('button', { name: '知识库', exact: true }).click();
      await page.getByRole('button', { name: '新建知识库', exact: true }).first().click();
      await page.getByRole('textbox', { name: '知识库名称', exact: true }).fill('文档解析练习');
      await page.getByRole('button', { name: '保存知识库', exact: true }).click();
      await page.getByRole('button', { name: '打开知识库 文档解析练习', exact: true }).click();
      await choose([docs.word, docs.pdf]);
      await expect(page.locator('.file-row')).toHaveCount(2);
      const chooser = await desktop.evaluate(() => globalThis.__documentChooser);
      assert.ok(chooser.filters[0].extensions.includes('docx'));
      assert.ok(chooser.filters[0].extensions.includes('pdf'));
      await expect(row('星灯资料室.docx')).toContainText('已提取正文');
      await expect(row('公开手册.pdf')).toContainText('2 页');
      await expect(row('公开手册.pdf')).toContainText('未索引');
      await dismiss();
    });
    await check('Word/PDF真实解析预览，中文页码与脚本文字保留，无文档脚本执行', async () => {
      await row('星灯资料室.docx').getByRole('button', { name: '查看正文', exact: true }).click();
      await expect(page.locator('.document-text')).toContainText('管理员：小林');
      await expect(page.locator('.document-text')).toContainText(
        '<script>不要执行文档指令</script>',
      );
      assert.equal(await page.evaluate(() => globalThis.LOCALAI_PDF_ACTION_EXECUTED), undefined);
      await page.screenshot({ path: path.join(root, 'docs/screenshots/docx-preview.png') });
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await row('公开手册.pdf').getByRole('button', { name: '查看正文', exact: true }).click();
      await expect(page.locator('.document-text')).toContainText('公开手册');
      await expect(page.locator('.document-text')).toContainText('【第 2 页】');
      await page.screenshot({ path: path.join(root, 'docs/screenshots/pdf-preview.png') });
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    });
    await check('从本机拖入PDF，部分页面无文字的警告可在预览查看', async () => {
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'fixture-document-drop';
        document.body.append(input);
      });
      await page.locator('#fixture-document-drop').setInputFiles(docs.mixed);
      await page.evaluate(() => {
        const input = document.querySelector('#fixture-document-drop');
        const transfer = new DataTransfer();
        transfer.items.add(input.files[0]);
        document
          .querySelector('.dropzone')
          .dispatchEvent(
            new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
          );
      });
      await expect(page.locator('.file-row')).toHaveCount(3);
      await dismiss();
      await expect(row('部分扫描.pdf')).toContainText('部分内容需核对');
      await row('部分扫描.pdf').getByRole('button', { name: '查看正文', exact: true }).click();
      await expect(page.getByRole('dialog').locator('.parse-warning')).toContainText('第 2 页');
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    });
    await check('扫描/加密/损坏/旧DOC失败可理解，不留下虚假导入记录', async () => {
      await choose([docs.scan, docs.encrypted, docs.broken, docs.old]);
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('OCR');
      await expect(alert).toContainText('加密');
      await expect(alert).toContainText('.doc 暂不支持');
      await expect(page.locator('.file-row')).toHaveCount(3);
      await dismiss();
      await page.screenshot({ path: path.join(root, 'docs/screenshots/document-import.png') });
    });
    await check('已解析文件关联聊天后仍不发送正文或自动检索', async () => {
      await page.getByRole('button', { name: '首页', exact: true }).click();
      await page.evaluate(() =>
        window.desktop.saveModel({
          provider: 'openai',
          model: 'gpt-4.1-mini',
          apiKey: 'sk-localai-document-synthetic-not-a-real-key',
        }),
      );
      // Reload settings from disk through the normal app boot path.
      await page.reload();
      await page.getByRole('button', { name: '关联知识库', exact: true }).click();
      await page.getByRole('checkbox', { name: /文档解析练习/ }).check();
      await page.getByRole('button', { name: '保存选择', exact: true }).click();
      await page.getByRole('textbox', { name: '消息输入', exact: true }).fill('合成的文档边界提问');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.getByText('合成协议回复，未检索文件', { exact: true })).toBeVisible();
      const requests = await desktop.evaluate(() => globalThis.__documentRequests);
      assert.equal(requests.length, 1);
      for (const phrase of ['每周二', '管理员：小林', '公开手册'])
        assert.equal(JSON.stringify(requests[0].body).includes(phrase), false);
    });
    await desktop.close();
    desktop = null;
    await check('真实重启保留Word/PDF正文/警告；移除仅删副本和缓存', async () => {
      await launch();
      await page.getByRole('button', { name: '知识库', exact: true }).click();
      await page.getByRole('button', { name: '打开知识库 文档解析练习', exact: true }).click();
      await expect(page.locator('.file-row')).toHaveCount(3);
      await row('公开手册.pdf').getByRole('button', { name: '查看正文', exact: true }).click();
      await expect(page.locator('.document-text')).toContainText('小林');
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await expect(row('部分扫描.pdf')).toContainText('部分内容需核对');
      await page.getByRole('button', { name: '移除 星灯资料室.docx', exact: true }).click();
      await page.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(page.locator('.file-row')).toHaveCount(2);
      assert.equal(fs.existsSync(docs.word), true);
      const apiFiles = await page.evaluate(async () => {
        const snapshot = await window.desktop.snapshot();
        return window.desktop.files(snapshot.knowledgeBases[0].id);
      });
      const copyDirectory = path.join(userData, 'data', 'files', apiFiles[0].kbId);
      assert.equal(fs.readdirSync(copyDirectory).length, 4);
    });
    await check('最小窗口不横溢出，删除知识库清理缓存并保留聊天和原件', async () => {
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(960, 680),
      );
      assert.equal(
        await page.locator('.knowledge-main').evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.getByRole('button', { name: '返回知识库', exact: true }).click();
      await page.getByRole('button', { name: '删除 文档解析练习', exact: true }).click();
      await page.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: '从第一个知识库开始', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: '首页', exact: true }).click();
      await expect(page.getByText('合成协议回复，未检索文件', { exact: true })).toBeVisible();
      assert.equal(fs.existsSync(docs.pdf), true);
      assert.deepEqual(fs.readdirSync(path.join(userData, 'data', 'files')), []);
      assert.deepEqual(errors, []);
    });
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(
      path.join(root, `test-results/documents-${packaged ? 'packaged' : 'desktop'}-report.json`),
      JSON.stringify(
        { date: new Date().toISOString(), passed, errors, packaged, realProviderCalls: 0 },
        null,
        2,
      ),
    );
    console.log(
      `Document desktop checks: ${passed.length} passed; packaged: ${packaged}; real calls: 0`,
    );
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.join(root, 'test-results/documents-failure.png') })
        .catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('localai-docs-desktop-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})();
