import { useState } from 'react';
import type { ModelSettingsView, ProviderId } from '../shared/types';
import { MODEL_PROVIDERS, modelChoices } from '../shared/models';

export function ModelSettingsPanel({
  value,
  busy,
  perform,
  onChange,
}: {
  value: ModelSettingsView;
  busy: boolean;
  perform: (work: () => Promise<void>) => Promise<void>;
  onChange: (value: ModelSettingsView) => void;
}) {
  const [provider, setProvider] = useState<ProviderId>(
    value.active === 'demo' ? 'deepseek' : value.active,
  );
  const [model, setModel] = useState(value.providers[provider].model);
  const [key, setKey] = useState('');
  const [result, setResult] = useState('');
  const definition = MODEL_PROVIDERS[provider];
  const hasKey = value.providers[provider].hasKey;
  const input = () => ({ provider, model, apiKey: key });
  return (
    <div className="model-settings-panel">
      <p className="settings-current">
        当前模式：
        <strong>
          {value.active === 'demo'
            ? '演示（不调用模型）'
            : `${MODEL_PROVIDERS[value.active].name} · ${value.providers[value.active].model}`}
        </strong>
      </p>
      <div className="provider-tabs" role="tablist" aria-label="模型服务商">
        {(['deepseek', 'openai'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={provider === id}
            disabled={busy}
            className={provider === id ? 'selected' : ''}
            onClick={() => {
              setProvider(id);
              setModel(value.providers[id].model);
              setKey('');
              setResult('');
            }}
          >
            {MODEL_PROVIDERS[id].name}
            <small>{value.providers[id].hasKey ? '已保存密钥' : '未配置'}</small>
          </button>
        ))}
      </div>
      {value.error && (
        <p className="settings-error" role="alert">
          {value.error}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            const updated = await window.desktop.saveModel(input());
            onChange(updated);
            setKey('');
            setResult(`已保存并启用 ${definition.name}。可以关闭设置并发送消息。`);
          });
        }}
      >
        <label>
          API Key{' '}
          <span className="settings-key-state">
            {hasKey ? '已保存 · 输入新密钥可替换' : '仅在本机粘贴'}
          </span>
          <input
            type="password"
            aria-label="API Key"
            autoComplete="new-password"
            spellCheck={false}
            maxLength={512}
            disabled={busy}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setResult('');
            }}
            placeholder={hasKey ? '已保存，留空保留原密钥' : '在此粘贴你的 API Key'}
          />
        </label>
        <p className="settings-help">
          密钥使用系统加密保存在本机，不会读回输入框。
          {hasKey && (
            <button
              type="button"
              className="inline-danger"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  onChange(await window.desktop.removeModelKey(provider));
                  setKey('');
                  setResult('已清除该服务商密钥。若此前正在使用它，已切回演示模式。');
                })
              }
            >
              清除已保存密钥
            </button>
          )}
        </p>
        <label>
          模型名称
          <input
            aria-label="模型名称"
            list={`models-${provider}`}
            value={model}
            disabled={busy}
            maxLength={100}
            onChange={(event) => {
              setModel(event.target.value);
              setResult('');
            }}
          />
        </label>
        <datalist id={`models-${provider}`}>
          {modelChoices(provider, value.providers[provider]).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <p className="settings-help">
          同一个 Key 可以选择账户有权限的不同模型。聊天输入框旁可直接切换，不必反复修改这里。
          <button
            type="button"
            className="text-button"
            disabled={busy || !hasKey}
            onClick={() =>
              void perform(async () => {
                const updated = await window.desktop.listModels(provider);
                onChange(updated);
                setResult(
                  `已缓存 ${updated.providers[provider].catalog?.length ?? 0} 个文本候选模型，聊天区可直接选择。`,
                );
              })
            }
          >
            刷新模型列表
          </button>
        </p>
        <label className="settings-endpoint-label">
          官方接口<code className="settings-endpoint">{definition.endpoint}</code>
        </label>
        {provider === 'openai' && (
          <p className="settings-help">
            这里使用 OpenAI API Key。ChatGPT 订阅与 API 分开计费；ChatGPT
            登录密码或订阅不能直接填在这里。
          </p>
        )}
        <p className="settings-help">
          密钥申请页面：<span className="key-address">{definition.keyURL}</span>
        </p>
        <div className="settings-disclosure">
          保存只写入本机，不发请求。点击测试连接会发送一条简短测试文字；发送消息时，会把当前对话最近
          20 条非演示文字（最多 6 万字符）交给所选服务商，可能产生 API
          费用。知识库文件目前不会随消息发送，也尚未建立检索索引。
        </div>
        {result && (
          <p className="settings-result" role="status">
            {result}
          </p>
        )}
        <footer className="model-actions">
          {busy && (
            <button
              type="button"
              className="button"
              onClick={() => void window.desktop.cancelGeneration()}
            >
              停止请求
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy || value.active === 'demo'}
            onClick={() =>
              void perform(async () => {
                onChange(await window.desktop.useDemo());
                setResult('已切回演示模式，不会调用模型。密钥仍保留在本机。');
              })
            }
          >
            切回演示模式
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || (!key.trim() && !hasKey)}
            onClick={() =>
              void perform(async () => {
                setResult('');
                setResult(await window.desktop.testModel(input()));
              })
            }
          >
            {busy ? '处理中…' : '测试连接'}
          </button>
          <button className="button primary" type="submit" disabled={busy || !!value.error}>
            {busy ? '处理中…' : '保存并启用'}
          </button>
        </footer>
      </form>
    </div>
  );
}
