const { _electron: electron, expect } = require('playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Store } = require('../dist-electron/electron/store');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-api-desktop-'));
const userData = path.join(temporary, 'userdata');
const data = path.join(userData, 'data');
const KEY = 'sk-localai-synthetic-fixture-not-a-real-key';
const KEY2 = KEY + '-openai';
const source = path.join(temporary, 'fixture.md');
fs.writeFileSync(source, 'LOCALAI_DOCUMENT_MUST_NOT_BE_SENT');
const seeded = new Store(data);
seeded.saveKnowledge({ name: '合成测试资料', description: 'API边界测试', type: 'personal' });
const kb = seeded.knowledge()[0];

let desktop, page;
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
  desktop = await electron.launch({ args: [root], env });
  page = await desktop.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '设置', exact: true }).waitFor();
  await desktop.evaluate(({ session }) => {
    globalThis.__modelFixture = { mode: 'ok', requests: [] };
    session.fromPartition('localai-model-api').fetch = async (url, init) => {
      const state = globalThis.__modelFixture;
      state.requests.push({
        url,
        method: init.method,
        body: init.body ? JSON.parse(init.body) : undefined,
        authCorrect: init.headers.Authorization.startsWith(
          'Bearer sk-localai-synthetic-fixture-not-a-real-key',
        ),
      });
      if (state.mode === 'pending')
        return new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('fixture abort')), {
            once: true,
          }),
        );
      if (state.mode === '401')
        return new Response('untrusted response body should be hidden', { status: 401 });
      if (init.method === 'GET')
        return new Response(
          JSON.stringify({
            data: (url.includes('openai.com')
              ? [
                  'gpt-4.1-mini',
                  'gpt-6-luna',
                  'gpt-6.1-sol',
                  'gpt-image-1',
                  'text-embedding-3-small',
                ]
              : ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-account-model']
            ).map((id) => ({ id })),
          }),
        );
      if (url.includes('openai.com'))
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              { type: 'reasoning' },
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'OpenAI 协议模拟回复' }],
              },
            ],
          }),
        );
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'DeepSeek 协议模拟回复' }, finish_reason: 'stop' }],
        }),
      );
    };
  });
}
const count = () => desktop.evaluate(() => globalThis.__modelFixture.requests.length);
async function settings() {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('dialog').waitFor();
}
async function picker() {
  await page.getByRole('button', { name: '模型与推理设置', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
}
async function dismiss() {
  const button = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await button.isVisible()) await button.click();
}
(async () => {
  try {
    await seeded.importFiles(kb.id, [source]);
    seeded.close();
    await launch();
    await check('同一按钮再次点击收起、连续切换和键盘开关，两层都可收起', async () => {
      const button = page.getByRole('button', { name: '模型与推理设置', exact: true });
      for (let i = 0; i < 3; i++) {
        await button.click();
        await expect(page.getByRole('dialog', { name: '推理与速度', exact: true })).toBeVisible();
        await button.click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      await button.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await button.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await button.press('Space');
      await page.getByRole('button', { name: '选择模型', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '选择模型', exact: true })).toBeVisible();
      await button.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await button.click();
      await expect(page.getByRole('dialog', { name: '推理与速度', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      assert.equal(await count(), 0);
    });
    await check('聊天区选择器未配置时禁止选择，无自动联网', async () => {
      await picker();
      await expect(
        page.getByRole('button', { name: '使用 DeepSeek · deepseek-flash', exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: '刷新 OpenAI 模型', exact: true }),
      ).toBeDisabled();
      assert.equal(await count(), 0);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    });
    await check('默认不联网、设置可见、密码输入与计费说明', async () => {
      assert.equal(await count(), 0);
      await settings();
      await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('deepseek-flash');
      assert.equal(
        await page.locator('input[aria-label="API Key"]').getAttribute('type'),
        'password',
      );
      await expect(page.getByText(/保存只写入本机，不发请求/)).toBeVisible();
      await page.getByRole('button', { name: '保存并启用', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请先粘贴');
      await dismiss();
    });
    await check('测试使用输入的合成密钥，不保存、不带用户资料', async () => {
      await page.getByLabel('API Key', { exact: true }).fill(KEY);
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(page.locator('.settings-result')).toContainText('连接成功');
      assert.equal(await count(), 1);
      const view = await page.evaluate(() => window.desktop.modelSettings());
      assert.equal(view.providers.deepseek.hasKey, false);
      const request = await desktop.evaluate(() => globalThis.__modelFixture.requests[0]);
      assert.equal(request.authCorrect, true);
      assert.equal(
        JSON.stringify(request.body).includes('LOCALAI_DOCUMENT_MUST_NOT_BE_SENT'),
        false,
      );
    });
    await check('保存启用不额外调用、真实系统加密、不回读Key', async () => {
      await page.getByRole('button', { name: '保存并启用', exact: true }).click();
      await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
      await expect(page.locator('.settings-current')).toContainText('DeepSeek');
      assert.equal(await count(), 1);
      const saved = fs.readFileSync(path.join(data, 'model-settings.json'), 'utf8');
      assert.equal(saved.includes(KEY), false);
      assert.ok(JSON.parse(saved).providers.deepseek.encryptedKey);
      assert.equal(
        JSON.stringify(await page.evaluate(() => window.desktop.modelSettings())).includes(
          'encryptedKey',
        ),
        false,
      );
      fs.mkdirSync(path.join(root, 'docs/screenshots'), { recursive: true });
      await page.screenshot({
        path: path.join(root, 'docs/screenshots/model-settings-deepseek.png'),
      });
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    });
    await check('关联知识库后的真实调用路径，不读取或发送文件正文', async () => {
      await page.getByRole('button', { name: '关联知识库', exact: true }).click();
      await page.getByRole('checkbox', { name: /合成测试资料/ }).check();
      await page.getByRole('button', { name: '保存选择', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('textbox', { name: '消息输入', exact: true }).fill('合成提问一');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.getByText('DeepSeek 协议模拟回复', { exact: true })).toBeVisible();
      await expect(page.locator('.model-message-label')).toContainText('deepseek-flash');
      await expect(page.getByText('演示回复 · 未检索', { exact: true })).toHaveCount(0);
      const req = await desktop.evaluate(() => globalThis.__modelFixture.requests.at(-1));
      assert.equal(JSON.stringify(req.body).includes('LOCALAI_DOCUMENT_MUST_NOT_BE_SENT'), false);
      assert.equal('kbIds' in req.body, false);
    });
    await check('OpenAI 单独保存、订阅说明与 Responses 正文显示', async () => {
      await settings();
      await page.getByRole('tab', { name: /OpenAI/ }).click();
      await expect(page.getByText(/ChatGPT 订阅与 API 分开计费/)).toBeVisible();
      await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
      await page.getByLabel('API Key', { exact: true }).fill(KEY2);
      await page.getByRole('button', { name: '保存并启用', exact: true }).click();
      await expect(page.locator('.settings-current')).toContainText('gpt-4.1-mini');
      await page.screenshot({
        path: path.join(root, 'docs/screenshots/model-settings-openai.png'),
      });
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page.getByRole('textbox', { name: '消息输入', exact: true }).fill('合成提问二');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.getByText('OpenAI 协议模拟回复', { exact: true })).toBeVisible();
      await expect(page.locator('.model-message-label').last()).toContainText(
        'OpenAI · gpt-4.1-mini',
      );
      const req = await desktop.evaluate(() => globalThis.__modelFixture.requests.at(-1));
      assert.equal(req.body.store, false);
    });
    await check('两层浮窗、返回和Escape可用；4.1不显示虚假推理档或加速', async () => {
      await page.getByRole('textbox', { name: '消息输入', exact: true }).fill('切换时保留的草稿');
      const before = await count();
      await page.getByRole('button', { name: '模型与推理设置', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '推理与速度', exact: true })).toBeVisible();
      await expect(page.getByRole('slider', { name: '推理强度', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '快速模式', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '选择模型', exact: true }).click();
      await page.getByRole('button', { name: '返回推理设置', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '推理与速度', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '消息输入', exact: true })).toHaveValue(
        '切换时保留的草稿',
      );
      assert.equal(await count(), before);
    });
    await check('OpenAI推理滑杆/档位与快速开关真实映射请求，配置操作不联网', async () => {
      await picker();
      await page.getByRole('button', { name: '使用 OpenAI · gpt-6.1-sol', exact: true }).click();
      await page.getByRole('button', { name: '模型与推理设置', exact: true }).click();
      await expect(page.getByRole('slider', { name: '推理强度', exact: true })).toHaveAttribute(
        'max',
        '4',
      );
      const before = await count();
      await page.getByRole('slider', { name: '推理强度', exact: true }).focus();
      await page.keyboard.press('End');
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop.modelSettings())).providers.openai.inference[
              'gpt-6.1-sol'
            ]?.effort,
        )
        .toBe('max');
      await page.getByRole('button', { name: '推理强度：高', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop.modelSettings())).providers.openai.inference[
              'gpt-6.1-sol'
            ]?.effort,
        )
        .toBe('high');
      await page.getByRole('button', { name: '快速模式', exact: true }).click();
      await expect(page.getByRole('button', { name: '快速模式', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: '快速模式', exact: true })).toHaveAttribute(
        'title',
        /费用高于标准/,
      );
      assert.equal(await count(), before);
      await page.screenshot({ path: path.join(root, 'docs/screenshots/model-tuning.png') });
      await page
        .getByRole('dialog', { name: '推理与速度', exact: true })
        .screenshot({ path: path.join(root, 'docs/screenshots/model-tuning-detail.png') });
      await page.keyboard.press('Escape');
      await page
        .getByRole('textbox', { name: '消息输入', exact: true })
        .fill('高强度快速模式的合成提问');
      const messages = await page.locator('.message-content').count();
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.locator('.message-content')).toHaveCount(messages + 2);
      const request = await desktop.evaluate(() => globalThis.__modelFixture.requests.at(-1));
      assert.equal(request.body.model, 'gpt-6.1-sol');
      assert.deepEqual(request.body.reasoning, { effort: 'high' });
      assert.equal(request.body.service_tier, 'fast');
      assert.equal(await count(), before + 1);
    });
    await check('按模型独立记忆及恢复默认，不把快速档带给其他模型', async () => {
      await picker();
      await page.getByRole('button', { name: '使用 OpenAI · gpt-6-luna', exact: true }).click();
      await page.getByRole('button', { name: '模型与推理设置', exact: true }).click();
      await expect(page.getByRole('button', { name: '快速模式', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await page.getByRole('button', { name: '推理强度：关闭', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop.modelSettings())).providers.openai.inference[
              'gpt-6-luna'
            ]?.effort,
        )
        .toBe('none');
      await page.getByRole('button', { name: '恢复推理与速度默认值', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop.modelSettings())).providers.openai.inference[
              'gpt-6-luna'
            ]?.effort,
        )
        .toBe('low');
      const settings = await page.evaluate(() => window.desktop.modelSettings());
      assert.deepEqual(settings.providers.openai.inference['gpt-6.1-sol'], {
        effort: 'high',
        speed: 'fast',
      });
      await page.keyboard.press('Escape');
    });
    await check('DeepSeek思考档位映射正确、快速不可用，不发送OpenAI专有参数', async () => {
      await picker();
      await page
        .getByRole('button', { name: '使用 DeepSeek · deepseek-v4-pro', exact: true })
        .click();
      await page.getByRole('button', { name: '模型与推理设置', exact: true }).click();
      await expect(page.getByRole('button', { name: '快速模式', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '推理强度：高', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop.modelSettings())).providers.deepseek
              .inference['deepseek-v4-pro']?.effort,
        )
        .toBe('high');
      await page.keyboard.press('Escape');
      await page
        .getByRole('textbox', { name: '消息输入', exact: true })
        .fill('DeepSeek思考参数的合成提问');
      const messages = await page.locator('.message-content').count();
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.locator('.message-content')).toHaveCount(messages + 2);
      const request = await desktop.evaluate(() => globalThis.__modelFixture.requests.at(-1));
      assert.equal(request.body.thinking.type, 'enabled');
      assert.equal(request.body.reasoning_effort, 'high');
      assert.equal('service_tier' in request.body, false);
      await picker();
      await page.getByRole('button', { name: '使用 OpenAI · gpt-4.1-mini', exact: true }).click();
    });
    await check('鉴权失败保留草稿，不写入假回答、不回退演示', async () => {
      await desktop.evaluate(() => (globalThis.__modelFixture.mode = '401'));
      await page
        .getByRole('textbox', { name: '消息输入', exact: true })
        .fill('失败后应保留的合成问题');
      const before = await page.locator('.message-content').count();
      const requests = await count();
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('HTTP 401');
      await expect(page.getByRole('textbox', { name: '消息输入', exact: true })).toHaveValue(
        '失败后应保留的合成问题',
      );
      assert.equal(await page.locator('.message-content').count(), before);
      assert.equal(await count(), requests + 1);
      assert.equal(
        (await page.getByRole('alert').innerText()).includes('untrusted response'),
        false,
      );
      await dismiss();
    });
    await check('停止生成取消请求，保留草稿且不写入新消息', async () => {
      await desktop.evaluate(() => (globalThis.__modelFixture.mode = 'pending'));
      const before = await page.locator('.message-content').count();
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await page.getByRole('button', { name: '停止生成', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('取消');
      await expect(page.getByRole('textbox', { name: '消息输入', exact: true })).toBeEnabled();
      assert.equal(await page.locator('.message-content').count(), before);
      await dismiss();
      await desktop.evaluate(() => (globalThis.__modelFixture.mode = 'ok'));
    });
    await check('聊天区切换厂商及模型离线完成，草稿和原回复标签保留', async () => {
      const requests = await count();
      const draft = await page.getByRole('textbox', { name: '消息输入', exact: true }).inputValue();
      await picker();
      await page
        .getByRole('button', { name: '使用 DeepSeek · deepseek-v4-pro', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '模型与推理设置', exact: true })).toContainText(
        'deepseek-v4-pro',
      );
      await expect(page.getByRole('textbox', { name: '消息输入', exact: true })).toHaveValue(draft);
      await expect(page.locator('.model-message-label').first()).toContainText('deepseek-flash');
      await expect(page.locator('.model-message-label').nth(1)).toContainText('gpt-4.1-mini');
      assert.equal(await count(), requests);
      const before = await page.locator('.message-content').count();
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.locator('.message-content')).toHaveCount(before + 2);
      await expect(page.locator('.model-message-label').last()).toContainText('deepseek-v4-pro');
      const request = await desktop.evaluate(() => globalThis.__modelFixture.requests.at(-1));
      assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
      assert.equal(request.body.model, 'deepseek-v4-pro');
      assert.equal(await count(), requests + 1);
    });
    await check('刷新两家目录只GET元数据，模型过滤、搜索及列表截图', async () => {
      await picker();
      const before = await count();
      const active = await page.evaluate(() => window.desktop.modelSettings());
      await page.getByRole('button', { name: '刷新 DeepSeek 模型', exact: true }).click();
      await expect(page.locator('.settings-result')).toContainText('3 个');
      await page.getByRole('button', { name: '刷新 OpenAI 模型', exact: true }).click();
      await expect(page.locator('.settings-result')).toContainText('3 个');
      assert.equal(await count(), before + 2);
      const requests = await desktop.evaluate(() => globalThis.__modelFixture.requests.slice(-2));
      for (const request of requests) {
        assert.equal(request.method, 'GET');
        assert.equal(request.body, undefined);
      }
      const updated = await page.evaluate(() => window.desktop.modelSettings());
      assert.equal(updated.active, active.active);
      assert.equal(updated.providers.deepseek.model, active.providers.deepseek.model);
      await expect(
        page.getByRole('button', { name: '使用 OpenAI · gpt-image-1', exact: true }),
      ).toHaveCount(0);
      await page.getByLabel('搜索模型', { exact: true }).fill('gpt-6.1-sol');
      await expect(page.locator('.model-choice')).toHaveCount(1);
      await page.getByLabel('搜索模型', { exact: true }).fill('');
      await page.screenshot({ path: path.join(root, 'docs/screenshots/model-picker.png') });
      await page.getByRole('button', { name: '使用 OpenAI · gpt-6-luna', exact: true }).click();
    });
    await check('同一家不同模型每次仅发一个请求，记录准确来源与历史', async () => {
      await page
        .getByRole('textbox', { name: '消息输入', exact: true })
        .fill('切换模型后的合成提问');
      const requests = await count();
      const before = await page.locator('.message-content').count();
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.locator('.message-content')).toHaveCount(before + 2);
      await expect(page.locator('.model-message-label').last()).toContainText(
        'OpenAI · gpt-6-luna',
      );
      const req = await desktop.evaluate(() => globalThis.__modelFixture.requests.at(-1));
      assert.equal(req.url, 'https://api.openai.com/v1/responses');
      assert.equal(req.body.model, 'gpt-6-luna');
      assert.ok(
        req.body.input.some(
          (item) => item.role === 'assistant' && item.content === 'DeepSeek 协议模拟回复',
        ),
      );
      assert.equal(await count(), requests + 1);
    });
    await check('手填模型验证及保存，刷新失败不丢缓存或选择', async () => {
      await picker();
      await page.getByText('手动添加与使用说明', { exact: true }).click();
      await page.getByLabel('手动模型服务商', { exact: true }).selectOption('openai');
      await page.getByLabel('手动模型名称', { exact: true }).fill('invalid model');
      await page.getByRole('button', { name: '使用', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('模型名称');
      await dismiss();
      await page.getByLabel('手动模型名称', { exact: true }).fill('gpt-custom-fixture');
      const requests = await count();
      await page.getByRole('button', { name: '使用', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      assert.equal(await count(), requests);
      await picker();
      await expect(
        page.getByRole('button', { name: '使用 OpenAI · gpt-custom-fixture', exact: true }),
      ).toBeVisible();
      const before = await page.evaluate(() => window.desktop.modelSettings());
      await desktop.evaluate(() => (globalThis.__modelFixture.mode = '401'));
      await page.getByRole('button', { name: '刷新 OpenAI 模型', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('HTTP 401');
      assert.deepEqual(await page.evaluate(() => window.desktop.modelSettings()), before);
      await dismiss();
      await desktop.evaluate(() => (globalThis.__modelFixture.mode = 'ok'));
      await page.getByRole('button', { name: '使用 OpenAI · gpt-4.1-mini', exact: true }).click();
    });
    await desktop.close();
    desktop = null;
    await check('重启后服务选择、两家加密Key、模型及真实回复标签保留', async () => {
      await launch();
      await expect(page.locator('.status-pill')).toContainText('OpenAI · gpt-4.1-mini');
      await expect(page.getByText('OpenAI 协议模拟回复', { exact: true }).first()).toBeVisible();
      assert.equal(await count(), 0);
      await picker();
      await expect(
        page.getByRole('button', { name: '使用 OpenAI · gpt-custom-fixture', exact: true }),
      ).toBeVisible();
      const remembered = await page.evaluate(() => window.desktop.modelSettings());
      assert.deepEqual(
        remembered.providers.openai.catalog,
        ['gpt-4.1-mini', 'gpt-6-luna', 'gpt-6.1-sol'].sort(),
      );
      assert.equal(await count(), 0);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await picker();
      await page.getByRole('button', { name: '使用 OpenAI · gpt-6.1-sol', exact: true }).click();
      await page.getByRole('button', { name: '模型与推理设置', exact: true }).click();
      await expect(page.getByRole('button', { name: '推理强度：高', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: '快速模式', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      assert.equal(await count(), 0);
      await page.keyboard.press('Escape');
      await picker();
      await page.getByRole('button', { name: '使用 OpenAI · gpt-4.1-mini', exact: true }).click();
      await settings();
      await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
      const view = await page.evaluate(() => window.desktop.modelSettings());
      assert.equal(view.providers.deepseek.hasKey, true);
      assert.equal(view.providers.openai.hasKey, true);
      // This request decrypts the persisted credential via real Windows safeStorage.
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(page.locator('.settings-result')).toContainText('连接成功');
    });
    await check('清除当前服务密钥回到演示，另一家Key保留', async () => {
      await page.getByRole('button', { name: '清除已保存密钥', exact: true }).click();
      await expect(page.locator('.settings-current')).toContainText('演示');
      const view = await page.evaluate(() => window.desktop.modelSettings());
      assert.equal(view.providers.openai.hasKey, false);
      assert.equal(view.providers.deepseek.hasKey, true);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page.getByRole('textbox', { name: '消息输入', exact: true }).fill('演示模式的合成提问');
      const requests = await count();
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.getByText('演示回复 · 未检索', { exact: true })).toBeVisible();
      assert.equal(await count(), requests);
    });
    await check('最小窗口设置可滚动操作，无横向溢出', async () => {
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(960, 680),
      );
      await settings();
      await page.getByRole('button', { name: '保存并启用', exact: true }).scrollIntoViewIfNeeded();
      assert.equal(
        await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    });
    await check('最小窗口选择器可滚动搜索和手填，无横向溢出', async () => {
      await picker();
      await page.getByText('手动添加与使用说明', { exact: true }).click();
      await page.getByLabel('手动模型名称', { exact: true }).scrollIntoViewIfNeeded();
      await page
        .getByRole('button', { name: '管理 API 设置', exact: true })
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    });
    await check('最小窗口第一层浮窗边界正确且可点击外部关闭', async () => {
      await page.getByRole('button', { name: '模型与推理设置', exact: true }).click();
      const bounds = await page.getByRole('dialog').boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(
        bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= viewport.width &&
          bounds.y + bounds.height <= viewport.height,
      );
      await page.locator('.status-pill').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    await check('无页面异常，数据库与配置无合成明文Key', async () => {
      assert.deepEqual(errors, []);
      await desktop.close();
      desktop = null;
      for (const filename of fs
        .readdirSync(data)
        .filter((name) => name.startsWith('knowledge.sqlite') || name === 'model-settings.json')) {
        const bytes = fs.readFileSync(path.join(data, filename));
        assert.equal(bytes.includes(Buffer.from(KEY)), false);
      }
    });
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'test-results/model-desktop-report.json'),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          passed,
          errors,
          realProviderCalls: 0,
          transport:
            'mocked inside isolated Electron API session; real IPC, OS encryption, SQLite, UI and restart',
        },
        null,
        2,
      ),
    );
    console.log('Model desktop checks: ' + passed.length + ' passed; real provider calls: 0');
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.join(root, 'test-results/model-failure.png') })
        .catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})();
