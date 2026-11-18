import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MODEL_PROVIDERS, isProvider } from '../shared/models';
import { capabilities } from '../shared/inference';
import type {
  InferenceOptions,
  ModelSettingsView,
  ProviderId,
  SaveModelInput,
  SetInferenceInput,
} from '../shared/types';

export interface SecretCodec {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}
interface SavedSettings {
  version: 1;
  active: ProviderId | 'demo';
  providers: Record<
    ProviderId,
    {
      model: string;
      encryptedKey?: string;
      models?: string[];
      catalog?: string[];
      catalogUpdatedAt?: string;
      inference?: Record<string, InferenceOptions>;
    }
  >;
}
export function validateModel(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(value.trim()))
    throw new Error('请填写有效的模型名称（最多 100 个字母、数字、点、冒号或连字符）');
  return value.trim();
}
export function validateKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('API Key 格式不正确');
  const key = value.trim();
  if (!/^[\x21-\x7e]{8,512}$/.test(key))
    throw new Error('请粘贴完整的 API Key，不包含 Bearer、空格或换行');
  return key;
}
export class ModelSettings {
  private saved: SavedSettings = {
    version: 1,
    active: 'demo',
    providers: {
      deepseek: { model: MODEL_PROVIDERS.deepseek.defaultModel },
      openai: { model: MODEL_PROVIDERS.openai.defaultModel },
    },
  };
  private error?: string;
  readonly filePath: string;
  constructor(
    dataPath: string,
    private readonly codec: SecretCodec,
  ) {
    this.filePath = path.join(dataPath, 'model-settings.json');
    if (fs.existsSync(this.filePath)) {
      try {
        const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (value.version !== 1 || (!isProvider(value.active) && value.active !== 'demo'))
          throw new Error();
        for (const id of ['deepseek', 'openai'] as const) {
          validateModel(value.providers[id].model);
          const inference = value.providers[id].inference;
          if (inference !== undefined) {
            if (
              !inference ||
              typeof inference !== 'object' ||
              Array.isArray(inference) ||
              Object.keys(inference).length > 1000
            )
              throw new Error();
            for (const [model, options] of Object.entries(inference)) {
              validateModel(model);
              const item = options as InferenceOptions;
              if (
                !item ||
                !['standard', 'fast'].includes(item.speed) ||
                (item.effort !== undefined &&
                  !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(item.effort))
              )
                throw new Error();
            }
          }
          for (const field of ['models', 'catalog'] as const) {
            const names = value.providers[id][field];
            if (names !== undefined) {
              if (!Array.isArray(names) || names.length > 1000) throw new Error();
              names.forEach(validateModel);
            }
          }
          if (
            value.providers[id].catalogUpdatedAt !== undefined &&
            typeof value.providers[id].catalogUpdatedAt !== 'string'
          )
            throw new Error();
          if (
            value.providers[id].encryptedKey !== undefined &&
            (typeof value.providers[id].encryptedKey !== 'string' ||
              !/^[A-Za-z0-9+/=]+$/.test(value.providers[id].encryptedKey))
          )
            throw new Error();
        }
        this.saved = value;
      } catch {
        this.error =
          '模型设置文件无法读取，已暂停外部调用。请关闭应用并备份数据目录中的 model-settings.json 后处理；应用不会自动覆盖它。';
      }
    }
  }
  view(): ModelSettingsView {
    return {
      active: this.saved.active,
      providers: {
        deepseek: {
          model: this.saved.providers.deepseek.model,
          hasKey: !!this.saved.providers.deepseek.encryptedKey,
          models: [
            ...new Set([
              this.saved.providers.deepseek.model,
              ...(this.saved.providers.deepseek.models ?? []),
            ]),
          ],
          catalog: [...(this.saved.providers.deepseek.catalog ?? [])],
          catalogUpdatedAt: this.saved.providers.deepseek.catalogUpdatedAt,
          inference: structuredClone(this.saved.providers.deepseek.inference ?? {}),
        },
        openai: {
          model: this.saved.providers.openai.model,
          hasKey: !!this.saved.providers.openai.encryptedKey,
          models: [
            ...new Set([
              this.saved.providers.openai.model,
              ...(this.saved.providers.openai.models ?? []),
            ]),
          ],
          catalog: [...(this.saved.providers.openai.catalog ?? [])],
          catalogUpdatedAt: this.saved.providers.openai.catalogUpdatedAt,
          inference: structuredClone(this.saved.providers.openai.inference ?? {}),
        },
      },
      ...(this.error ? { error: this.error } : {}),
    };
  }
  private assertReadable() {
    if (this.error) throw new Error(this.error);
  }
  async key(id: ProviderId): Promise<string> {
    this.assertReadable();
    const encrypted = this.saved.providers[id].encryptedKey;
    if (!encrypted) throw new Error('请先在设置中粘贴并保存该服务商的 API Key');
    try {
      return await this.codec.decrypt(Buffer.from(encrypted, 'base64'));
    } catch {
      throw new Error('无法解密已保存的 API Key，请在本机重新粘贴密钥并保存');
    }
  }
  private persist(next: SavedSettings) {
    this.assertReadable();
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      fs.renameSync(temporary, this.filePath);
      this.saved = next;
    } catch {
      throw new Error('模型配置保存失败，请检查应用数据目录权限与可用空间');
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  async save(input: SaveModelInput): Promise<ModelSettingsView> {
    this.assertReadable();
    if (!input || !isProvider(input.provider)) throw new Error('请选择 DeepSeek 或 OpenAI');
    const model = validateModel(input.model);
    if (typeof input.apiKey !== 'string') throw new Error('API Key 格式不正确');
    const id = input.provider;
    let encryptedKey = this.saved.providers[id].encryptedKey;
    if (input.apiKey.trim()) {
      const key = validateKey(input.apiKey);
      if (!(await this.codec.available()))
        throw new Error('系统加密服务不可用，密钥未保存；应用不会降级成明文存储');
      try {
        encryptedKey = (await this.codec.encrypt(key)).toString('base64');
      } catch {
        throw new Error('API Key 加密失败，未保存配置');
      }
    }
    if (!encryptedKey) throw new Error('请先粘贴该服务商的 API Key');
    // Also reject a broken saved credential before enabling it.
    if (!input.apiKey.trim()) await this.key(id);
    const next = structuredClone(this.saved);
    const models = [
      ...new Set([...(next.providers[id].models ?? []), next.providers[id].model, model]),
    ];
    if (models.length > 1000) throw new Error('保存的模型名称过多，请使用已有模型');
    next.providers[id] = { ...next.providers[id], model, encryptedKey, models };
    next.active = id;
    this.persist(next);
    return this.view();
  }
  demo(): ModelSettingsView {
    const next = structuredClone(this.saved);
    next.active = 'demo';
    this.persist(next);
    return this.view();
  }
  configure(input: SetInferenceInput): ModelSettingsView {
    this.assertReadable();
    if (!input || !isProvider(input.provider)) throw new Error('请选择服务商');
    const model = validateModel(input.model);
    const allowed = capabilities(input.provider, model);
    if (
      (input.effort !== undefined && !allowed.efforts.includes(input.effort)) ||
      (allowed.efforts.length && input.effort === undefined)
    )
      throw new Error('该模型不支持所选推理强度');
    if (!['standard', 'fast'].includes(input.speed) || (input.speed === 'fast' && !allowed.fast))
      throw new Error('该模型暂不支持快速模式');
    if (!this.saved.providers[input.provider].encryptedKey)
      throw new Error('请先保存该服务商的 API Key');
    const next = structuredClone(this.saved);
    const options = next.providers[input.provider].inference ?? {};
    if (!Object.hasOwn(options, model) && Object.keys(options).length >= 1000)
      throw new Error('模型设置过多');
    Object.defineProperty(options, model, {
      value: { ...(input.effort ? { effort: input.effort } : {}), speed: input.speed },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    next.providers[input.provider].inference = options;
    this.persist(next);
    return this.view();
  }
  cacheCatalog(id: ProviderId, models: string[]): ModelSettingsView {
    if (!isProvider(id) || !Array.isArray(models) || models.length > 1000)
      throw new Error('模型列表格式无效');
    const next = structuredClone(this.saved);
    next.providers[id].catalog = [...new Set(models.map(validateModel))];
    next.providers[id].catalogUpdatedAt = new Date().toISOString();
    this.persist(next);
    return this.view();
  }
  remove(id: ProviderId): ModelSettingsView {
    if (!isProvider(id)) throw new Error('服务商无效');
    const next = structuredClone(this.saved);
    delete next.providers[id].encryptedKey;
    if (next.active === id) next.active = 'demo';
    this.persist(next);
    return this.view();
  }
}
