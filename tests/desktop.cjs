const { _electron: electron, expect } = require('playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-desktop-'));
const data = path.join(temporary, 'appdata');
const screenshots = path.join(root, 'docs', 'screenshots');
const results = path.join(root, 'test-results');
fs.mkdirSync(screenshots, { recursive: true });
fs.mkdirSync(results, { recursive: true });
const source = path.join(temporary, 'RAG 学习笔记.md');
const text =
  '# RAG 学习笔记\n\n本文件为合成验收资料，不含个人数据。\n\n检索增强生成：先找到相关资料，再根据资料组织回答。\n本版尚未实现向量化或检索。\n\n<script>window.__documentExecuted = true</script>\n不要执行文档里的指令。';
fs.writeFileSync(source, text);
const unsupported = path.join(temporary, '不支持的格式.doc');
fs.writeFileSync(unsupported, 'synthetic');
let desktop, page;
const passed = [],
  errors = [];
async function check(name, action) {
  await action();
  passed.push(name);
  console.log(`PASS ${name}`);
}
async function launch() {
  const env = { ...process.env, LOCALAI_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({ args: [root], env, timeout: 30000 });
  page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.getByRole('heading', { name: '你好，我是 LocalAI' }).waitFor();
}
async function create(name, description = '') {
  await page.getByRole('button', { name: '新建知识库', exact: true }).first().click();
  await page.getByRole('textbox', { name: '知识库名称', exact: true }).fill(name);
  await page.getByRole('textbox', { name: '知识库简介', exact: true }).fill(description);
  await page.getByRole('button', { name: '保存知识库', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function dismissNotice() {
  const button = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await button.isVisible()) await button.click();
}
(async () => {
  try {
    await launch();
    await check('独立 Electron 窗口、默认首页与离线状态', async () => {
      assert.match(page.url(), /^file:\/\//);
      await expect(page.getByText('演示模式 · 模型未接入')).toBeVisible();
      assert.equal(
        await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
        1,
      );
    });
    await check('无 Node 权限、隔离与沙箱', async () => {
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      const prefs = await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
      );
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.sandbox, true);
      assert.equal(prefs.nodeIntegration, false);
    });
    await dismissNotice();
    await page.screenshot({ path: path.join(screenshots, 'home.png') });
    await page.getByRole('button', { name: '知识库', exact: true }).click();
    await check('知识库导航与空状态', async () => {
      await expect(page.getByRole('heading', { name: '从第一个知识库开始' })).toBeVisible();
    });
    await check('空名称有清晰提示', async () => {
      await page.getByRole('button', { name: '新建知识库', exact: true }).first().click();
      await page.getByRole('button', { name: '保存知识库', exact: true }).click();
      await expect(page.getByText('请填写知识库名称', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '取消', exact: true }).click();
    });
    await check('创建个人知识库', async () => {
      await create('RAG 学习笔记', '从零开始的检索与评估练习');
      await expect(
        page.getByRole('button', { name: '打开知识库 RAG 学习笔记', exact: true }),
      ).toBeVisible();
    });
    await check('按简介搜索、无结果、清空搜索', async () => {
      await page.getByRole('textbox', { name: '搜索知识库' }).fill('检索与评估');
      await expect(
        page.getByRole('button', { name: '打开知识库 RAG 学习笔记', exact: true }),
      ).toBeVisible();
      await page.getByRole('textbox', { name: '搜索知识库' }).fill('不存在的关键词');
      await expect(page.getByRole('heading', { name: '没有找到匹配的知识库' })).toBeVisible();
      await page.getByRole('button', { name: '清空搜索', exact: true }).first().click();
      await expect(
        page.getByRole('button', { name: '打开知识库 RAG 学习笔记', exact: true }),
      ).toBeVisible();
    });
    await check('编辑知识库', async () => {
      await page.getByRole('button', { name: '编辑 RAG 学习笔记', exact: true }).click();
      await page
        .getByRole('textbox', { name: '知识库简介', exact: true })
        .fill('从零开始：文档、检索与评估');
      await page.getByRole('button', { name: '保存知识库', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await expect(page.getByText('从零开始：文档、检索与评估', { exact: true })).toBeVisible();
    });
    await check('通用类型跟随标签且仅为本地分类', async () => {
      await page.getByRole('tab', { name: /通用知识库/ }).click();
      await page.getByRole('button', { name: '新建知识库', exact: true }).first().click();
      await expect(page.getByRole('radio', { name: /通用知识库/ })).toBeChecked();
      await page.getByRole('textbox', { name: '知识库名称', exact: true }).fill('公开术语手册');
      await page
        .getByRole('textbox', { name: '知识库简介', exact: true })
        .fill('本机整理的公共参考资料');
      await page.getByRole('button', { name: '保存知识库', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await expect(
        page.getByText('在本机整理公共参考资料。不会自动公开、联网搜索或预置行业资料。'),
      ).toBeVisible();
    });
    await page.getByRole('tab', { name: /个人知识库/ }).click();
    await check('文件详情、选择导入、正文与未索引状态', async () => {
      await page.getByRole('button', { name: '打开知识库 RAG 学习笔记', exact: true }).click();
      // Stub only the native chooser result; button, preload, IPC, validation and disk copy are real.
      await desktop.evaluate(({ dialog }, source) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
      }, source);
      await page.getByRole('button', { name: '选择文件', exact: true }).click();
      await expect(page.getByText('已导入 · 未索引', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '查看正文', exact: true }).click();
      await expect(page.locator('.document-text')).toContainText('检索增强生成');
      await expect(page.locator('.document-text')).toContainText('<script>');
      assert.equal(await page.evaluate(() => window.__documentExecuted), undefined);
      await dismissNotice();
      await page.screenshot({ path: path.join(screenshots, 'document.png') });
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    });
    await check('拒绝未支持格式并显示具体提示', async () => {
      await desktop.evaluate(({ dialog }, unsupported) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [unsupported] });
      }, unsupported);
      await page.getByRole('button', { name: '选择文件', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('旧版 Word .doc 暂不支持');
      await dismissNotice();
    });
    await check('拖入真实本机文件、同名文件副本不覆盖', async () => {
      // A test-only input supplies Chromium with a real File, including its native path.
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'test-real-file';
        input.hidden = true;
        document.body.append(input);
      });
      await page.locator('#test-real-file').setInputFiles(source);
      await page.evaluate(() => {
        const input = document.querySelector('#test-real-file');
        const transfer = new DataTransfer();
        transfer.items.add(input.files[0]);
        document
          .querySelector('.dropzone')
          .dispatchEvent(
            new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
          );
        input.remove();
      });
      await expect(page.getByText('已导入 · 未索引', { exact: true })).toHaveCount(2);
      assert.equal(fs.readFileSync(source, 'utf8'), text);
    });
    await check('移除文件前确认、取消保留、确认后只移除副本', async () => {
      await page.getByRole('button', { name: '移除 RAG 学习笔记.md', exact: true }).first().click();
      await expect(page.getByRole('dialog')).toContainText('不会删除你导入前的原始文件');
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByText('已导入 · 未索引', { exact: true })).toHaveCount(2);
      await page.getByRole('button', { name: '移除 RAG 学习笔记.md', exact: true }).first().click();
      await page.getByRole('button', { name: '确认删除', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await expect(page.getByText('已导入 · 未索引', { exact: true })).toHaveCount(1);
      assert.equal(fs.readFileSync(source, 'utf8'), text);
    });
    await dismissNotice();
    await page.screenshot({ path: path.join(screenshots, 'knowledge-detail.png') });
    await page.getByRole('button', { name: '返回知识库', exact: true }).click();
    await check('知识库卡片文件数量更新', async () => {
      await expect(page.getByText('1 个文件', { exact: true })).toBeVisible();
    });
    await page.screenshot({ path: path.join(screenshots, 'knowledge.png') });
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await check('草稿在关联知识库后保留，多选关联可保存', async () => {
      await page
        .getByRole('textbox', { name: '消息输入', exact: true })
        .fill('我的第一条 RAG 学习记录');
      await page.getByRole('button', { name: '关联知识库', exact: true }).click();
      await page.getByRole('checkbox', { name: /RAG 学习笔记/ }).check();
      await page.getByRole('checkbox', { name: /公开术语手册/ }).check();
      await page.getByRole('button', { name: '保存选择', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await expect(page.getByRole('textbox', { name: '消息输入', exact: true })).toHaveValue(
        '我的第一条 RAG 学习记录',
      );
      await expect(
        page.getByRole('button', { name: '已关联 2 个知识库', exact: true }),
      ).toBeVisible();
    });
    await check('发送、演示标注、本地历史标题', async () => {
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.getByText('演示回复 · 未检索', { exact: true })).toBeVisible();
      await expect(page.locator('.message-content')).toHaveCount(2);
      await expect(page.locator('.history-item')).toContainText('我的第一条 RAG 学习记录');
    });
    await check('新建、切换对话，草稿和历史互相独立', async () => {
      await page.getByRole('button', { name: '新建对话', exact: true }).click();
      await page.getByRole('textbox', { name: '消息输入', exact: true }).fill('第二个对话的问题');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.locator('.message-content').first()).toHaveText('第二个对话的问题');
      await page.locator('.history-item').filter({ hasText: '我的第一条 RAG 学习记录' }).click();
      await expect(page.locator('.message-content').first()).toHaveText('我的第一条 RAG 学习记录');
      await expect(
        page.getByRole('button', { name: '已关联 2 个知识库', exact: true }),
      ).toBeVisible();
    });
    await dismissNotice();
    await page.screenshot({ path: path.join(screenshots, 'chat.png') });
    await check('网络请求被 CSP 或主进程拦截', async () => {
      assert.equal(
        await page.evaluate(async () => {
          try {
            await fetch('https://example.com');
            return false;
          } catch {
            return true;
          }
        }),
        true,
      );
    });
    await check('保存失败时弹窗内有错误提示且不关闭表单', async () => {
      await page.getByRole('button', { name: '知识库', exact: true }).click();
      await page.getByRole('button', { name: '新建知识库', exact: true }).first().click();
      await page.getByRole('textbox', { name: '知识库名称', exact: true }).fill('失败注入');
      await desktop.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('knowledge:save');
        ipcMain.handle('knowledge:save', () => ({ ok: false, error: '测试保存失败：磁盘不可写' }));
      });
      await page.getByRole('button', { name: '保存知识库', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('测试保存失败');
      await expect(page.getByRole('textbox', { name: '知识库名称', exact: true })).toHaveValue(
        '失败注入',
      );
      await dismissNotice();
      await page.getByRole('button', { name: '取消', exact: true }).click();
    });
    await desktop.close();
    desktop = null;
    await check('退出再启动：聊天、关联、知识库、文件副本持久保留', async () => {
      // Reopen the real application against the same isolated on-disk data.
      const env = { ...process.env, LOCALAI_TEST_DATA: data };
      delete env.ELECTRON_RUN_AS_NODE;
      desktop = await electron.launch({ args: [root], env });
      page = await desktop.firstWindow();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.locator('.history-item').filter({ hasText: '我的第一条 RAG 学习记录' }).waitFor();
      await page.locator('.history-item').filter({ hasText: '我的第一条 RAG 学习记录' }).click();
      await expect(page.locator('.message-content').first()).toHaveText('我的第一条 RAG 学习记录');
      await expect(
        page.getByRole('button', { name: '已关联 2 个知识库', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: '知识库', exact: true }).click();
      await page.getByRole('button', { name: '打开知识库 RAG 学习笔记', exact: true }).click();
      await page.getByRole('button', { name: '查看正文', exact: true }).click();
      await expect(page.locator('.document-text')).toHaveText(text);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page.getByRole('button', { name: '返回知识库', exact: true }).click();
    });
    await check('知识库删除确认、级联副本与关联、保留对话与原文件', async () => {
      await page.getByRole('button', { name: '删除 RAG 学习笔记', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('1 个已导入文件副本');
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '打开知识库 RAG 学习笔记', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: '删除 RAG 学习笔记', exact: true }).click();
      await page.getByRole('button', { name: '确认删除', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await expect(
        page.getByRole('button', { name: '打开知识库 RAG 学习笔记', exact: true }),
      ).toHaveCount(0);
      await page.getByRole('button', { name: '首页', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '已关联 1 个知识库', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.message-content')).toHaveCount(2);
      assert.equal(fs.readFileSync(source, 'utf8'), text);
    });
    await check('最小窗口布局无横向溢出', async () => {
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(960, 680),
      );
      await page.getByRole('button', { name: '知识库', exact: true }).click();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(
        await page.evaluate(() => {
          const el = document.querySelector('.knowledge-main');
          return el.scrollWidth <= el.clientWidth;
        }),
        true,
      );
      await page.screenshot({ path: path.join(results, 'minimum-size.png') });
    });
    await check('无渲染进程未捕获异常', async () => assert.deepEqual(errors, []));
    fs.writeFileSync(
      path.join(results, 'desktop-report.json'),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          passed,
          errors,
          dataIsolation: 'temporary test directory; synthetic documents only',
          chooser:
            'native chooser result mocked; file copies, IPC, disk persistence and drag/drop use real files',
        },
        null,
        2,
      ),
    );
    console.log(`Desktop checks: ${passed.length} passed`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    // Only this exact test-created temporary directory is removed.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})();
