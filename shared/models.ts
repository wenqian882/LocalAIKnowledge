import type { ProviderId } from './types';
export const MODEL_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    modelsEndpoint: 'https://api.deepseek.com/models',
    defaultModel: 'deepseek-flash',
    suggestions: ['deepseek-flash', 'deepseek-v4-pro'],
    keyURL: 'https://platform.deepseek.com/api_keys',
  },
  openai: {
    name: 'OpenAI（ChatGPT 模型）',
    endpoint: 'https://api.openai.com/v1/responses',
    modelsEndpoint: 'https://api.openai.com/v1/models',
    defaultModel: 'gpt-4.1-mini',
    suggestions: [
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6.1-terra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-4.1',
      'gpt-4.1-mini',
    ],
    keyURL: 'https://platform.openai.com/api-keys',
  },
} as const;
export function isProvider(value: unknown): value is ProviderId {
  return value === 'deepseek' || value === 'openai';
}
export function modelChoices(
  provider: ProviderId,
  settings: { model: string; models?: string[]; catalog?: string[] },
): string[] {
  const preferred: readonly string[] = MODEL_PROVIDERS[provider].suggestions;
  // Keep the reference order stable when selecting models or refreshing the catalog.
  const additional = [
    ...new Set([settings.model, ...(settings.models ?? []), ...(settings.catalog ?? [])]),
  ].filter((model) => !preferred.includes(model));
  additional.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  return [...preferred, ...additional];
}
