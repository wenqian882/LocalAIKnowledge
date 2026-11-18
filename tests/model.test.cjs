const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ModelSettings, validateKey } = require('../dist-electron/electron/model-settings');
const {
  ModelService,
  requestReply,
  requestModels,
} = require('../dist-electron/electron/model-service');
const { Store } = require('../dist-electron/electron/store');
const { DatabaseSync } = require('node:sqlite');
const { modelChoices } = require('../dist-electron/shared/models');
const KEY = 'sk-localai-synthetic-fixture-not-a-real-key';
const USER = { role: 'user', content: '合成问题', isDemo: false };
const reply = () =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: '合成模型回复' }, finish_reason: 'stop' }] }),
  );
function fixture(t, codecPatch = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-model-'));
  const master = crypto.randomBytes(32);
  const codec = {
    available: async () => true,
    encrypt: async (value) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', master, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt: async (bytes) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', master, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
        'utf8',
      );
    },
    ...codecPatch,
  };
  const settings = new ModelSettings(directory, codec);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, codec, settings };
}
test('API Key 格式验证与空白清理', () => {
  assert.equal(validateKey('  ' + KEY + '  '), KEY);
  for (const value of ['', 'Bearer ' + KEY, KEY + '\nmore', '短密钥', null])
    assert.throws(() => validateKey(value), /API Key/);
});
test('两家配置独立加密保存、读取不回传密钥、重启、演示与清除', async (t) => {
  const { directory, codec, settings } = fixture(t);
  assert.equal(settings.view().active, 'demo');
  await settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  await settings.save({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: KEY + '-openai' });
  assert.equal(settings.view().active, 'openai');
  assert.equal(settings.view().providers.deepseek.hasKey, true);
  assert.equal(JSON.stringify(settings.view()).includes(KEY), false);
  assert.equal(JSON.stringify(settings.view()).includes('encryptedKey'), false);
  assert.equal(fs.readFileSync(settings.filePath, 'utf8').includes(KEY), false);
  const reopened = new ModelSettings(directory, codec);
  assert.equal(await reopened.key('deepseek'), KEY);
  assert.equal(await reopened.key('openai'), KEY + '-openai');
  await reopened.save({ provider: 'deepseek', model: 'deepseek-v4-pro', apiKey: '' });
  assert.equal(await reopened.key('deepseek'), KEY);
  reopened.demo();
  assert.equal(reopened.view().active, 'demo');
  assert.equal(reopened.view().providers.openai.hasKey, true);
  await reopened.save({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: '' });
  reopened.remove('openai');
  assert.equal(reopened.view().active, 'demo');
  assert.equal(reopened.view().providers.openai.hasKey, false);
  assert.equal(await reopened.key('deepseek'), KEY);
});
test('系统加密不可用或加密失败时拒绝明文保存', async (t) => {
  const a = fixture(t, { available: async () => false });
  await assert.rejects(
    a.settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY }),
    /明文/,
  );
  assert.equal(fs.existsSync(a.settings.filePath), false);
  const b = fixture(t, {
    encrypt: async () => {
      throw new Error(KEY);
    },
  });
  await assert.rejects(
    b.settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY }),
    (error) => error.message.includes('加密失败') && !error.message.includes(KEY),
  );
  assert.equal(b.settings.view().active, 'demo');
});
test('损坏配置不静默覆盖，保存失败不切换内存状态', async (t) => {
  const { directory, codec } = fixture(t);
  const target = path.join(directory, 'model-settings.json');
  fs.writeFileSync(target, 'broken');
  const broken = new ModelSettings(directory, codec);
  assert.match(broken.view().error, /无法读取/);
  await assert.rejects(broken.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'broken');
  const blocked = path.join(directory, 'blocked');
  fs.writeFileSync(blocked, 'file');
  const settings = new ModelSettings(blocked, codec);
  await assert.rejects(
    settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY }),
  );
  assert.equal(settings.view().active, 'demo');
});
test('DeepSeek 协议：官方地址、鉴权、禁用思考、过滤演示、限定20条与不发送文档', async () => {
  let sent;
  const history = [
    ...Array.from({ length: 25 }, (_, i) => ({ ...USER, content: 'question ' + i })),
    { role: 'assistant', content: '演示回复', isDemo: true },
  ];
  const text = await requestReply(
    'deepseek',
    'deepseek-flash',
    KEY,
    history,
    async (url, init) => {
      sent = { url, init };
      return reply();
    },
    new AbortController().signal,
  );
  assert.equal(text, '合成模型回复');
  assert.equal(sent.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(sent.init.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(sent.init.redirect, 'error');
  const body = JSON.parse(sent.init.body);
  assert.equal(body.messages.length, 21);
  assert.equal(body.messages[1].content, 'question 5');
  assert.equal(
    body.messages.some((item) => item.content === '演示回复'),
    false,
  );
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.stream, false);
  assert.equal('files' in body, false);
});
test('OpenAI Responses 协议：store false、遍历输出正文及拒答', async () => {
  let payload;
  const answer = await requestReply(
    'openai',
    'gpt-4.1-mini',
    KEY,
    [USER],
    async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      payload = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'reasoning' },
            {
              type: 'message',
              role: 'assistant',
              content: [
                { type: 'output_text', text: '段落一' },
                { type: 'output_text', text: '段落二' },
                { type: 'refusal', refusal: '拒绝理由' },
              ],
            },
          ],
        }),
      );
    },
    new AbortController().signal,
  );
  assert.equal(payload.store, false);
  assert.equal(payload.input[0].content, '合成问题');
  assert.equal(answer, '段落一\n段落二\n拒绝理由');
});
test('HTTP 错误不回显供应商正文、API Key 或对话文字', async () => {
  for (const status of [400, 401, 402, 403, 404, 429, 500]) {
    await assert.rejects(
      requestReply(
        'deepseek',
        'deepseek-flash',
        KEY,
        [USER],
        async () => new Response('echo ' + KEY + ' prompt', { status }),
        new AbortController().signal,
      ),
      (e) =>
        e.message.includes(String(status)) &&
        !e.message.includes(KEY) &&
        !e.message.includes('echo'),
    );
  }
});
test('空正文、无效JSON、截断及不完整响应不会冒充成功', async () => {
  for (const [id, value] of [
    ['deepseek', 'not JSON'],
    ['deepseek', JSON.stringify({ choices: [{ message: { content: '' } }] })],
    [
      'deepseek',
      JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '截断' } }] }),
    ],
    ['openai', JSON.stringify({ status: 'incomplete', output: [] })],
  ])
    await assert.rejects(
      requestReply(
        id,
        'test-model',
        KEY,
        [USER],
        async () => new Response(value),
        new AbortController().signal,
      ),
    );
});
test('对话长度在发请求前限制，模型回显密钥会遮盖', async () => {
  let requests = 0;
  await assert.rejects(
    requestReply(
      'deepseek',
      'deepseek-flash',
      KEY,
      [{ ...USER, content: 'a'.repeat(60001) }],
      async () => {
        requests++;
        return reply();
      },
      new AbortController().signal,
    ),
    /过长/,
  );
  assert.equal(requests, 0);
  const content = await requestReply(
    'deepseek',
    'deepseek-flash',
    KEY,
    [USER],
    async () => new Response(JSON.stringify({ choices: [{ message: { content: KEY } }] })),
    new AbortController().signal,
  );
  assert.equal(content, '[API Key 已隐藏]');
});
test('保存不会联网，演示模式不会调用，测试连接不保存新密钥', async (t) => {
  const { settings } = fixture(t);
  let requests = 0;
  const service = new ModelService(settings, async () => {
    requests++;
    return reply();
  });
  assert.equal(await service.generate([], 'hello'), null);
  assert.equal(requests, 0);
  await service.test({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  assert.equal(requests, 1);
  assert.equal(settings.view().providers.deepseek.hasKey, false);
  await service.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  assert.equal(requests, 1);
  const generated = await service.generate([], 'question');
  assert.equal(generated.provider, 'deepseek');
  assert.equal(generated.model, 'deepseek-flash');
  assert.equal(requests, 2);
});
test('并发请求被阻止，取消后可重试，不自动重试服务商', async (t) => {
  const { settings } = fixture(t);
  await settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  let signalReady;
  const ready = new Promise((resolve) => (signalReady = resolve));
  let calls = 0;
  const service = new ModelService(settings, async (_url, init) => {
    calls++;
    signalReady();
    return new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  });
  const pending = service.generate([], 'question');
  await ready;
  await assert.rejects(service.generate([], 'second'), /正在处理/);
  await assert.rejects(
    service.save({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: KEY }),
    /正在处理/,
  );
  service.cancel();
  await assert.rejects(pending, /取消/);
  assert.equal(calls, 1);
  await service.demo();
  assert.equal(await service.generate([], 'question'), null);
});
test('旧数据库安全迁移、真实回复标注、错误输入不会新增记录', (t) => {
  const { directory } = fixture(t);
  const file = path.join(directory, 'knowledge.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(
    "CREATE TABLE messages (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, isDemo INTEGER NOT NULL, createdAt TEXT NOT NULL); INSERT INTO messages VALUES ('old','legacy','assistant','旧演示',1,'2026-11-04');",
  );
  legacy.close();
  const store = new Store(directory);
  try {
    const old = store.db.prepare("SELECT * FROM messages WHERE id='old'").get();
    assert.equal(old.content, '旧演示');
    assert.equal(old.provider, null);
    assert.equal(old.model, null);
    const chat = store.createConversation();
    assert.throws(() => store.validateMessage(chat.id, ' '));
    assert.equal(store.messages(chat.id).length, 0);
    store.sendMessage(chat.id, '新问题', {
      content: '真实协议模拟回复',
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
    const message = store.messages(chat.id)[1];
    assert.equal(message.isDemo, false);
    assert.equal(message.provider, 'openai');
    assert.equal(message.model, 'gpt-4.1-mini');
  } finally {
    store.close();
  }
});

test('旧版本双Key配置兼容：启动不改文件，切换不联网且保留原密文和旧模型', async (t) => {
  const { directory, codec, settings } = fixture(t);
  await settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  await settings.save({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: KEY + '-openai' });
  const legacy = JSON.parse(fs.readFileSync(settings.filePath, 'utf8'));
  delete legacy.providers.deepseek.models;
  delete legacy.providers.openai.models;
  const original = JSON.stringify(legacy);
  fs.writeFileSync(settings.filePath, original);
  const reopened = new ModelSettings(directory, codec);
  assert.equal(fs.readFileSync(settings.filePath, 'utf8'), original);
  let calls = 0;
  const service = new ModelService(reopened, async () => {
    calls++;
    return reply();
  });
  await service.select({ provider: 'deepseek', model: 'deepseek-v4-pro' });
  await service.select({ provider: 'openai', model: 'gpt-6-luna' });
  assert.equal(calls, 0);
  const updated = JSON.parse(fs.readFileSync(settings.filePath, 'utf8'));
  for (const id of ['deepseek', 'openai'])
    assert.equal(updated.providers[id].encryptedKey, legacy.providers[id].encryptedKey);
  const restarted = new ModelSettings(directory, codec);
  assert.equal(restarted.view().active, 'openai');
  assert.equal(restarted.view().providers.openai.model, 'gpt-6-luna');
  assert.ok(modelChoices('openai', restarted.view().providers.openai).includes('gpt-4.1-mini'));
  assert.ok(restarted.view().providers.deepseek.models.includes('deepseek-v4-pro'));
  assert.equal(await restarted.key('openai'), KEY + '-openai');
});

test('无Key和非法手填模型无法切换，不改变当前设置', async (t) => {
  const { settings } = fixture(t);
  const service = new ModelService(settings, async () => {
    throw new Error('must not call');
  });
  await assert.rejects(service.select({ provider: 'openai', model: 'gpt-4.1' }), /粘贴/);
  await settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  await assert.rejects(service.select({ provider: 'deepseek', model: 'bad model\n' }), /模型名称/);
  assert.equal(settings.view().active, 'deepseek');
  assert.equal(settings.view().providers.deepseek.model, 'deepseek-flash');
});

test('模型列表仅GET元数据，过滤媒体/非法/已下线模型，保留将来下线与去重', async () => {
  let request;
  const names = await requestModels(
    'openai',
    KEY,
    async (url, init) => {
      request = { url, init };
      return new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-6-luna' },
            { id: 'gpt-6-luna' },
            { id: 'gpt-4.1-mini' },
            { id: 'o3' },
            { id: 'gpt-future', shutdown_date: '2099-01-01' },
            { id: 'gpt-retired', shutdown_date: '2020-01-01' },
            { id: 'text-embedding-3-small' },
            { id: 'gpt-image-1' },
            { id: 'gpt-audio' },
            { id: 'gpt-instruct' },
            { id: '../bad' },
            { id: null },
            null,
          ],
        }),
      );
    },
    new AbortController().signal,
  );
  assert.deepEqual(names, ['gpt-4.1-mini', 'gpt-6-luna', 'gpt-future', 'o3']);
  assert.equal(request.url, 'https://api.openai.com/v1/models');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.body, undefined);
  assert.equal(request.init.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(request.init.redirect, 'error');
  for (const body of ['null', 'invalid', '{}'])
    await assert.rejects(
      requestModels('deepseek', KEY, async () => new Response(body), new AbortController().signal),
      /列表/,
    );
});

test('刷新只缓存列表，失败保留缓存/选择/密文，重启仍可离线选择', async (t) => {
  const { directory, codec, settings } = fixture(t);
  await settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  const cipher = JSON.parse(fs.readFileSync(settings.filePath)).providers.deepseek.encryptedKey;
  let fail = false,
    calls = 0;
  const service = new ModelService(settings, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/models');
    assert.equal(init.method, 'GET');
    return fail
      ? new Response(KEY, { status: 401 })
      : new Response(JSON.stringify({ data: [{ id: 'deepseek-custom' }] }));
  });
  await service.list('deepseek');
  const before = fs.readFileSync(settings.filePath, 'utf8');
  assert.equal(settings.view().providers.deepseek.model, 'deepseek-flash');
  assert.equal(JSON.parse(before).providers.deepseek.encryptedKey, cipher);
  fail = true;
  await assert.rejects(
    service.list('deepseek'),
    (error) => /401/.test(error.message) && !error.message.includes(KEY),
  );
  assert.equal(fs.readFileSync(settings.filePath, 'utf8'), before);
  const reopened = new ModelSettings(directory, codec);
  assert.deepEqual(reopened.view().providers.deepseek.catalog, ['deepseek-custom']);
  assert.ok(reopened.view().providers.deepseek.catalogUpdatedAt);
  await new ModelService(reopened, async () => {
    throw new Error('must not call');
  }).select({ provider: 'deepseek', model: 'deepseek-custom' });
  assert.equal(calls, 2);
});

test('刷新可停止，阻止并发切换，取消后不覆盖旧列表或自动重试', async (t) => {
  const { settings } = fixture(t);
  await settings.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY });
  settings.cacheCatalog('deepseek', ['deepseek-cached']);
  let ready,
    calls = 0;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const service = new ModelService(settings, async (_url, init) => {
    calls++;
    ready();
    return new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    );
  });
  const pending = service.list('deepseek');
  await started;
  await assert.rejects(
    service.select({ provider: 'deepseek', model: 'deepseek-other' }),
    /正在处理/,
  );
  service.cancel();
  await assert.rejects(pending, /取消/);
  assert.deepEqual(settings.view().providers.deepseek.catalog, ['deepseek-cached']);
  assert.equal(calls, 1);
  await service.select({ provider: 'deepseek', model: 'deepseek-cached' });
});

test('GPT6低推理测试预算与4.1参数分别适配，不触发实际调用', async () => {
  for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-4.1-mini']) {
    let payload;
    await requestReply(
      'openai',
      model,
      KEY,
      [USER],
      async (_url, init) => {
        payload = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'OK' }],
              },
            ],
          }),
        );
      },
      new AbortController().signal,
      true,
    );
    assert.equal(payload.model, model);
    assert.equal(payload.max_output_tokens, model.startsWith('gpt-6') ? 1024 : 128);
    assert.deepEqual(payload.reasoning, model.startsWith('gpt-6') ? { effort: 'low' } : undefined);
  }
});

test('各模型强度和速度独立保存，重启保留，不联网或改写已有Key', async (t) => {
  const { settings, directory, codec } = fixture(t);
  let calls = 0;
  const service = new ModelService(settings, async () => {
    calls++;
    return reply();
  });
  await service.save({ provider: 'openai', model: 'gpt-6.1-sol', apiKey: KEY });
  const cipher = JSON.parse(fs.readFileSync(settings.filePath)).providers.openai.encryptedKey;
  await service.configure({
    provider: 'openai',
    model: 'gpt-6.1-sol',
    effort: 'high',
    speed: 'fast',
  });
  await service.configure({
    provider: 'openai',
    model: 'gpt-6-luna',
    effort: 'none',
    speed: 'standard',
  });
  assert.equal(calls, 0);
  assert.equal(settings.view().providers.openai.model, 'gpt-6.1-sol');
  assert.equal(
    JSON.parse(fs.readFileSync(settings.filePath)).providers.openai.encryptedKey,
    cipher,
  );
  const reopened = new ModelSettings(directory, codec);
  assert.deepEqual(reopened.view().providers.openai.inference['gpt-6.1-sol'], {
    effort: 'high',
    speed: 'fast',
  });
  assert.deepEqual(reopened.view().providers.openai.inference['gpt-6-luna'], {
    effort: 'none',
    speed: 'standard',
  });
  assert.equal(await reopened.key('openai'), KEY);
});

test('API请求使用所选推理强度/快速档；标准档明确不继承服务商项目加速', async () => {
  for (const [model, options] of [
    ['gpt-6.1-sol', { effort: 'high', speed: 'fast' }],
    ['gpt-6-luna', { effort: 'none', speed: 'standard' }],
    ['gpt-5.6-sol', { effort: 'max', speed: 'standard' }],
    ['gpt-4.1-mini', { speed: 'standard' }],
  ]) {
    let payload;
    await requestReply(
      'openai',
      model,
      KEY,
      [USER],
      async (_url, init) => {
        payload = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'OK' }],
              },
            ],
          }),
        );
      },
      new AbortController().signal,
      false,
      options,
    );
    assert.equal(payload.service_tier, options.speed === 'fast' ? 'fast' : 'default');
    assert.deepEqual(payload.reasoning, options.effort ? { effort: options.effort } : undefined);
    assert.equal(payload.max_output_tokens, 4096);
    assert.equal(payload.store, false);
  }
});

test('DeepSeek强度启用/关闭使用正确参数，不携带OpenAI速度参数', async () => {
  for (const effort of ['none', 'low', 'high', 'max']) {
    let payload;
    await requestReply(
      'deepseek',
      'deepseek-v4-pro',
      KEY,
      [USER],
      async (_url, init) => {
        payload = JSON.parse(init.body);
        return reply();
      },
      new AbortController().signal,
      false,
      { effort, speed: 'standard' },
    );
    assert.equal(payload.thinking.type, effort === 'none' ? 'disabled' : 'enabled');
    assert.equal(payload.reasoning_effort, effort === 'none' ? undefined : effort);
    assert.equal('service_tier' in payload, false);
  }
});

test('后端拒绝未适配档位、速度与无Key配置，不静默换模型或发请求', async (t) => {
  const { settings } = fixture(t);
  const service = new ModelService(settings, async () => {
    throw new Error('must not call');
  });
  await assert.rejects(
    service.configure({ provider: 'openai', model: 'gpt-6.1-sol', effort: 'high', speed: 'fast' }),
    /Key/,
  );
  await settings.save({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: KEY });
  const before = fs.readFileSync(settings.filePath, 'utf8');
  for (const input of [
    { provider: 'openai', model: 'gpt-4.1-mini', effort: 'high', speed: 'standard' },
    { provider: 'openai', model: 'gpt-6.1-sol', effort: 'none', speed: 'standard' },
    { provider: 'openai', model: 'gpt-6.1-sol', effort: 'ultra', speed: 'standard' },
    { provider: 'openai', model: 'custom-model', speed: 'fast' },
    { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high', speed: 'fast' },
    { provider: 'openai', model: 'gpt-6-luna', effort: 'high', speed: '1.5' },
  ])
    await assert.rejects(service.configure(input));
  assert.equal(fs.readFileSync(settings.filePath, 'utf8'), before);
});
