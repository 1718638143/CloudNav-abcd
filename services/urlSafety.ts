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
