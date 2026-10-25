interface AuthEnv {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  AUTH_SECRET?: string;
}

const encoder = new TextEncoder();

const getAuthSecret = (env: AuthEnv): string => env.AUTH_SECRET || env.PASSWORD || '';

export const signToken = async (env: AuthEnv, issuedAt: number): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getAuthSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(issuedAt)));
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${issuedAt}.${hex}`;
};

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const readExpiryDays = (config: any): number => {
  const days = Number(config?.passwordExpiryDays);
  return Number.isFinite(days) && days >= 0 ? days : 7;
};

export const getExpiryDays = async (env: AuthEnv): Promise<number> => {
  try {
    const value = await env.CLOUDNAV_KV.get('website_config');
    return readExpiryDays(value ? JSON.parse(value) : {});
  } catch {
    return 7;
  }
};

/**
 * 校验 storage 接口签发的登录令牌。
 * 仅接受 `${issuedAt}.${hmac}`，不接受明文 PASSWORD 作为业务接口凭据。
 */
export const verifyAuthToken = async (
  env: AuthEnv,
  token: string | null,
  configuredExpiryDays?: number
): Promise<boolean> => {
  if (!token || !getAuthSecret(env)) return false;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const issuedAt = Number(token.slice(0, separator));
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;

  const expected = await signToken(env, issuedAt);
  if (!timingSafeEqual(token, expected)) return false;

  const expiryDays = configuredExpiryDays ?? await getExpiryDays(env);
  return expiryDays === 0 || Date.now() - issuedAt <= expiryDays * 24 * 60 * 60 * 1000;
};
