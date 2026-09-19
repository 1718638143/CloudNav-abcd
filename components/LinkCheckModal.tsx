import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  X, Link2, Loader2, CheckCircle2, XCircle, HelpCircle, Activity,
  ShieldCheck, ShieldAlert, Play, RotateCcw, ChevronRight, ChevronDown, ExternalLink
} from 'lucide-react';
import { LinkItem, Category } from '../types';

interface LinkCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  links: LinkItem[];
  categories: Category[];
  authToken?: string;
}

type CheckStatus = 'idle' | 'checking' | 'ok' | 'dead' | 'unknown';

interface CheckResult {
  status: CheckStatus;
  httpStatus?: number;
  message: string;
}

interface CheckRow extends LinkItem {
  result: CheckResult;
}

const CONCURRENCY = 6;
const TIMEOUT_MS = 10000;

const classify = (code?: number): 'ok' | 'dead' | 'unknown' => {
  if (!code) return 'unknown';
  if (code < 400) return 'ok';
  if (code === 429 || code >= 500) return 'unknown';
  if (code === 401 || code === 403) return 'unknown';
  return 'dead';
};

/** 带 401/403/5xx 容错的文案 */
const verdictMessage = (code: number): string => {
  if (code === 401 || code === 403) return `HTTP ${code}（可能有访问限制）`;
  if (code === 429) return `HTTP 429（请求过于频繁）`;
  if (code >= 500) return `HTTP ${code}（服务器错误）`;
  if (code >= 400) return `HTTP ${code}`;
  return '可达';
};

/** fetch + timeout，返回 HTTP 状态码；no-cors 模式下响应为 opaque，按 200 处理 */
async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<number | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return undefined; }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    // mode: 'no-cors' 用于绕过 CORS 限制做"可达性"探测；多数站点不带 CORS 头
    const res = await fetch(url, {
      mode: 'no-cors',
      redirect: 'follow',
      signal: ctrl.signal,
    });
    return res.type === 'opaque' ? 200 : res.status;
  } catch (e: any) {
    if (e?.name === 'AbortError') return signal?.aborted ? undefined : 0;
    return 0; // 网络层错误（DNS 失败 / 连接拒绝等）
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 用 <img> 加载站点 favicon 做可达性探测：
 * - 优点：没有 CORS 限制，跨域站点也能探测
 * - onload / onerror 都说明网络可达（能拿到 HTTP 应答）
 * - 长时间无响应则返回 null（无法判断，交给 fetch 回退）
 */
function probeWithImage(url: string, signal?: AbortSignal): Promise<boolean | null> {
  return new Promise((resolve) => {
    let settled = false;
    const img = new Image();
    const finish = (v: boolean | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      img.src = '';
      resolve(v);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    if (signal) {
      if (signal.aborted) { finish(null); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    img.src = url;
  });
}

/**
 * 检测单个链接：
 * 0. 优先走后端 /api/check-link 精确探测（服务端 fetch 读真实 HTTP 状态码，需 authToken）
 * 1. 后端不可用时回退 <img> favicon 探测（无 CORS 限制，域名级可达性）
 * 2. img 无法判断时回退 fetch no-cors 再试一次
 */
async function checkLink(url: string, signal?: AbortSignal, authToken?: string): Promise<CheckResult> {
  const raw = (url || '').trim();
  if (!raw) return { status: 'unknown', message: '链接为空' };

  let target: URL;
  try {
    target = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return { status: 'dead', message: 'URL 格式无效' };
  }

  // 0) 后端精确探测（真实 HTTP 状态码）
  if (authToken) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS + 2000);
      if (signal) {
        if (signal.aborted) { clearTimeout(timer); return { status: 'unknown', message: '已取消' }; }
        signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      }
      const res = await fetch('/api/check-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-password': authToken },
        body: JSON.stringify({ url: raw }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const verdict = data.verdict as 'ok' | 'dead' | 'unknown';
        const status = data.status as number;
        if (verdict === 'ok') return { status: 'ok', httpStatus: status, message: `HTTP ${status}` };
        if (verdict === 'dead') {
          return { status: 'dead', httpStatus: status, message: status === 0 ? '无法连接或超时' : `HTTP ${status}` };
        }
        return { status: 'unknown', httpStatus: status, message: verdictMessage(status) };
      }
      // 后端报错（如未登录）则继续走前端探测
    } catch (e) {
      // 后端不可达，回退前端探测
    }
  }

  // 1) 图片探测（favicon）——探测结果是"域名级"，站点根可达即认为链接可用
  const imgProbe = await probeWithImage(`https://${target.host}/favicon.ico`, signal);
  if (imgProbe === true) return { status: 'ok', message: '可达' };

  // 2) fetch no-cors 回退
  const code = await fetchWithTimeout(raw, signal);
  if (code === undefined) return { status: 'unknown', message: '已取消' };
  if (code > 0) {
    return { status: classify(code), httpStatus: code, message: verdictMessage(code) };
  }

  // 3) img 探测明确失败 + fetch 网络层也失败 → 判定为失效（超时/无法连接/DNS 失败）
  return { status: 'dead', message: '无法连接或超时' };
}

const LinkCheckModal: React.FC<LinkCheckModalProps> = ({
  isOpen, onClose, links, categories, authToken
}) => {
  // ---------- 选择状态 ----------
  const [selected, setSelected] = useState<Set<string>>(new Set(['all']));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ---------- 运行状态 ----------
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<CheckRow[]>([]);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set(['all']));
      setExpanded(new Set());
      setRows([]);
      setProgress({ done: 0, total: 0 });
      setIsRunning(false);
    }
  }, [isOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---------- 分类树 ----------
  const tree = useMemo(() => {
    const tops = categories.filter(c => !c.parentId);
    return tops.map(top => ({
      cat: top,
      subs: categories.filter(c => c.parentId === top.id),
    }));
  }, [categories]);

  /** 分类 id -> 显示名（子分类带父级前缀，避免重名混淆） */
  const catName = useCallback((id: string) => {
    const c = categories.find(x => x.id === id);
    if (!c) return '未分类';
    if (c.parentId) {
      const p = categories.find(x => x.id === c.parentId);
      return p ? `${p.name} / ${c.name}` : c.name;
    }
    return c.name;
  }, [categories]);

  /** 选中集合 => 参与检测的链接 */
  const targetLinks = useMemo(() => {
    if (selected.has('all')) return links;
    const set = new Set(selected);
    // 若选中父分类，则其子分类的链接也包含
    categories.forEach(c => { if (c.parentId && set.has(c.parentId)) set.add(c.id); });
    return links.filter(l =>
      set.has(l.categoryId) ||
      // 未分类：分类列表中找不到该链接所属分类
      (set.has('__uncategorized__') && !categories.some(c => c.id === l.categoryId))
    );
  }, [selected, links, categories]);

  const stats = useMemo(() => {
    let ok = 0, dead = 0, unknown = 0, checked = 0;
    rows.forEach(r => {
      if (r.result.status === 'ok') { ok++; checked++; }
      else if (r.result.status === 'dead') { dead++; checked++; }
      else if (r.result.status === 'unknown') { unknown++; checked++; }
    });
    return { ok, dead, unknown, checked, total: rows.length };
  }, [rows]);

  const deadRows = useMemo(() => rows.filter(r => r.result.status === 'dead'), [rows]);
  const unknownRows = useMemo(() => rows.filter(r => r.result.status === 'unknown'), [rows]);

  // ---------- 交互 ----------
  const toggleCat = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.delete('all');
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) next.add('all');
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => (prev.has('all') ? new Set<string>() : new Set(['all'])));
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** 并发跑一批检测任务 */
  const runBatch = async (targets: LinkItem[], signal: AbortSignal, myRunId: number) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        if (signal.aborted || runIdRef.current !== myRunId) return;
        const link = targets[cursor++];
        const result = await checkLink(link.url, signal, authToken);
        if (signal.aborted || runIdRef.current !== myRunId) return;
        setRows(prev => prev.map(r => (r.id === link.id ? { ...r, result } : r)));
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker);
    await Promise.all(workers);
  };

  const startCheck = async () => {
    if (isRunning || targetLinks.length === 0) return;
    const myRunId = ++runIdRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const initial: CheckRow[] = targetLinks.map(l => ({
      ...l,
      result: { status: 'checking' as CheckStatus, message: '检测中...' },
    }));
    setRows(initial);
    setProgress({ done: 0, total: initial.length });
    setIsRunning(true);
    await runBatch(targetLinks, ctrl.signal, myRunId);
    if (runIdRef.current === myRunId && !ctrl.signal.aborted) {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const stopCheck = () => {
    runIdRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setRows(prev => prev.map(r => (r.result.status === 'checking'
      ? { ...r, result: { status: 'unknown' as CheckStatus, message: '已取消' } }
      : r)));
  };

  const retryRow = async (row: CheckRow) => {
    if (isRunning) return;
    setRows(prev => prev.map(r => (r.id === row.id
      ? { ...r, result: { status: 'checking' as CheckStatus, message: '检测中...' } }
      : r)));
    const result = await checkLink(row.url, undefined, authToken);
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, result } : r)));
  };

  if (!isOpen) return null;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  // ---------- 结果列表渲染（按检测顺序） ----------
  const renderRow = (r: CheckRow) => (
    <div key={r.id} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">
      <div className="shrink-0 w-5 flex justify-center">
        {r.result.status === 'ok' && <CheckCircle2 size={16} className="text-green-500" />}
        {r.result.status === 'dead' && <XCircle size={16} className="text-red-500" />}
        {r.result.status === 'unknown' && <HelpCircle size={16} className="text-amber-500" />}
        {r.result.status === 'checking' && <Loader2 size={16} className="text-blue-500 animate-spin" />}
        {r.result.status === 'idle' && <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{r.title}</span>
          <span className="text-xs text-slate-400 shrink-0">{catName(r.categoryId)}</span>
        </div>
        <div className="text-xs text-slate-400 truncate">{r.url}</div>
      </div>
      <span className={`text-xs shrink-0 ${
        r.result.status === 'ok' ? 'text-green-600 dark:text-green-400' :
        r.result.status === 'dead' ? 'text-red-500' :
        r.result.status === 'unknown' ? 'text-amber-500' : 'text-slate-400'
      }`}>{r.result.message}</span>
      {!isRunning && (r.result.status === 'dead' || r.result.status === 'unknown') && (
        <button
          onClick={() => retryRow(r)}
          className="shrink-0 p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-md transition-colors"
          title="重新检测"
        >
          <RotateCcw size={13} />
        </button>
      )}
      <a
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-md transition-colors"
        title="打开链接"
      >
        <ExternalLink size={13} />
      </a>
    </div>
  );

  const summaryBlock = (
    <div className="grid grid-cols-3 gap-2">
      <div className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-green-50 dark:bg-green-900/20">
        <CheckCircle2 size={14} className="text-green-500" />
        <span className="text-xs text-slate-600 dark:text-slate-300">可用</span>
        <span className="text-sm font-bold text-green-600 dark:text-green-400">{stats.ok}</span>
      </div>
      <div className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-red-50 dark:bg-red-900/20">
        <XCircle size={14} className="text-red-500" />
        <span className="text-xs text-slate-600 dark:text-slate-300">失效</span>
        <span className="text-sm font-bold text-red-500">{stats.dead}</span>
      </div>
      <div className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
        <HelpCircle size={14} className="text-amber-500" />
        <span className="text-xs text-slate-600 dark:text-slate-300">待确认</span>
        <span className="text-sm font-bold text-amber-500">{stats.unknown}</span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2">
            <Activity className="text-blue-500" /> 批量检测链接
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 分类选择 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">选择检测范围</h4>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={selected.has('all')}
                  onChange={toggleAll}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                全部分类（{links.length} 个链接）
              </label>
            </div>
            <div
              className={`max-h-44 overflow-y-auto rounded-xl border p-2 space-y-1 transition-opacity ${
                selected.has('all')
                  ? 'border-slate-200 dark:border-slate-700 opacity-40 pointer-events-none'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {tree.map(({ cat, subs }) => {
                const topCount = links.filter(l => l.categoryId === cat.id || subs.some(s => s.id === l.categoryId)).length;
                const isExpanded = expanded.has(cat.id);
                return (
                  <div key={cat.id}>
                    <div className="flex items-center gap-1">
                      {subs.length > 0 ? (
                        <button
                          onClick={() => toggleExpand(cat.id)}
                          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
                          title={isExpanded ? '收起' : '展开子分类'}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : (
                        <div className="w-6" />
                      )}
                      <button
                        onClick={() => toggleCat(cat.id)}
                        className={`flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                          selected.has(cat.id)
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="text-sm leading-none">{cat.icon}</span>
                          <span className="truncate">{cat.name}</span>
                        </span>
                        <span className="text-xs text-slate-400 shrink-0 ml-2">{topCount} 个</span>
                      </button>
                    </div>
                    {subs.length > 0 && isExpanded && (
                      <div className="ml-6 mt-1 space-y-1">
                        {subs.map(sub => {
                          const count = links.filter(l => l.categoryId === sub.id).length;
                          return (
                            <button
                              key={sub.id}
                              onClick={() => toggleCat(sub.id)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                                selected.has(sub.id)
                                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              <span className="flex items-center gap-2 truncate">
                                <span className="text-sm leading-none">{sub.icon}</span>
                                <span className="truncate">{sub.name}</span>
                              </span>
                              <span className="text-xs text-slate-400 shrink-0 ml-2">{count} 个</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {links.some(l => !categories.some(c => c.id === l.categoryId)) && (
                <button
                  onClick={() => toggleCat('__uncategorized__')}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                    selected.has('__uncategorized__')
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <span className="truncate">未分类</span>
                </button>
              )}
            </div>
            {!selected.has('all') && (
              <p className="text-xs text-slate-400 mt-1.5">
                将检测 <span className="text-blue-500 font-medium">{targetLinks.length}</span> 个链接
              </p>
            )}
          </section>

          {/* 统计 */}
          {(rows.length > 0 || isRunning) && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">检测统计</h4>
                <span className="text-xs text-slate-400">
                  {isRunning ? `检测中 ${progress.done}/${progress.total}` : `共 ${stats.total} 个链接`}
                </span>
              </div>
              {summaryBlock}
              {isRunning && (
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </section>
          )}

          {/* 检测结果 */}
          {rows.length > 0 && (
            <section className="space-y-2">
              {deadRows.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-medium text-red-500 mb-1 px-1">
                    <ShieldAlert size={14} /> 失效链接（{deadRows.length}）
                  </h4>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                    {deadRows.map(renderRow)}
                  </div>
                </div>
              )}
              {unknownRows.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-medium text-amber-500 mb-1 px-1">
                    <ShieldCheck size={14} /> 待人工确认（{unknownRows.length}）
                  </h4>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                    {unknownRows.map(renderRow)}
                  </div>
                </div>
              )}
              {stats.ok > 0 && (
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400 mb-1 px-1">
                    <ShieldCheck size={14} /> 可用链接（{stats.ok}）
                  </h4>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 max-h-56 overflow-y-auto">
                    {rows.filter(r => r.result.status === 'ok').map(renderRow)}
                  </div>
                </div>
              )}
            </section>
          )}

          {rows.length === 0 && !isRunning && (
            <div className="text-center py-8 text-sm text-slate-400">
              <Link2 size={32} className="mx-auto mb-2 opacity-40" />
              选择范围后点击"开始检测"，将逐个验证链接是否可访问
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400">
            {selected.has('all') ? `全部 ${targetLinks.length} 个链接` : `${targetLinks.length} 个链接`}
          </span>
          <div className="flex items-center gap-2">
            {rows.length > 0 && !isRunning && (
              <button
                onClick={() => { setRows([]); setProgress({ done: 0, total: 0 }); }}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                清空结果
              </button>
            )}
            {isRunning ? (
              <button
                onClick={stopCheck}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1.5"
              >
                <XCircle size={14} /> 停止检测
              </button>
            ) : (
              <button
                onClick={startCheck}
                disabled={targetLinks.length === 0}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play size={14} /> 开始检测
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LinkCheckModal;
