import type { ExternalSearchSource, SearchConfig, SearchMode, AIConfig } from '../types';

const ALLOWED_BOOKMARK_PROTOCOLS = new Set(['http:', 'https:']);

export const isSafeBookmarkUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;

  const trimmedUrl = value.trim();
  if (!trimmedUrl) return false;

  try {
    const parsedUrl = new URL(trimmedUrl);
    return ALLOWED_BOOKMARK_PROTOCOLS.has(parsedUrl.protocol.toLowerCase());
  } catch {
    return false;
  }
};

export const isSafeSearchSourceUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.includes('{query}')) return false;
  return isSafeBookmarkUrl(value.replace('{query}', 'test'));
};

export const isSafeSearchSource = (value: unknown): value is ExternalSearchSource => {
  if (!value || typeof value !== 'object') return false;

  const source = value as Partial<ExternalSearchSource>;
  return (
    typeof source.id === 'string' &&
    typeof source.name === 'string' &&
    isSafeSearchSourceUrl(source.url) &&
    typeof source.enabled === 'boolean' &&
    typeof source.createdAt === 'number' &&
    (source.icon === undefined || typeof source.icon === 'string')
  );
};

export const sanitizeSearchConfig = (value: unknown): SearchConfig | null => {
  if (!value || typeof value !== 'object') return null;

  const config = value as Partial<SearchConfig>;
  if (
    (config.mode !== 'internal' && config.mode !== 'external') ||
    !Array.isArray(config.externalSources)
  ) {
    return null;
  }

  const mode: SearchMode = config.mode;
  const externalSources = config.externalSources
    .filter(isSafeSearchSource)
    .map(source => ({ ...source, url: source.url.trim() }));

  const selectedSource = isSafeSearchSource(config.selectedSource)
    ? externalSources.find(source => source.id === config.selectedSource?.id) ?? null
    : null;

  return { mode, externalSources, selectedSource };
};

/**
 * AI 配置白名单校验：用于导入/恢复等不可信输入通道。
 * 防止恶意备份文件把 baseUrl 指向攻击者服务器、替换 apiKey 后静默接管 AI 请求。
 */
export const sanitizeAIConfig = (value: unknown): AIConfig | null => {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<AIConfig>;
  // baseUrl：OpenAI 兼容通道必须是合法 http/https 地址；
  // gemini 不使用 baseUrl，允许空串（应用默认配置即为空，否则合法配置会被误判丢弃）
  const baseUrlOk = candidate.provider === 'gemini'
    ? typeof candidate.baseUrl === 'string' && (candidate.baseUrl.trim() === '' || isSafeBookmarkUrl(candidate.baseUrl))
    : isSafeBookmarkUrl(candidate.baseUrl);
  if (
    (candidate.provider !== 'gemini' && candidate.provider !== 'openai') ||
    typeof candidate.apiKey !== 'string' ||
    typeof candidate.model !== 'string' ||
    !baseUrlOk
  ) {
    return null;
  }

  return {
    ...candidate,
    provider: candidate.provider,
    apiKey: candidate.apiKey,
    baseUrl: candidate.baseUrl.trim(),
    model: candidate.model,
  } as AIConfig;
};
