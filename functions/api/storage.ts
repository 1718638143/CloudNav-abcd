interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  /** 签发登录令牌的密钥；未配置时回退为 PASSWORD，不要求额外环境变量 */
  AUTH_SECRET?: string;
}

// 统一的响应头：Origin 动态回显请求来源（同源/自有站点才放行，不再使用 '*'）
const getAllowedOrigin = (request: Request): string => {
  const origin = request.headers.get('Origin') || '';
  // 同源请求（浏览器一般不带 Origin）或无 Origin 的非浏览器客户端：不需要 CORS 头
  if (!origin) return '';
  try {
    const originHost = new URL(origin).host;
    const reqHost = request.headers.get('Host') || new URL(request.url).host;
    // 仅放行与 API 同主机的来源
    return originHost === reqHost ? origin : '';
  } catch {
    return '';
  }
};

const corsHeaders = (request: Request) => {
  const origin = getAllowedOrigin(request);
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
  };
};

/** 读取访问验密开关，默认开启（未配置过时打开网站需要先输密码） */
const getRequireLoginAccess = async (env: Env): Promise<boolean> => {
  try {
    const str = await env.CLOUDNAV_KV.get('website_config');
    if (str) {
      const cfg = JSON.parse(str);
      if (typeof cfg.requireLoginAccess === 'boolean') return cfg.requireLoginAccess;
    }
  } catch (e) {}
  return true;
};

const encoder = new TextEncoder();

const getAuthSecret = (env: Env): string => env.AUTH_SECRET || env.PASSWORD || '';

/** 签名登录令牌：`${issuedAt}.${hmac}`，过期由令牌自身决定，不再使用全局 last_auth_time */
const signToken = async (env: Env, issuedAt: number): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(getAuthSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(String(issuedAt)));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${issuedAt}.${hex}`;
};

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** 0 表示永不过期；缺失或非数字才回退 7 天，不能用 `||` 把合法的 0 否掉 */
const readExpiryDays = (config: any): number => {
  const days = Number(config?.passwordExpiryDays);
  return Number.isFinite(days) && days >= 0 ? days : 7;
};

const getExpiryDays = async (env: Env): Promise<number> => {
  try {
    const str = await env.CLOUDNAV_KV.get('website_config');
    return readExpiryDays(str ? JSON.parse(str) : {});
  } catch {
    return 7;
  }
};

/** 校验签名令牌是否本服务签发且未过期。旧版明文密码不再作为通行凭据。 */
const verifyToken = async (env: Env, token: string | null, expiryDays: number): Promise<boolean> => {
  if (!token || !getAuthSecret(env)) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const issuedStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const issuedAt = Number(issuedStr);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  const expected = await signToken(env, issuedAt);
  if (!timingSafeEqual(token, expected)) return false;
  if (expiryDays > 0 && Date.now() - issuedAt > expiryDays * 24 * 60 * 60 * 1000) return false;
  return true;
};

const unauthorized = (request: Request, message: string) => new Response(JSON.stringify({ error: message }), {
  status: 401,
  headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
});

/** 校验访问令牌，通过返回 null，失败返回错误 Response */
const verifyAccess = async (env: Env, request: Request): Promise<Response | null> => {
  if (!env.PASSWORD) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }
  const token = request.headers.get('x-auth-password');
  const expiryDays = await getExpiryDays(env);
  const ok = await verifyToken(env, token, expiryDays);
  if (ok) return null;
  // 令牌格式正确但签名不匹配或超过有效期，统一提示重新登录
  const looksLikeToken = !!token && token.includes('.');
  return unauthorized(request, looksLikeToken ? '登录已过期，请重新输入' : '密码错误');
};

// 处理 OPTIONS 请求（解决跨域预检）
export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request),
  });
};

// GET: 获取数据
export const onRequestGet = async (context: { env: Env; request: Request }) => {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const checkAuth = url.searchParams.get('checkAuth');
    const getConfig = url.searchParams.get('getConfig');
    
    // 如果是检查认证请求，返回是否设置了密码以及访问验密开关
    if (checkAuth === 'true') {
      const serverPassword = env.PASSWORD;
      const requireLoginAccess = await getRequireLoginAccess(env);
      return new Response(JSON.stringify({ 
        hasPassword: !!serverPassword,
        requiresAuth: !!serverPassword && requireLoginAccess
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // AI 配置含 API Key，无论访问验密开关是否开启都必须验密
    if (getConfig === 'ai') {
      const errRes = await verifyAccess(env, request);
      if (errRes) return errRes;
      const aiConfig = await env.CLOUDNAV_KV.get('ai_config');
      return new Response(aiConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 如果是获取搜索配置请求
    if (getConfig === 'search') {
      const searchConfig = await env.CLOUDNAV_KV.get('search_config');
      return new Response(searchConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 网站配置：公开字段任何人可读；passwordExpiryDays 只在登录后返回
    if (getConfig === 'website') {
      const websiteConfigStr = await env.CLOUDNAV_KV.get('website_config');
      let websiteConfig: any = {};
      try { websiteConfig = websiteConfigStr ? JSON.parse(websiteConfigStr) : {}; } catch { websiteConfig = {}; }
      const publicConfig = {
        title: websiteConfig.title,
        navTitle: websiteConfig.navTitle,
        favicon: websiteConfig.favicon,
        cardStyle: websiteConfig.cardStyle,
        wallpaper: websiteConfig.wallpaper,
        requireLoginAccess: websiteConfig.requireLoginAccess,
      };
      const expiryDays = await getExpiryDays(env);
      const authed = await verifyToken(env, request.headers.get('x-auth-password'), expiryDays);
      const body = authed ? { ...publicConfig, passwordExpiryDays: readExpiryDays(websiteConfig) } : publicConfig;
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 在线备份：列表 / 下载指定备份（含书签数据，需密码）
    if (getConfig === 'backup') {
      const errRes = await verifyAccess(env, request);
      if (errRes) return errRes;
      
      const backupId = url.searchParams.get('id');
      if (backupId) {
        if (!/^cloudnav_backup_\d+_[a-z0-9]+$/.test(backupId)) {
          return new Response(JSON.stringify({ error: 'Invalid backup id' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
          });
        }
        const data = await env.CLOUDNAV_KV.get(`backup:${backupId}`);
        if (!data) {
          return new Response(JSON.stringify({ error: '备份不存在或已被清理' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
          });
        }
        return new Response(data, {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      
      const indexStr = await env.CLOUDNAV_KV.get('backup_index');
      let index: any[] = [];
      try { index = indexStr ? JSON.parse(indexStr) : []; } catch (e) {}
      return new Response(JSON.stringify({ success: true, files: index }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 如果是获取图标请求
    if (getConfig === 'favicon') {
      const domain = url.searchParams.get('domain');
      if (!domain) {
        return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      
      // 从KV中获取缓存的图标
      const cachedIcon = await env.CLOUDNAV_KV.get(`favicon:${domain}`);
      if (cachedIcon) {
        return new Response(JSON.stringify({ icon: cachedIcon, cached: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      
      // 如果没有缓存，返回空结果
      return new Response(JSON.stringify({ icon: null, cached: false }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 从 KV 中读取数据
    const data = await env.CLOUDNAV_KV.get('app_data');
    
    // 获取数据：访问验密开启时强制验密（保护网站数据不公开暴露）
    const requireLoginAccess = await getRequireLoginAccess(env);
    let verified = false;
    if (requireLoginAccess) {
      const errRes = await verifyAccess(env, request);
      if (errRes) return errRes;
      verified = true;
    } else {
      // 关闭访问验密时仍识别有效令牌，以便已登录用户拿到完整数据而不是脱敏视图
      verified = await verifyToken(env, request.headers.get('x-auth-password'), await getExpiryDays(env));
    }
    
    if (!data) {
      // 如果没有数据，返回空结构
      return new Response(JSON.stringify({ links: [], categories: [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }

    // 未通过密码验证时：过滤带密码（隐私）分类的链接，并剥离分类的密码字段，
    // 防止抓包直接读到受保护分类的链接数据
    if (url.searchParams.get('getConfig') !== 'true' && !verified) {
      try {
        const parsed = JSON.parse(data);
        const lockedIds = new Set(
          (parsed.categories || [])
            .filter((c: any) => c.password)
            .map((c: any) => c.id as string)
        );
        if (lockedIds.size > 0) {
          parsed.links = (parsed.links || []).filter((l: any) => !lockedIds.has(l.categoryId));
        }
        // 子分类跟随父分类：父分类锁定时其子分类也视为锁定
        const parentOf = new Map((parsed.categories || []).map((c: any) => [c.id, c.parentId]));
        const isLockedDeep = (id: string): boolean => {
          let cur = id;
          while (cur) {
            if (lockedIds.has(cur)) return true;
            cur = parentOf.get(cur) as string;
          }
          return false;
        };
        parsed.links = (parsed.links || []).filter((l: any) => !isLockedDeep(l.categoryId));
        parsed.categories = (parsed.categories || []).map((c: any) => {
          const { password, ...rest } = c;
          return rest;
        });
        // 打上脱敏标记：客户端据此识别“这是不完整的公开视图”，禁止把它回写到 app_data，
        // 否则会把加密分类的密码字段抹掉、丢失受保护分类的链接
        return new Response(JSON.stringify({ ...parsed, _sanitized: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (e) {
        // JSON 解析失败时按原样返回
      }
    }

    return new Response(data, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: corsHeaders(context.request),
    });
  }
};

// POST: 保存数据
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  // 1. 验证密码（对于敏感操作需要密码）
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;

  try {
    const body = await request.json();
    
    // 只验证密码：通过后签发独立的签名令牌，不再写入全局 last_auth_time
    if (body.authOnly) {
      if (!serverPassword) {
        return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      
      if (providedPassword !== serverPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      
      const token = await signToken(env, Date.now());
      return new Response(JSON.stringify({ success: true, token }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 如果是保存搜索配置（允许无密码访问，因为搜索配置不包含敏感数据）
    if (body.saveConfig === 'search') {
      // 如果服务器设置了密码，需要验证密码
      if (serverPassword) {
        if (!providedPassword || providedPassword !== serverPassword) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
          });
        }
      }
      
      await env.CLOUDNAV_KV.put('search_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 如果是保存图标（需密码校验，防止匿名滥用刷写 KV）
    if (body.saveConfig === 'favicon') {
      if (serverPassword) {
        if (!providedPassword || providedPassword !== serverPassword) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
          });
        }
      }
      const { domain, icon } = body;
      // domain 仅允许合法主机名，icon 限制长度（防滥用写入）
      const domainOk = typeof domain === 'string' && /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/.test(domain);
      if (!domainOk || !icon || typeof icon !== 'string' || icon.length > 8192) {
        return new Response(JSON.stringify({ error: 'Invalid domain or icon' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      
      // 保存图标到KV，设置过期时间为30天
      await env.CLOUDNAV_KV.put(`favicon:${domain}`, icon, { expirationTtl: 30 * 24 * 60 * 60 });
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 对于其他操作（保存AI配置、应用数据等），需要密码验证
    if (serverPassword) {
      if (!providedPassword || providedPassword !== serverPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 如果是保存AI配置
    if (body.saveConfig === 'ai') {
      await env.CLOUDNAV_KV.put('ai_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 如果是保存网站配置
    if (body.saveConfig === 'website') {
      // 合并旧配置：避免前端某个入口漏传字段时把已有设置覆盖丢失
      const oldStr = await env.CLOUDNAV_KV.get('website_config');
      let oldConfig: any = {};
      try { oldConfig = oldStr ? JSON.parse(oldStr) : {}; } catch (e) {}
      const merged = { ...oldConfig, ...body.config };
      await env.CLOUDNAV_KV.put('website_config', JSON.stringify(merged));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 如果是保存在线备份（KV 存储快照）
    if (body.saveConfig === 'backup') {
      const backupData = body.data;
      if (!backupData || !Array.isArray(backupData.links) || !Array.isArray(backupData.categories)) {
        return new Response(JSON.stringify({ error: '备份数据结构不完整' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      const id = `cloudnav_backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const size = JSON.stringify(backupData).length;
      await env.CLOUDNAV_KV.put(`backup:${id}`, JSON.stringify(backupData));
      
      // 更新索引并保留最近 20 份
      const indexStr = await env.CLOUDNAV_KV.get('backup_index');
      let index: any[] = [];
      try { index = indexStr ? JSON.parse(indexStr) : []; } catch (e) {}
      index.unshift({ id, createdAt: Date.now(), size, links: backupData.links.length, categories: backupData.categories.length });
      const keep = 20;
      const removed = index.splice(keep);
      await env.CLOUDNAV_KV.put('backup_index', JSON.stringify(index));
      for (const item of removed) {
        await env.CLOUDNAV_KV.delete(`backup:${item.id}`);
      }
      
      return new Response(JSON.stringify({ success: true, id, total: index.length }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 删除指定备份
    if (body.deleteBackup) {
      const delId = String(body.deleteBackup);
      // 防止误删非备份键
      if (!/^cloudnav_backup_\d+_[a-z0-9]+$/.test(delId)) {
        return new Response(JSON.stringify({ error: 'Invalid backup id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
      await env.CLOUDNAV_KV.delete(`backup:${delId}`);
      const indexStr = await env.CLOUDNAV_KV.get('backup_index');
      let index: any[] = [];
      try { index = indexStr ? JSON.parse(indexStr) : []; } catch (e) {}
      index = index.filter((i) => i.id !== delId);
      await env.CLOUDNAV_KV.put('backup_index', JSON.stringify(index));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    
    // 只接受完整的书签结构，拒绝 null / 缺字段覆盖全部数据
    if (!Array.isArray(body.links) || !Array.isArray(body.categories)) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
    await env.CLOUDNAV_KV.put('app_data', JSON.stringify({ links: body.links, categories: body.categories }));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }
};