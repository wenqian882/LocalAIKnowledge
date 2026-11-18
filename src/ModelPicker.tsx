import { useState } from 'react';
import { MODEL_PROVIDERS, modelChoices } from '../shared/models';
import type { ModelSettingsView, ProviderId } from '../shared/types';
import { Icon } from './icons';
import { modelName } from '../shared/inference';

export function ModelPicker({
  value,
  busy,
  perform,
  onChange,
  onChoose,
  onSettings,
  compact = false,
}: {
  value: ModelSettingsView;
  busy: boolean;
  perform: (work: () => Promise<void>) => Promise<void>;
  onChange: (value: ModelSettingsView) => void;
  onChoose: (value: ModelSettingsView) => void;
  onSettings: () => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ProviderId>(
    value.active === 'demo' ? 'deepseek' : value.active,
  );
  const [custom, setCustom] = useState('');
  const [info, setInfo] = useState('');
  const choose = (id: ProviderId, model: string) =>
    perform(async () => onChoose(await window.desktop.selectModel({ provider: id, model })));
  return (
    <div className="model-picker-panel">
      {!compact && (
        <p className="model-picker-help">
          每次发送只使用一个模型。切换只影响下一条消息，历史回答保留原模型标签；继续对话时会将本会话文字发送给新服务商。
        </p>
      )}
      <div className="picker-search">
        <Icon name="search" size={17} />
        <input
          autoFocus
          aria-label="搜索模型"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索服务商或模型名称"
        />
      </div>
      <div className="model-picker-list">
        {(['deepseek', 'openai'] as const).map((id) => {
          const settings = value.providers[id];
          const candidates = modelChoices(id, settings).filter((name) =>
            `${id} ${name}`.toLowerCase().includes(query.trim().toLowerCase()),
          );
          return (
            <section
              className="model-provider-group"
              key={id}
              aria-label={MODEL_PROVIDERS[id].name}
            >
              <header>
                <div>
                  <strong>{MODEL_PROVIDERS[id].name}</strong>
                  <small>
                    {settings.hasKey
                      ? settings.catalogUpdatedAt
                        ? `账户列表更新于 ${new Date(settings.catalogUpdatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : '已保存 API Key'
                      : '未配置 API Key'}
                  </small>
                </div>
                <button
                  className="text-button"
                  disabled={busy || !settings.hasKey}
                  aria-label={`刷新 ${id === 'openai' ? 'OpenAI' : 'DeepSeek'} 模型`}
                  onClick={() =>
                    void perform(async () => {
                      setInfo('');
                      const updated = await window.desktop.listModels(id);
                      onChange(updated);
                      setInfo(
                        `已读取 ${updated.providers[id].catalog?.length ?? 0} 个文本候选模型。未发送聊天或调用生成。`,
                      );
                    })
                  }
                >
                  刷新模型列表
                </button>
              </header>
              {candidates.map((model) => {
                const selected = value.active === id && settings.model === model;
                const source = settings.catalog?.includes(model)
                  ? '账户列表'
                  : settings.models?.includes(model) || settings.model === model
                    ? '已保存'
                    : '预设';
                return (
                  <button
                    key={model}
                    className={`model-choice ${selected ? 'selected' : ''}`}
                    disabled={busy || !settings.hasKey}
                    aria-label={`使用 ${id === 'openai' ? 'OpenAI' : 'DeepSeek'} · ${model}`}
                    aria-pressed={selected}
                    onClick={() => void choose(id, model)}
                  >
                    <span>
                      {modelName(model)}
                      {compact && modelName(model) !== model && <code>{model}</code>}
                    </span>
                    <small>{source}</small>
                    {selected && <Icon name="check" size={16} />}
                  </button>
                );
              })}
              {!candidates.length && (
                <p className="picker-empty">没有匹配的模型，可在下方手动填写。</p>
              )}
              {!settings.hasKey && (
                <button className="text-button" onClick={onSettings} disabled={busy}>
                  去设置粘贴 API Key
                </button>
              )}
            </section>
          );
        })}
      </div>
      <details className="model-picker-more" open={!compact}>
        {compact && <summary>手动添加与使用说明</summary>}
        {compact && (
          <p className="model-picker-help">
            每次只用一个模型。切换保留旧回答标签；继续对话时会将本会话文字历史发送给新服务商。
          </p>
        )}
        <form
          className="custom-model-form"
          onSubmit={(event) => {
            event.preventDefault();
            void choose(provider, custom);
          }}
        >
          <label>
            手动填写模型名
            <div className="custom-model-fields">
              <select
                aria-label="手动模型服务商"
                disabled={busy}
                value={provider}
                onChange={(event) => setProvider(event.target.value as ProviderId)}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
              </select>
              <input
                aria-label="手动模型名称"
                disabled={busy}
                maxLength={100}
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="填写账户中的模型 ID"
              />
              <button
                type="submit"
                className="button primary"
                disabled={busy || !custom.trim() || !value.providers[provider].hasKey}
              >
                使用
              </button>
            </div>
          </label>
        </form>
        <p className="model-picker-help">
          预设未验证账户权限；账户列表也不保证每个模型都支持本应用文本接口。以实际调用结果为准。切换和打开列表不发请求，只有点击刷新才查询官方模型目录。
        </p>
      </details>
      {info && (
        <p className="settings-result" role="status">
          {info}
        </p>
      )}
      <footer className="model-picker-footer">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void perform(async () => onChoose(await window.desktop.useDemo()))}
        >
          使用演示模式
        </button>
        {busy && (
          <button className="button" onClick={() => void window.desktop.cancelGeneration()}>
            停止刷新
          </button>
        )}
        <button className="button" onClick={onSettings} disabled={busy}>
          管理 API 设置
        </button>
      </footer>
    </div>
  );
}
