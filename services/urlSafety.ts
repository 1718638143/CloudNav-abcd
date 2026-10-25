import type { ExternalSearchSource, SearchConfig, SearchMode } from '../types';

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
