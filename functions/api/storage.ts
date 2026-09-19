interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
}

// 统一的响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-password',
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

/** 校验密码并检查是否过期，通过返回 null，失败返回错误 Response */
const verifyAccess = async (env: Env, request: Request): Promise<Response | null> => {
  const providedPassword = request.headers.get('x-auth-password');
  if (!env.PASSWORD || providedPassword !== env.PASSWORD) {
    return new Response(JSON.stringify({ error: '密码错误' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // 检查密码是否过期
  const websiteConfigStr = await env.CLOUDNAV_KV.get('website_config');
  const websiteConfig = websiteConfigStr ? JSON.parse(websiteConfigStr) : { passwordExpiryDays: 7 };
  const passwordExpiryDays = websiteConfig.passwordExpiryDays || 7;

  if (passwordExpiryDays > 0) {
    const lastAuthTime = await env.CLOUDNAV_KV.get('last_auth_time');
    if (lastAuthTime) {
      const lastTime = parseInt(lastAuthTime);
      const now = Date.now();
      const expiryMs = passwordExpiryDays * 24 * 60 * 60 * 1000;

      // 如果已过期，返回错误
      if (now - lastTime > expiryMs) {
        return new Response(JSON.stringify({ error: '密码已过期，请重新输入' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }
  }

  // 更新最后认证时间
  await env.CLOUDNAV_KV.put('last_auth_time', Date.now().toString());
  return null;
};

// 处理 OPTIONS 请求（解决跨域预检）
export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取配置请求
    if (getConfig === 'ai') {
      // AI 配置含 API Key，访问验密开启时强制验密
      if (await getRequireLoginAccess(env)) {
        const errRes = await verifyAccess(env, request);
        if (errRes) return errRes;
      }
      const aiConfig = await env.CLOUDNAV_KV.get('ai_config');
      return new Response(aiConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取搜索配置请求
    if (getConfig === 'search') {
      const searchConfig = await env.CLOUDNAV_KV.get('search_config');
      return new Response(searchConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取网站配置请求
    if (getConfig === 'website') {
      const websiteConfig = await env.CLOUDNAV_KV.get('website_config');
      return new Response(websiteConfig || JSON.stringify({ passwordExpiryDays: 7 }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取图标请求
    if (getConfig === 'favicon') {
      const domain = url.searchParams.get('domain');
      if (!domain) {
        return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 从KV中获取缓存的图标
      const cachedIcon = await env.CLOUDNAV_KV.get(`favicon:${domain}`);
      if (cachedIcon) {
        return new Response(JSON.stringify({ icon: cachedIcon, cached: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 如果没有缓存，返回空结果
      return new Response(JSON.stringify({ icon: null, cached: false }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 从 KV 中读取数据
    const data = await env.CLOUDNAV_KV.get('app_data');
    
    // 如果是获取数据请求：访问验密开启时强制验密（保护网站数据不公开暴露）
    const requireLoginAccess = await getRequireLoginAccess(env);
    let verified = false;
    if (url.searchParams.get('getConfig') === 'true' || requireLoginAccess) {
      const errRes = await verifyAccess(env, request);
      if (errRes) return errRes;
      verified = true;
      
      // 更新最后认证时间
      await env.CLOUDNAV_KV.put('last_auth_time', Date.now().toString());
    }
    
    if (!data) {
      // 如果没有数据，返回空结构
      return new Response(JSON.stringify({ links: [], categories: [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
        return new Response(JSON.stringify(parsed), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (e) {
        // JSON 解析失败时按原样返回
      }
    }

    return new Response(data, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: corsHeaders,
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
    
    // 如果只是验证密码，不更新数据
    if (body.authOnly) {
      if (!serverPassword) {
        return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      if (providedPassword !== serverPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 更新最后认证时间
      await env.CLOUDNAV_KV.put('last_auth_time', Date.now().toString());
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存搜索配置（允许无密码访问，因为搜索配置不包含敏感数据）
    if (body.saveConfig === 'search') {
      // 如果服务器设置了密码，需要验证密码
      if (serverPassword) {
        if (!providedPassword || providedPassword !== serverPassword) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }
      
      await env.CLOUDNAV_KV.put('search_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存图标（需密码校验，防止匿名滥用刷写 KV）
    if (body.saveConfig === 'favicon') {
      if (serverPassword) {
        if (!providedPassword || providedPassword !== serverPassword) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }
      const { domain, icon } = body;
      // domain 仅允许合法主机名，icon 限制长度（防滥用写入）
      const domainOk = typeof domain === 'string' && /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/.test(domain);
      if (!domainOk || !icon || typeof icon !== 'string' || icon.length > 8192) {
        return new Response(JSON.stringify({ error: 'Invalid domain or icon' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 保存图标到KV，设置过期时间为30天
      await env.CLOUDNAV_KV.put(`favicon:${domain}`, icon, { expirationTtl: 30 * 24 * 60 * 60 });
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 对于其他操作（保存AI配置、应用数据等），需要密码验证
    if (serverPassword) {
      if (!providedPassword || providedPassword !== serverPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存AI配置
    if (body.saveConfig === 'ai') {
      await env.CLOUDNAV_KV.put('ai_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 将数据写入 KV
    await env.CLOUDNAV_KV.put('app_data', JSON.stringify(body));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};