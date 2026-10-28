import { verifyAuthToken } from './auth';

interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  AUTH_SECRET?: string;
}

// Origin 动态回显（仅同主机放行），不再使用 '*'
const corsHeaders = (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  let allow = '';
  if (origin) {
    try {
      if (new URL(origin).host === (request.headers.get('Host') || new URL(request.url).host)) allow = origin;
    } catch {}
  }
  return {
    ...(allow ? { 'Access-Control-Allow-Origin': allow, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
    'Access-Control-Max-Age': '86400',
  };
};

// 把点分/混合进制写法的 IPv4 归一化为 4 段十进制（支持 a、a.b、a.b.c 简写与 0x/0 前缀段）
const normalizeIPv4 = (value: string): number[] | null => {
  const segs = value.split('.');
  if (segs.length < 1 || segs.length > 4) return null;
  const nums: number[] = [];
  for (const seg of segs) {
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(seg)) n = parseInt(seg, 16);
    else if (/^0[0-7]+$/.test(seg)) n = parseInt(seg, 8);
    else if (/^\d+$/.test(seg)) n = parseInt(seg, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  if (nums.length < 4) {
    // 简写形式按 IPv4 整数规则补齐：127.1 → 127.0.0.1
    const last = nums.pop()!;
    nums.push((last >>> 24) & 255, (last >>> 16) & 255, (last >>> 8) & 255, last & 255);
  }
  return nums;
};

const isPrivateIPv4 = (nums: number[]): boolean =>
  nums[0] === 0 || nums[0] === 10 || nums[0] === 127 ||
  (nums[0] === 169 && nums[1] === 254) ||
  (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) ||
  (nums[0] === 192 && nums[1] === 168) ||
  (nums[0] === 100 && nums[1] >= 64 && nums[1] <= 127); // CGNAT

// 判定主机名是否为内网/回环：覆盖十进制/八进制/十六进制 IPv4 变体、
// IPv4 映射的 IPv6（::ffff:127.0.0.1、::7f00:1）、完整展开写法与 ULA/链路本地段
const isPrivateTarget = (rawHost: string): boolean => {
  const host = rawHost.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;

  let ipv6 = '';
  if (host.startsWith('[') && host.endsWith(']')) ipv6 = host.slice(1, -1);
  else if (host.includes(':')) ipv6 = host;
  if (ipv6) {
    const expanded = ipv6.toLowerCase();
    if (expanded === '::' || expanded === '::1' || expanded === '0:0:0:0:0:0:0:1') return true;
    if (/^f[cd]/.test(expanded) || /^fe[89ab]/.test(expanded)) return true; // ULA / 链路本地
    const v4Tail = expanded.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Tail) {
      const nums = normalizeIPv4(v4Tail[1]);
      if (nums) return isPrivateIPv4(nums);
    }
    const hexTail = expanded.match(/([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexTail) {
      const hi = parseInt(hexTail[1], 16), lo = parseInt(hexTail[2], 16);
      const nums = [(hi >>> 8) & 255, hi & 255, (lo >>> 8) & 255, lo & 255];
      if (isPrivateIPv4(nums)) return true;
      if (hi === 0 && expanded.includes('::')) return isPrivateIPv4(nums); // ::7f00:1 形式
    }
    return false;
  }

  if (/^[0-9.]+$/.test(host) && host.includes('.')) {
    const nums = normalizeIPv4(host);
    if (nums) return isPrivateIPv4(nums);
  }
  if (/^\d+$/.test(host)) {
    const n = parseInt(host, 10);
    if (Number.isFinite(n) && n <= 0xffffffff) {
      return isPrivateIPv4([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
    }
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) {
    const n = parseInt(host, 16);
    if (Number.isFinite(n) && n <= 0xffffffff) {
      return isPrivateIPv4([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
    }
  }
  return false;
};

// 常见"子域名通配解析"服务（如 127.0.0.1.nip.io）：子域名可指向任意 IP（含内网/回环），
// 仅靠字面主机名判断拦不住，必须解析内嵌 IP 或保守拦截
const WILDCARD_DNS_SUFFIXES = ['.nip.io', '.sslip.io', '.localtest.me', '.lvh.me', '.vcap.me', '.traefik.me'];

const isWildcardDnsToPrivate = (host: string): boolean => {
  const suffix = WILDCARD_DNS_SUFFIXES.find(s => host.endsWith(s));
  if (!suffix) return false;
  if (suffix === '.localtest.me' || suffix === '.lvh.me' || suffix === '.vcap.me' || suffix === '.traefik.me') {
    return true; // 这几个服务固定解析到 127.0.0.1
  }
  // nip.io/sslip.io：形如 127.0.0.1.nip.io 或 my-site.10-0-0-1.sslip.io（点/连字符两种写法）
  const prefix = host.slice(0, -suffix.length);
  const m = prefix.match(/(\d{1,3})[-.](\d{1,3})[-.](\d{1,3})[-.](\d{1,3})$/);
  if (m) {
    const nums = [m[1], m[2], m[3], m[4]].map(Number);
    if (nums.every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return isPrivateIPv4(nums);
  }
  return true; // 无法识别内嵌 IP 时保守拦截，避免被当作探内网跳板
};

// 校验目标地址：仅 http/https，且主机不得指向内网/回环（含 IPv4 变体、IPv4 映射 IPv6、通配 DNS）
const validateTargetUrl = (rawUrl: string): { url: URL } | { error: 'invalid' | 'private' } => {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { error: 'invalid' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { error: 'invalid' };
  }
  const host = u.hostname.toLowerCase();
  if (isPrivateTarget(host) || isWildcardDnsToPrivate(host)) {
    return { error: 'private' };
  }
  return { url: u };
};

export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request),
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  // 需要登录令牌：防止被滥用作为公开的代理探测接口
  if (!env.PASSWORD) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }

  const token = request.headers.get('x-auth-password');
  if (!(await verifyAuthToken(env, token))) {
    return new Response(JSON.stringify({ error: '登录已过期，请重新输入' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }

  try {
    const { url } = (await request.json()) as { url?: string };
    if (!url) {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }

    const first = validateTargetUrl(url);
    if ('error' in first) {
      if (first.error === 'private') {
        return new Response(JSON.stringify({ error: '不允许探测内网/回环地址' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      return new Response(JSON.stringify({ error: 'Invalid url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      // 重定向手动跟随：每一跳都重新校验协议与目标主机，防止 302 跳进内网/回环地址
      const MAX_REDIRECTS = 3;
      let current: URL = first.url;
      let res: Response;
      let refusedRedirect = false;
      let hop = 0;
      do {
        res = await fetch(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CloudNavLinkCheck/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (res.status < 300 || res.status >= 400 || hop >= MAX_REDIRECTS) break;
        const location = res.headers.get('location');
        if (!location) break;
        hop++;
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, current);
        } catch {
          refusedRedirect = true;
          break;
        }
                const next = validateTargetUrl(nextUrl.toString());
        if ('error' in next) {
          // 重定向目标指向内网/非法地址：拒绝跟随
          refusedRedirect = true;
          break;
        }
        // 释放中间跳转的响应体：Workers 中未读响应体会挂起连接
        try { await res.body?.cancel(); } catch {}
        current = next.url;
      } while (true);

      const status = res.status;
      // 释放最终响应体（本接口只使用状态码）
      try { await res.body?.cancel(); } catch {}
      // <400 可用；401/403/429/5xx 视为"待确认"（可能有访问限制或临时故障）；其余 4xx 为失效
      // 重定向到被拒绝的目标时不能当作"可用"，返回待确认
      let verdict: 'ok' | 'dead' | 'unknown';
      if (refusedRedirect) verdict = 'unknown';
      else if (status < 400) verdict = 'ok';
      else if (status === 401 || status === 403 || status === 429 || status >= 500) verdict = 'unknown';
      else verdict = 'dead';

      return new Response(JSON.stringify({ status, verdict }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    } catch (error: unknown) {
      // 超时或网络层错误（DNS 失败/连接拒绝）
      const aborted = error instanceof Error && error.name === 'AbortError';
      return new Response(
        JSON.stringify({ status: 0, verdict: 'dead', message: aborted ? 'timeout' : 'unreachable' }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } }
      );
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to check link' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }
};
