interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
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

export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request),
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  // 需要密码：防止被滥用作为公开的代理探测接口
  const providedPassword = request.headers.get('x-auth-password');
  if (!env.PASSWORD || providedPassword !== env.PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
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

    // 仅允许 http/https，禁止其他协议；同时拒绝内网/回环地址，防止被用作内网探测
    let target: URL;
    try {
      target = new URL(url);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('bad protocol');
      }
      const host = target.hostname.toLowerCase();
      const isPrivateHost =
        host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
        host === '0.0.0.0' || host === '[::]' || host === '::1' ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host.startsWith('[') && (/^\[::1\]$/.test(host) || /^\[f[cd]/i.test(host) || /^\[fe80/i.test(host));
      if (isPrivateHost) {
        throw new Error('private address');
      }
    } catch (e: any) {
      if (e?.message === 'private address') {
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
      // 服务端 fetch 不受浏览器 CORS 限制，可读取真实 HTTP 状态码
      const res = await fetch(target.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CloudNavLinkCheck/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const status = res.status;
      // <400 可用；401/403/429/5xx 视为"待确认"（可能有访问限制或临时故障）；其余 4xx 为失效
      let verdict: 'ok' | 'dead' | 'unknown';
      if (status < 400) verdict = 'ok';
      else if (status === 401 || status === 403 || status === 429 || status >= 500) verdict = 'unknown';
      else verdict = 'dead';

      return new Response(JSON.stringify({ status, verdict }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    } catch (e: any) {
      // 超时或网络层错误（DNS 失败/连接拒绝）
      const aborted = e?.name === 'AbortError';
      return new Response(
        JSON.stringify({ status: 0, verdict: 'dead', message: aborted ? 'timeout' : 'unreachable' }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders(request) } }
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Failed to check link' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }
};
