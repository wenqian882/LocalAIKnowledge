import { MODEL_PROVIDERS, isProvider } from '../shared/models';
import type {
  InferenceOptions,
  Message,
  ProviderId,
  SaveModelInput,
  SetInferenceInput,
} from '../shared/types';
import { inferenceFor } from '../shared/inference';
import { ModelSettings, validateKey, validateModel } from './model-settings';

export type ModelTransport = (url: string, init: RequestInit) => Promise<Response>;
export function isTextModel(provider: ProviderId, model: string): boolean {
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) return false;
  if (/(embedding|moderation|tts|transcrib|realtime|audio|image|instruct|gpt-3\.5)/i.test(model))
    return false;
  return provider === 'deepseek'
    ? model.startsWith('deepseek-')
    : /^(gpt-|chatgpt-|o[1-9](?:[.-]|$)|ft:)/.test(model);
}
export async function requestModels(
  provider: ProviderId,
  key: string,
  transport: ModelTransport,
  signal: AbortSignal,
): Promise<string[]> {
  let response: Response;
  try {
    response = await transport(MODEL_PROVIDERS[provider].modelsEndpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal,
      redirect: 'error',
      credentials: 'omit',
    });
  } catch {
    throw new Error(
      signal.aborted
        ? '模型列表刷新已取消或超时，原列表已保留'
        : '无法读取模型列表，请检查网络、系统代理或账户权限；可继续使用缓存或手动填写',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw statusError(response.status);
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new Error('模型列表读取失败，原列表已保留');
  }
  if (signal.aborted) throw new Error('模型列表刷新已取消或超时，原列表已保留');
  if (raw.length > 2_000_000) throw new Error('模型列表过大，原列表已保留');
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('模型列表不是有效 JSON，原列表已保留');
  }
  if (!Array.isArray(value?.data)) throw new Error('服务商返回的模型列表格式无效，原列表已保留');
  const models = value.data
    .filter(
      (item: any) =>
        typeof item?.id === 'string' &&
        isTextModel(provider, item.id) &&
        (!item.shutdown_date ||
          !Number.isFinite(Date.parse(item.shutdown_date)) ||
          Date.parse(item.shutdown_date) > Date.now()),
    )
    .map((item: any) => item.id as string);
  return [...new Set<string>(models)].sort().slice(0, 1000);
}
export interface GeneratedReply {
  content: string;
  provider: ProviderId;
  model: string;
}
const instructions =
  '你是 LocalAI 桌面应用中的助手。请根据用户发送的对话文字回答。本应用尚未实现知识库检索，未向你提供任何关联知识库文件；不要声称读取或检索了用户的知识库。';
function statusError(status: number): Error {
  const hint: Record<number, string> = {
    400: '请求参数或模型不支持，请检查模型名称及该模型支持的接口。',
    401: 'API Key 无效或已失效，请在设置中重新粘贴。',
    402: '账户余额不足，请到服务商控制台检查。',
    403: '服务商拒绝访问，请检查账户权限、所在地区或网络环境。',
    404: '模型或接口不存在，请核对模型名称。',
    429: '调用受到限流或额度限制，请检查账户余额、配额，稍后手动重试。',
  };
  return new Error(
    `模型服务请求失败（HTTP ${status}）：${hint[status] ?? (status >= 500 ? '服务商暂时异常，请稍后手动重试。' : '请检查账户权限和模型配置。')}`,
  );
}
export async function requestReply(
  provider: ProviderId,
  model: string,
  key: string,
  history: Pick<Message, 'role' | 'content' | 'isDemo'>[],
  transport: ModelTransport,
  signal: AbortSignal,
  test = false,
  options?: InferenceOptions,
): Promise<string> {
  const tuning = inferenceFor(provider, model, options);
  const messages = history
    .filter((item) => !item.isDemo)
    .slice(-20)
    .map((item) => ({ role: item.role, content: item.content }));
  if (!messages.length || messages.reduce((sum, item) => sum + item.content.length, 0) > 60000)
    throw new Error('当前对话文字过长，请新建对话后重试（本版最多发送最近 20 条、合计 6 万字符）');
  const body =
    provider === 'deepseek'
      ? {
          model,
          messages: [{ role: 'system', content: instructions }, ...messages],
          stream: false,
          max_tokens: test ? (tuning.effort && tuning.effort !== 'none' ? 1024 : 128) : 4096,
          thinking: { type: tuning.effort && tuning.effort !== 'none' ? 'enabled' : 'disabled' },
          ...(tuning.effort && tuning.effort !== 'none' ? { reasoning_effort: tuning.effort } : {}),
        }
      : {
          model,
          input: messages,
          instructions,
          store: false,
          max_output_tokens: test ? (tuning.effort && tuning.effort !== 'none' ? 1024 : 128) : 4096,
          ...(tuning.effort ? { reasoning: { effort: tuning.effort } } : {}),
          service_tier: tuning.speed === 'fast' ? 'fast' : 'default',
        };
  let response: Response;
  try {
    response = await transport(MODEL_PROVIDERS[provider].endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
      credentials: 'omit',
    });
  } catch {
    if (signal.aborted) throw new Error('请求已取消或超过 90 秒，请手动重试；服务商仍可能计费');
    throw new Error('无法连接模型服务，请检查网络、系统代理及服务商可用性');
  }
  // Do not surface upstream response bodies: they can echo prompts or credentials.
  if (!response.ok) {
    await response.body?.cancel();
    throw statusError(response.status);
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new Error(
      signal.aborted
        ? '请求已取消或超时，请手动重试；服务商仍可能计费'
        : '模型响应读取失败，请手动重试',
    );
  }
  if (signal.aborted) throw new Error('请求已取消或超时，请手动重试；服务商仍可能计费');
  if (raw.length > 2_000_000) throw new Error('模型响应过大，未保存');
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('模型服务返回的不是有效 JSON，请检查服务商状态');
  }
  if (provider === 'openai' && (value.status === 'incomplete' || value.error))
    throw new Error(
      '模型未完成回答，可能已达到输出预算。请降低推理强度、缩短问题或选择其他模型后手动重试',
    );
  if (provider === 'deepseek' && value.choices?.[0]?.finish_reason === 'length')
    throw new Error('模型回答达到输出预算，未保存截断结果。请缩短问题后手动重试');
  let content: unknown;
  if (provider === 'deepseek') content = value.choices?.[0]?.message?.content;
  else
    content = (Array.isArray(value.output) ? value.output : [])
      .filter((item: any) => item?.type === 'message' && item.role === 'assistant')
      .flatMap((item: any) => (Array.isArray(item.content) ? item.content : []))
      .filter((part: any) => part?.type === 'output_text' || part?.type === 'refusal')
      .map((part: any) => (part.type === 'refusal' ? part.refusal : part.text))
      .filter((text: unknown) => typeof text === 'string')
      .join('\n');
  if (typeof content !== 'string' || !content.trim())
    throw new Error('模型没有返回可显示的正文，请检查模型支持情况或输出预算');
  // Never persist a credential even if an upstream gateway echoes it.
  return content.split(key).join('[API Key 已隐藏]').trim();
}
export class ModelService {
  private controller?: AbortController;
  private busy = false;
  constructor(
    readonly settings: ModelSettings,
    private readonly transport: ModelTransport,
  ) {}
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('正在处理模型请求或配置，请等待完成后重试');
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }
  save(input: SaveModelInput) {
    return this.exclusive(() => this.settings.save(input));
  }
  select(input: Pick<SaveModelInput, 'provider' | 'model'>) {
    return this.exclusive(() => this.settings.save({ ...input, apiKey: '' }));
  }
  configure(input: SetInferenceInput) {
    return this.exclusive(async () => this.settings.configure(input));
  }
  list(id: ProviderId): Promise<ReturnType<ModelSettings['view']>> {
    return this.exclusive(async () => {
      if (!isProvider(id)) throw new Error('请选择服务商');
      const key = await this.settings.key(id);
      this.controller = new AbortController();
      const timer = setTimeout(() => this.controller?.abort(), 15000);
      try {
        const names = await requestModels(id, key, this.transport, this.controller.signal);
        return this.settings.cacheCatalog(id, names);
      } finally {
        clearTimeout(timer);
        this.controller = undefined;
      }
    });
  }
  remove(id: ProviderId) {
    return this.exclusive(async () => this.settings.remove(id));
  }
  demo() {
    return this.exclusive(async () => this.settings.demo());
  }
  cancel() {
    this.controller?.abort();
  }
  private async call(
    id: ProviderId,
    model: string,
    key: string,
    messages: Pick<Message, 'role' | 'content' | 'isDemo'>[],
    test: boolean,
  ) {
    this.controller = new AbortController();
    const timer = setTimeout(() => this.controller?.abort(), 90000);
    try {
      return await requestReply(
        id,
        model,
        key,
        messages,
        this.transport,
        this.controller.signal,
        test,
        this.settings.view().providers[id].inference?.[model],
      );
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
    }
  }
  test(input: SaveModelInput): Promise<string> {
    return this.exclusive(async () => {
      if (!input || !isProvider(input.provider)) throw new Error('请选择服务商');
      const model = validateModel(input.model);
      const key = input.apiKey?.trim()
        ? validateKey(input.apiKey)
        : await this.settings.key(input.provider);
      await this.call(
        input.provider,
        model,
        key,
        [{ role: 'user', content: 'Reply with OK only.', isDemo: false }],
        true,
      );
      return '连接成功：已收到该模型的正文回复。测试可能产生少量 API 费用。';
    });
  }
  generate(history: Message[], content: string): Promise<GeneratedReply | null> {
    return this.exclusive(async () => {
      const view = this.settings.view();
      if (view.error) throw new Error(view.error);
      if (view.active === 'demo') return null;
      const id = view.active,
        model = view.providers[id].model;
      const key = await this.settings.key(id);
      const answer = await this.call(
        id,
        model,
        key,
        [...history, { role: 'user', content, isDemo: false }],
        false,
      );
      return { content: answer, provider: id, model };
    });
  }
}
