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

export const timingSafeEqual = async (left: string, right: string): Promise<boolean> => {
  // 先对两侧做 SHA-256 再比较：摘要等长，消除长度不等时提前返回的时序侧信道
  // （原实现 left.length !== right.length 立即返回，可被用于探测期望令牌长度）
  const digest = async (value: string) => crypto.subtle.digest('SHA-256', encoder.encode(value));
  const [leftBuf, rightBuf] = await Promise.all([digest(left), digest(right)]);

  const leftBytes = new Uint8Array(leftBuf);
  const rightBytes = new Uint8Array(rightBuf);

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

export const readExpiryDays = (config: unknown): number => {
  const value = config && typeof config === 'object' && 'passwordExpiryDays' in config
    ? config.passwordExpiryDays
    : undefined;
  const days = Number(value);
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

  // 未来时间戳的令牌永远满足过期检查（Date.now() - issuedAt 为负数），必须拒绝；
  // 允许 60 秒时钟偏差
  if (issuedAt > Date.now() + 60_000) return false;

  const expected = await signToken(env, issuedAt);
  if (!(await timingSafeEqual(token, expected))) return false;

  const expiryDays = configuredExpiryDays ?? await getExpiryDays(env);
  return expiryDays === 0 || Date.now() - issuedAt <= expiryDays * 24 * 60 * 60 * 1000;
};
