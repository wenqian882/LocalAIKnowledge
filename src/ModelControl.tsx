import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { InferenceOptions, ModelSettingsView } from '../shared/types';
import { capabilities, EFFORT_LABELS, inferenceFor, modelName } from '../shared/inference';
import { ModelPicker } from './ModelPicker';
import { Icon } from './icons';

export function ModelControl({
  value,
  busy,
  perform,
  onChange,
  onSettings,
  onOpenChange,
  children,
}: {
  value: ModelSettingsView;
  busy: boolean;
  perform: (action: () => Promise<void>) => Promise<void>;
  onChange: (value: ModelSettingsView) => void;
  onSettings: () => void;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const noteId = useId();
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pane, setPane] = useState<'tuning' | 'models'>('tuning');
  const provider = value.active === 'demo' ? null : value.active;
  const model = provider ? value.providers[provider].model : '';
  const supported = provider ? capabilities(provider, model) : { efforts: [], fast: false };
  const current = provider
    ? inferenceFor(provider, model, value.providers[provider].inference?.[model])
    : { speed: 'standard' as const };
  const [draft, setDraft] = useState(current.effort);
  useEffect(() => setDraft(current.effort), [provider, model, current.effort]);
  const close = () => {
    if (panel.current?.matches(':popover-open')) panel.current.hidePopover();
  };
  useEffect(() => {
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);
  const save = (options: InferenceOptions) => {
    if (!provider || busy) return;
    if (options.effort === current.effort && options.speed === current.speed) return;
    void perform(async () => {
      try {
        onChange(await window.desktop.setInference({ provider, model, ...options }));
      } catch (error) {
        setDraft(current.effort);
        throw error;
      }
    });
  };
  const prepareOpen = () => {
    if (panel.current?.matches(':popover-open')) return;
    const rect = trigger.current!.getBoundingClientRect();
    const node = panel.current!;
    const above = rect.top - 16;
    const below = window.innerHeight - rect.bottom - 16;
    node.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - parseFloat(getComputedStyle(node).width) - 12))}px`;
    node.style.maxHeight = `${Math.max(160, above > below ? above : below)}px`;
    node.style.bottom = above > below ? `${window.innerHeight - rect.top + 8}px` : 'auto';
    node.style.top = above > below ? 'auto' : `${rect.bottom + 8}px`;
    setPane('tuning');
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={panelId}
        popoverTargetAction="toggle"
        className="composer-mode"
        aria-label="模型与推理设置"
        aria-haspopup="dialog"
        disabled={busy}
        onClick={prepareOpen}
      >
        <span>{model ? modelName(model) : '选择模型'}</span>
        {current.effort && <small>{EFFORT_LABELS[current.effort]}</small>}
        {current.speed === 'fast' && <Icon name="bolt" size={13} />}
        <span aria-hidden="true">⌄</span>
      </button>
      <div
        id={panelId}
        ref={panel}
        popover="auto"
        role="dialog"
        aria-label={pane === 'tuning' ? '推理与速度' : '选择模型'}
        className={`model-control-panel ${pane === 'models' ? 'show-models' : ''}`}
        onToggle={() => onOpenChange(!!panel.current?.matches(':popover-open'))}
      >
        {pane === 'tuning' ? (
          <>
            <div className="inference-heading">
              <button
                className={`inference-fast ${current.speed === 'fast' ? 'enabled' : ''}`}
                aria-label="快速模式"
                aria-describedby={noteId}
                aria-pressed={current.speed === 'fast'}
                disabled={busy || !provider || !supported.fast}
                title={
                  supported.fast
                    ? 'API快速处理，费用高于标准；不保证固定1.5倍速'
                    : '当前模型暂未适配快速处理接口'
                }
                onClick={() =>
                  save({ effort: draft, speed: current.speed === 'fast' ? 'standard' : 'fast' })
                }
              >
                <Icon name="bolt" size={13} />
                <small>{current.speed === 'fast' ? '快速' : '标准'}</small>
              </button>
              <div className="inference-current">
                <strong>{draft ? EFFORT_LABELS[draft] : provider ? '标准' : '演示'}</strong>
                <button aria-label="选择模型" disabled={busy} onClick={() => setPane('models')}>
                  {model ? modelName(model) : '选择模型'}
                  <span aria-hidden="true"> ›</span>
                </button>
              </div>
              <button
                className="icon-button inference-reset"
                aria-label="恢复推理与速度默认值"
                disabled={busy || !provider}
                title="恢复当前模型默认值"
                onClick={() => {
                  if (provider) {
                    const defaults = inferenceFor(provider, model);
                    setDraft(defaults.effort);
                    save(defaults);
                  }
                }}
              >
                <Icon name="reset" size={13} />
              </button>
            </div>
            {supported.efforts.length > 0 ? (
              <div className="effort-slider">
                <input
                  type="range"
                  aria-label="推理强度"
                  aria-valuetext={draft ? EFFORT_LABELS[draft] : ''}
                  min={0}
                  max={supported.efforts.length - 1}
                  step={1}
                  value={Math.max(0, supported.efforts.indexOf(draft!))}
                  disabled={busy}
                  style={{
                    background: `linear-gradient(to right, #3980f5 0%, #3980f5 ${(Math.max(0, supported.efforts.indexOf(draft!)) / (supported.efforts.length - 1)) * 100}%, #e8e8eb ${(Math.max(0, supported.efforts.indexOf(draft!)) / (supported.efforts.length - 1)) * 100}%, #e8e8eb 100%)`,
                  }}
                  onChange={(event) => setDraft(supported.efforts[Number(event.target.value)])}
                  onPointerUp={(event) =>
                    save({
                      effort: supported.efforts[Number(event.currentTarget.value)],
                      speed: current.speed,
                    })
                  }
                  onKeyUp={(event) =>
                    save({
                      effort: supported.efforts[Number(event.currentTarget.value)],
                      speed: current.speed,
                    })
                  }
                  onBlur={() => save({ effort: draft, speed: current.speed })}
                />
                <div className="effort-marks">
                  {supported.efforts.map((effort) => (
                    <button
                      key={effort}
                      aria-label={`推理强度：${EFFORT_LABELS[effort]}`}
                      title={EFFORT_LABELS[effort]}
                      aria-pressed={draft === effort}
                      disabled={busy}
                      onClick={() => {
                        setDraft(effort);
                        save({ effort, speed: current.speed });
                      }}
                    >
                      {EFFORT_LABELS[effort]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="inference-empty">
                {provider
                  ? '此模型暂未适配可调推理强度，可直接聊天或选择其他模型。'
                  : '先选择模型，再调整推理强度。'}
              </p>
            )}
            <p id={noteId} className="inference-note" aria-live="polite">
              {current.speed === 'fast'
                ? '快速模式可能加价，实际速度由服务商决定，不承诺固定1.5倍速。'
                : supported.fast
                  ? '强度越高通常越慢；闪电开关的快速模式费用更高，不承诺固定1.5倍速。'
                  : '强度越高通常越慢，用量可能增加。'}
            </p>
          </>
        ) : (
          <>
            <header className="model-control-heading">
              <button
                className="icon-button"
                aria-label="返回推理设置"
                disabled={busy}
                onClick={() => setPane('tuning')}
              >
                <Icon name="chevron" size={13} />
              </button>
              <span>选择模型</span>
              <button className="icon-button" aria-label="关闭弹窗" disabled={busy} onClick={close}>
                <Icon name="close" size={13} />
              </button>
            </header>
            <ModelPicker
              compact
              value={value}
              busy={busy}
              perform={perform}
              onChange={onChange}
              onChoose={(updated) => {
                onChange(updated);
                close();
              }}
              onSettings={() => {
                close();
                onSettings();
              }}
            />
          </>
        )}
        {children}
      </div>
    </>
  );
}
