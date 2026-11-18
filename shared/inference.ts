import type { InferenceOptions, ProviderId, ReasoningEffort } from './types';

export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
};
// Explicitly adapted model families, not a guess based on an arbitrary model ID.
export function capabilities(
  provider: ProviderId,
  model: string,
): {
  efforts: ReasoningEffort[];
  fast: boolean;
  defaultEffort?: ReasoningEffort;
} {
  if (
    provider === 'deepseek' &&
    /^(deepseek-flash|deepseek-v4-pro)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
  )
    return { efforts: ['none', 'low', 'high', 'max'], fast: false, defaultEffort: 'none' };
  if (provider === 'openai') {
    if (/^(gpt-6\.1-sol|gpt-6-astra)(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
      return {
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        fast: true,
        defaultEffort: 'low',
      };
    if (
      /^(gpt-6\.1-terra|gpt-6-luna|gpt-6-sol|gpt-5\.6-(?:sol|terra|luna))(?:-\d{4}-\d{2}-\d{2})?$/.test(
        model,
      )
    )
      return {
        efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        fast: !model.startsWith('gpt-5.6-terra') && !model.startsWith('gpt-5.6-luna'),
        defaultEffort: 'low',
      };
  }
  return { efforts: [], fast: false };
}
export function inferenceFor(
  provider: ProviderId,
  model: string,
  saved?: InferenceOptions,
): InferenceOptions {
  const supported = capabilities(provider, model);
  const effort =
    saved?.effort && supported.efforts.includes(saved.effort)
      ? saved.effort
      : supported.defaultEffort;
  return {
    ...(effort ? { effort } : {}),
    speed: supported.fast && saved?.speed === 'fast' ? 'fast' : 'standard',
  };
}
export function modelName(model: string): string {
  return model
    .replace(/^gpt-/, 'GPT-')
    .replace(
      /-(sol|terra|luna|astra)$/,
      (_, tier: string) => ` ${tier[0].toUpperCase()}${tier.slice(1)}`,
    );
}
