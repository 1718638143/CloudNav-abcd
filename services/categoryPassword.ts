/**
 * 分类密码的哈希与校验。
 *
 * 旧版本把分类密码明文存进 app_data，任何拿到数据的客户端都能直接读出明文；
 * 现在统一存 PBKDF2-SHA256 哈希（格式 `pbkdf2$<iterations>$<saltB64>$<hashB64>`），
 * 数据里不再出现明文。校验在客户端完成——该密码的定位是"防未登录访客"而非
 * 抗全部攻击者的加密边界（登录口令才是站点边界），但至少数据落库/导出不再是明文。
 */

const PBKDF2_ITERATIONS = 100_000;
const HASH_PREFIX = 'pbkdf2';

const bytesToB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** 判断存储值是否已经是哈希格式（旧数据是明文） */
export const isCategoryPasswordHash = (stored: unknown): boolean =>
  typeof stored === 'string' && stored.startsWith(`${HASH_PREFIX}$`);

/** 将明文密码转为存储格式（PBKDF2-SHA256 + 随机盐） */
export const hashCategoryPassword = async (plain: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  );
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`;
};

/** 校验输入密码：兼容新哈希格式与旧版明文数据 */
export const verifyCategoryPassword = async (plain: string, stored: string | undefined | null): Promise<boolean> => {
  if (!stored) return false;
  if (!isCategoryPasswordHash(stored)) {
    return plain === stored; // 旧版明文兼容
  }
  try {
    const [, iterStr, saltB64, hashB64] = stored.split('$');
    const iterations = parseInt(iterStr, 10) || PBKDF2_ITERATIONS;
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(plain),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(saltB64), iterations },
      keyMaterial,
      b64ToBytes(hashB64).length * 8
    );
    const got = new Uint8Array(bits);
    const expected = b64ToBytes(hashB64);
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
};
