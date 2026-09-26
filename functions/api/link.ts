
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
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

  // 1. Auth Check
  const providedPassword = request.headers.get('x-auth-password');
  const serverPassword = env.PASSWORD;

  if (!serverPassword || providedPassword !== serverPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }

  try {
    const newLinkData = await request.json() as any;
    
    // Validate input
    if (!newLinkData.title || !newLinkData.url) {
        return new Response(JSON.stringify({ error: 'Missing title or url' }), { status: 400, headers: corsHeaders(request) });
    }

    const loadData = async () => {
        const currentDataStr = await env.CLOUDNAV_KV.get('app_data');
        const currentData = currentDataStr ? JSON.parse(currentDataStr) : { links: [], categories: [] };
        if (!Array.isArray(currentData.links)) currentData.links = [];
        if (!Array.isArray(currentData.categories)) currentData.categories = [];
        return currentData;
    };

    // 2. 写入前重新读取，缩小与页面保存之间的覆盖窗口
    let currentData = await loadData();

    // 3. Determine Category
    let targetCatId = '';
    let targetCatName = '';

    // 3a. Check for explicit categoryId from request
    if (newLinkData.categoryId) {
        const explicitCat = currentData.categories.find((c: any) => c.id === newLinkData.categoryId);
        if (explicitCat) {
            targetCatId = explicitCat.id;
            targetCatName = explicitCat.name;
        }
    }

    // 3b. Fallback: Auto-detect if no explicit category or explicit one not found
    if (!targetCatId) {
        if (currentData.categories && currentData.categories.length > 0) {
            // Try to find specific keywords
            const keywords = ['收集', '未分类', 'inbox', 'temp', 'later'];
            const match = currentData.categories.find((c: any) => 
                keywords.some(k => c.name.toLowerCase().includes(k))
            );

            if (match) {
                targetCatId = match.id;
                targetCatName = match.name;
            } else {
                // Fallback to 'common' if exists, else first category
                const common = currentData.categories.find((c: any) => c.id === 'common');
                if (common) {
                    targetCatId = 'common';
                    targetCatName = common.name;
                } else {
                    targetCatId = currentData.categories[0].id;
                    targetCatName = currentData.categories[0].name;
                }
            }
        } else {
            // No categories exist at all
            targetCatId = 'common';
            targetCatName = '默认';
        }
    }

    // 4. Create new link object
    const newLink = {
        id: crypto.randomUUID(),
        title: newLinkData.title,
        url: newLinkData.url,
        description: newLinkData.description || '',
        categoryId: targetCatId, 
        createdAt: Date.now(),
        pinned: false,
        icon: typeof newLinkData.icon === 'string' ? newLinkData.icon : undefined
    };

    // 5. 落盘前再读一次并按 id 合并，避免覆盖刚刚由页面写入的链接
    const fresh = await loadData();
    const seen = new Set((fresh.links || []).map((l: any) => l.id));
    fresh.links = seen.has(newLink.id) ? fresh.links : [newLink, ...fresh.links];
    if (!fresh.categories.length && currentData.categories.length) fresh.categories = currentData.categories;

    // 6. Save back to KV
    await env.CLOUDNAV_KV.put('app_data', JSON.stringify({ links: fresh.links, categories: fresh.categories }));

    return new Response(JSON.stringify({ 
        success: true, 
        link: newLink,
        categoryName: targetCatName 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Failed to save link' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  }
};
