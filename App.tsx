
import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Search, Plus, Upload, Moon, Sun, Menu, 
  Trash2, Edit2, Loader2, Cloud, CheckCircle2, AlertCircle, Clock,
  Pin, Settings, Lock, CloudCog, Github, GitFork, GripVertical, Save,   CheckSquare, LogOut, ExternalLink, X, Activity, PanelLeftClose, PanelLeftOpen, Copy
} from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  KeyboardSensor,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LinkItem, Category, DEFAULT_CATEGORIES, INITIAL_LINKS, AIConfig, SearchMode, ExternalSearchSource, SearchConfig, SiteSettings } from './types';
import { parseBookmarks } from './services/bookmarkParser';
import { matchPinyinInitials } from './services/pinyinService';
import { isSafeBookmarkUrl, isSafeSearchSource, sanitizeSearchConfig } from './services/urlSafety';
import { hashCategoryPassword, isCategoryPasswordHash } from './services/categoryPassword';
import Icon from './components/Icon';
import LinkModal from './components/LinkModal';
import AuthModal from './components/AuthModal';
import CategoryAuthModal from './components/CategoryAuthModal';
import ContextMenu from './components/ContextMenu';
import QRCodeModal from './components/QRCodeModal';

const loadCategoryManagerModal = () => import('./components/CategoryManagerModal');
const loadBackupModal = () => import('./components/BackupModal');
const loadImportModal = () => import('./components/ImportModal');
const loadSettingsModal = () => import('./components/SettingsModal');
const loadSearchConfigModal = () => import('./components/SearchConfigModal');
const loadLinkCheckModal = () => import('./components/LinkCheckModal');

const CategoryManagerModal = lazy(loadCategoryManagerModal);
const BackupModal = lazy(loadBackupModal);
const ImportModal = lazy(loadImportModal);
const SettingsModal = lazy(loadSettingsModal);
const SearchConfigModal = lazy(loadSearchConfigModal);
const LinkCheckModal = lazy(loadLinkCheckModal);

// --- 配置常量 ---
// 项目核心仓库地址
const GITHUB_REPO_URL = 'https://github.com/aabacada/CloudNav-abcd';

const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';
const AUTH_KEY = 'cloudnav_auth_token';
const AI_CONFIG_KEY = 'cloudnav_ai_config';

// 安全提取 URL 域名：非法 URL 返回空串，避免渲染期 new URL() 抛异常导致整页白屏
const safeHost = (url: string | undefined | null): string => {
  try { return new URL(url || '').hostname; } catch { return ''; }
};

// 主列表分批渲染每批条数
const PAGE_SIZE = 100;

// 判断一份数据是否是服务端脱敏视图（公开视图：加密分类密码被剥、其链接被过滤）。
// 脱敏数据只可用于展示，绝不能回写 app_data，否则会把加密分类的密码抹掉、丢失受保护链接。
const isSanitizedData = (data: unknown): boolean => {
  return typeof data === 'object' && data !== null && '_sanitized' in data && data._sanitized === true;
};

// 创建可排序的链接卡片组件（模块顶层定义，避免每次渲染重建组件导致全量重挂载）
const SortableLinkCardBase = ({ link, cardStyle, sortingActive }: { link: LinkItem; cardStyle: 'detailed' | 'simple'; sortingActive: boolean }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: link.id });

  const isDetailedView = cardStyle === 'detailed';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 20 : 'auto',
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative cursor-grab active:cursor-grabbing min-w-0 max-w-full overflow-hidden touch-none ${
        sortingActive
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
      } ${isDragging ? 'shadow-lg' : ''} ${
        isDetailedView
          ? 'flex flex-col rounded-2xl border shadow-sm p-4 min-h-[100px]'
          : 'flex items-center rounded-xl border shadow-sm p-3'
      }`}
      {...attributes}
      {...listeners}
    >
      {/* 链接内容 - 移除a标签，改为div防止点击跳转 */}
      <div className={`flex flex-1 min-w-0 overflow-hidden ${
        isDetailedView ? 'flex-col' : 'items-center gap-3'
      }`}>
        {/* 第一行：图标和标题水平排列 */}
        <div className={`flex items-center gap-3 mb-2 ${
          isDetailedView ? '' : 'w-full'
        }`}>
          {/* Icon */}
          <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
            isDetailedView ? 'w-8 h-8 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800' : 'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
          }`}>
              {link.icon ? <img src={link.icon} alt="" className="w-5 h-5"/> : link.title.charAt(0)}
          </div>

          {/* 标题 */}
          <h3 className={`text-slate-900 dark:text-slate-100 truncate overflow-hidden text-ellipsis ${
            isDetailedView ? 'text-base' : 'text-sm font-medium text-slate-800 dark:text-slate-200'
          }`} title={link.title}>
              {link.title}
          </h3>
        </div>

        {/* 第二行：描述文字 */}
        {isDetailedView && link.description && (
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
            {link.description}
          </p>
        )}
      </div>
    </div>
  );
};

// 包 React.memo：link/cardStyle/sortingActive 均为原始数据，未变化的卡片在父组件重渲染时跳过 diff，
// 搜索输入、状态切换等高频重渲染场景下大幅减少卡片级开销
const SortableLinkCard = React.memo(SortableLinkCardBase);

function App() {
  // --- State ---
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 桌面端侧边栏折叠状态（隐藏整个侧边栏，持久化到 localStorage）
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('cloudnav_sidebar_collapsed') === 'true';
  });

  useEffect(() => {
    safeSetItem('cloudnav_sidebar_collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);
  
  // Search Mode State
  const [searchMode, setSearchMode] = useState<SearchMode>('external');
  const [externalSearchSources, setExternalSearchSources] = useState<ExternalSearchSource[]>([]);
  const [isLoadingSearchConfig, setIsLoadingSearchConfig] = useState(true);
  
  // Category Security State
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<Set<string>>(new Set());
  // 当前内存/本地缓存中的数据是否来自服务端脱敏视图（是则禁止回写云端）
  const dataSanitizedRef = useRef(false);
  // 服务端 app_data 的版本号：用于乐观并发控制（保存时携带 baseRevision，被其他端修改过则 409）
  const dataRevisionRef = useRef<number>(0);
  // "未登录时搜索配置只在本地生效"的提醒只弹一次
  const searchPersistNoticeShown = useRef(false);

  // 分批渲染：主列表每批渲染条数，避免上千书签一次性全部渲染导致卡顿
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // 其他目录搜索结果同样分批渲染，避免全库搜索时一次性渲染上千张卡片
  const [otherResultsVisibleCount, setOtherResultsVisibleCount] = useState(PAGE_SIZE);

  // AI Config State
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
      const saved = localStorage.getItem(AI_CONFIG_KEY);
      if (saved) {
          try {
              return JSON.parse(saved);
          } catch (e) {}
      }
      return {
          provider: 'gemini',
          apiKey: '',
          baseUrl: '',
          model: 'gemini-2.5-flash'
      };
  });

  // Site Settings State
  const [siteSettings, setSiteSettings] = useState(() => {
      const saved = localStorage.getItem('cloudnav_site_settings');
      if (saved) {
          try {
              return JSON.parse(saved);
          } catch (e) {}
      }
      return {
          title: 'CloudNav - 我的导航',
          navTitle: 'CloudNav',
          favicon: '',
          cardStyle: 'detailed' as const,
          passwordExpiryDays: 7,
          requireLoginAccess: true,
          wallpaper: { url: '', blur: 0, brightness: 1, saturate: 1, mask: 0.4 }
      };
  });
  
  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCatManagerOpen, setIsCatManagerOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSearchConfigModalOpen, setIsSearchConfigModalOpen] = useState(false);
  const [isLinkCheckModalOpen, setIsLinkCheckModalOpen] = useState(false);
  const [catAuthModalData, setCatAuthModalData] = useState<Category | null>(null);
  
  const [editingLink, setEditingLink] = useState<LinkItem | undefined>(undefined);
  // State for data pre-filled from Bookmarklet
  const [prefillLink, setPrefillLink] = useState<Partial<LinkItem> | undefined>(undefined);
  
  // Sync State
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'offline'>('idle');
  // 轻量操作反馈（toast）：复制成功等短提示，1.5 秒后自动消失
  const [toast, setToast] = useState('');
  // 顶栏实时时钟（24 小时制），每秒刷新
  const [currentTime, setCurrentTime] = useState(() => new Date());
  // 同步状态指示器统一入口：所有状态变更都先清掉挂起的 idle 定时器，
  // 避免上一次保存遗留的定时器把新状态（如 saving/error）提前打回 idle 造成指示器错乱
  const syncStatusTimerRef = useRef<number | null>(null);
  const updateSyncStatus = (status: 'idle' | 'saving' | 'saved' | 'error' | 'offline') => {
    if (syncStatusTimerRef.current !== null) {
      clearTimeout(syncStatusTimerRef.current);
      syncStatusTimerRef.current = null;
    }
    setSyncStatus(status);
    if (status === 'saved') {
      syncStatusTimerRef.current = window.setTimeout(() => setSyncStatus('idle'), 2000);
    }
  };

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 1500);
    return () => clearTimeout(timer);
  }, [toast]);

  // 实时时钟：每秒同步一次，卸载时清理定时器
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [authToken, setAuthToken] = useState<string>('');
  useEffect(() => { authTokenRef.current = authToken; }, [authToken]);
  const [requiresAuth, setRequiresAuth] = useState<boolean | null>(null); // null表示未检查，true表示需要认证，false表示不需要认证
  
  // Sort State
  const [isSortingMode, setIsSortingMode] = useState<string | null>(null); // 存储正在排序的分类ID，null表示不在排序模式
  const [isSortingPinned, setIsSortingPinned] = useState(false); // 是否正在排序置顶链接
  
  // Batch Edit State
  const [isBatchEditMode, setIsBatchEditMode] = useState(false); // 是否处于批量编辑模式
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set()); // 选中的链接ID集合
  
  // Sub-category State
    const [hoveredCategory, setHoveredCategory] = useState<string | null>(null); // 当前悬浮的一级分类ID
  const [hoveredCategoryTop, setHoveredCategoryTop] = useState<number>(0); // 当前悬浮的一级分类的垂直位置 
  const [pinnedRailCategory, setPinnedRailCategory] = useState<string | null>(null); // 图标栏模式下点击固定弹出的子分类菜单
  
  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    link: LinkItem | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    link: null
  });
  
  // QR Code Modal State
  const [qrCodeModal, setQrCodeModal] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
  }>({
    isOpen: false,
    url: '',
    title: ''
  });

  // Mobile Search State
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  
  // Category Action Auth State
  const [categoryActionAuth, setCategoryActionAuth] = useState<{
    isOpen: boolean;
    action: 'edit' | 'delete';
    categoryId: string;
    categoryName: string;
  }>({
    isOpen: false,
    action: 'edit',
    categoryId: '',
    categoryName: ''
  });
  
  // --- Helpers & Sync Logic ---

  // 始终以最新的 links/categories 为准，写请求串行执行，避免旧快照整包覆盖 KV
  const dataRef = useRef<{ links: LinkItem[]; categories: Category[] }>({ links: [], categories: [] });
  const syncQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const authTokenRef = useRef('');

  // 本地缓存统一写入口：配额超限（QuotaExceededError）等异常只降级提示，不中断后续云端同步链
  const writeLocalCache = (links: LinkItem[], categories: Category[]) => {
    try {
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({
          links,
          categories,
          revision: dataRevisionRef.current,
          ...(dataSanitizedRef.current ? { _sanitized: true } : {})
        })
      );
    } catch (e) {
      // 大书签库（含 base64 图标）可能逼近 5MB 配额：失败时提示且不抛出，避免中断后续云端同步
      console.warn('本地缓存写入失败（可能超出存储配额），已跳过本地缓存、继续云端同步', e);
      updateSyncStatus('error');
    }
  };

  // 本地缓存写入辅助：localStorage 写入失败（如配额超限）只降级提示，
  // 不能让异常打断后续的云端同步/保存流程，否则用户会误以为已保存成功
  const safeSetItem = (key: string, value: string): boolean => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn(`本地存储写入失败（${key}），可能已超出浏览器存储配额`, e);
      updateSyncStatus('error');
      return false;
    }
  };

  const loadFromLocal = () => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // 本地缓存也带 _sanitized 标记，恢复其来源属性（退出登录后回到公开视图时保持禁止回写）
        dataSanitizedRef.current = isSanitizedData(parsed);
        dataRevisionRef.current = Number(parsed.revision) || 0;
        // 空数组不能当成有效目录，否则一次错误回写会让侧边栏一直空白
        let loadedCategories = parsed.categories?.length ? parsed.categories : DEFAULT_CATEGORIES;
        
        // 确保"常用推荐"分类始终存在，并确保它是第一个分类
        if (!loadedCategories.some(c => c.id === 'common')) {
          loadedCategories = [
            { id: 'common', name: '常用推荐', icon: 'Star' },
            ...loadedCategories
          ];
        } else {
          // 如果"常用推荐"分类已存在，确保它是第一个分类
          const commonIndex = loadedCategories.findIndex(c => c.id === 'common');
          if (commonIndex > 0) {
            const commonCategory = loadedCategories[commonIndex];
            loadedCategories = [
              commonCategory,
              ...loadedCategories.slice(0, commonIndex),
              ...loadedCategories.slice(commonIndex + 1)
            ];
          }
        }
        
        // 检查是否有链接的categoryId不存在于当前分类中，将这些链接移动到"常用推荐"
        const validCategoryIds = new Set(loadedCategories.map(c => c.id));
        let loadedLinks = parsed.links || INITIAL_LINKS;
        loadedLinks = loadedLinks.map(link => {
          if (!validCategoryIds.has(link.categoryId)) {
            return { ...link, categoryId: 'common' };
          }
          return link;
        });
        
        dataRef.current = { links: loadedLinks, categories: loadedCategories };
        setLinks(loadedLinks);
        setCategories(loadedCategories);
      } catch (e) {
        // 缓存损坏时同样要同步 dataRef，否则 state 显示初始数据而 ref 为空，
        // 排序/保存会用空数据覆盖真实数据
        dataRef.current = { links: INITIAL_LINKS, categories: DEFAULT_CATEGORIES };
        dataRevisionRef.current = 0;
        setLinks(INITIAL_LINKS);
        setCategories(DEFAULT_CATEGORIES);
      }
    } else {
      dataRef.current = { links: INITIAL_LINKS, categories: DEFAULT_CATEGORIES };
      dataRevisionRef.current = 0;
      setLinks(INITIAL_LINKS);
      setCategories(DEFAULT_CATEGORIES);
    }
  };

  const syncToCloud = async (newLinks: LinkItem[], newCategories: Category[], token: string) => {
    // 硬闸门：当前数据来自脱敏视图时禁止任何回写，防止把公开视图数据覆盖到 app_data
    if (dataSanitizedRef.current) {
        console.warn('当前数据来自脱敏视图（未登录/公开视图），已禁止同步到云端');
        updateSyncStatus('error');
        return false;
    }
    updateSyncStatus('saving');
    try {
        const response = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': token
            },
            body: JSON.stringify({ links: newLinks, categories: newCategories, baseRevision: dataRevisionRef.current })
        });

        if (response.status === 409) {
            // 乐观并发控制：期间被其他设备/标签页修改过，拒绝静默覆盖。
            // 只采纳 latestRevision 而不刷新数据，会让队列里下一次保存带着
            // "本地旧快照 + 新 revision"通过校验，静默覆盖他人数据——必须拉取远端最新数据刷新本地视图
            let latestRevision = 0;
            try {
                latestRevision = Number((await response.json()).latestRevision) || 0;
            } catch { /* 响应体解析失败则不采用 */ }
            let refreshed = false;
            try {
                const fresh = await fetch('/api/storage', { headers: { 'x-auth-password': token } });
                if (fresh.ok) {
                    const data = await fresh.json();
                    if (Array.isArray(data?.links) && Array.isArray(data?.categories)) {
                        dataSanitizedRef.current = isSanitizedData(data);
                        dataRevisionRef.current = Number(data.revision) || latestRevision;
                        const loadedCategories = data.categories.length ? data.categories : dataRef.current.categories;
                        dataRef.current = { links: data.links, categories: loadedCategories };
                        setLinks(dataRef.current.links);
                        setCategories(loadedCategories);
                        writeLocalCache(dataRef.current.links, loadedCategories);
                        refreshed = true;
                    }
                }
            } catch { /* 拉取失败时保留旧 baseRevision，下一次保存仍会 409，不会放行陈旧快照 */ }
            console.warn('数据已在其他设备/标签页被修改，已取消本次同步（baseRevision 不匹配）');
            updateSyncStatus('error');
            alert(refreshed
                ? '数据已在其他设备或标签页被修改，已取消本次同步并为您加载了云端最新数据。\n如需保留刚才的修改，请在最新数据基础上重新操作。'
                : '数据已在其他设备或标签页被修改，为避免覆盖已取消本次同步。\n请刷新页面获取最新数据后再操作。');
            return false;
        }

        if (response.status === 401) {
            // 检查是否是密码过期
            try {
                const errorData = await response.json();
                if (errorData.error && errorData.error.includes('过期')) {
                    alert('您的密码已过期，请重新登录');
                }
            } catch (e) {
                // 如果无法解析错误信息，使用默认提示
                console.error('Failed to parse error response', e);
            }
            
            setAuthToken('');
            localStorage.removeItem(AUTH_KEY);
            setIsAuthOpen(true);
            updateSyncStatus('error');
            return false;
        }

        if (!response.ok) throw new Error('Network response was not ok');

        // 采纳服务端返回的新 revision，供下次保存时携带
        try {
            const saved = await response.json();
            if (saved && Number.isFinite(Number(saved.revision))) {
                dataRevisionRef.current = Number(saved.revision);
            }
        } catch (e) { /* 解析失败不影响保存成功的状态 */ }
        
        updateSyncStatus('saved');
        return true;
        } catch (error) {
        console.error("Sync failed", error);
        updateSyncStatus('error');
        // 统一在此提示，避免调用方（updateData）重复弹窗造成连环 alert
        alert('数据保存失败，请检查网络后重试');
        return false;
    }
};

  const updateData = (newLinks: LinkItem[], newCategories: Category[], options?: { forceFullData?: boolean }): Promise<boolean> => {
      if (options?.forceFullData) dataSanitizedRef.current = false;
      // 图标加载等异步回写可能带着尚未就绪的空分类，不能覆盖已经加载的目录
      if (newCategories.length === 0 && dataRef.current.categories.length > 0) {
          newCategories = dataRef.current.categories;
      }
      // 1. 先写入 ref，后续并发调用读到的都是最新快照
      dataRef.current = { links: newLinks, categories: newCategories };
      setLinks(newLinks);
      setCategories(newCategories);
      
      // 2. Save to Local Cache（保留 _sanitized 来源标记，防止脱敏数据刷新后被当作完整数据回写云端）
      writeLocalCache(newLinks, newCategories);

      // 3. 串行同步：用 ref 中的最新令牌，避免登录刚完成时闭包里还是空令牌
      const token = authTokenRef.current;
      if (token && !dataSanitizedRef.current) {
          const run = syncQueueRef.current.then(async () => {
              const snapshot = dataRef.current;
              // 失败提示由 syncToCloud 内部统一弹出（409/401/网络错误各只提示一次），这里不再重复 alert
              const ok = await syncToCloud(snapshot.links, snapshot.categories, token);
              return ok;
          });
          syncQueueRef.current = run.catch(() => false);
          return run;
      }
      if (token && dataSanitizedRef.current) {
          // 内存数据来自脱敏视图（未登录时加载的公开数据），回写会抹掉加密分类的密码和受保护链接，禁止同步
          console.warn('数据来自未登录的脱敏视图，已跳过云端同步，请先登录获取完整数据');
          alert('当前是未登录的公开数据，修改未保存到 KV，请先登录');
          return Promise.resolve(false);
      }
      return Promise.resolve(false);
  };
  // --- Context Menu Functions ---
  const handleContextMenu = (event: React.MouseEvent, link: LinkItem) => {
    event.preventDefault();
    event.stopPropagation();
    
    // 在批量编辑模式下禁用右键菜单
    if (isBatchEditMode) return;
    
    setContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      link: link
    });
  };

  const closeContextMenu = () => {
    setContextMenu({
      isOpen: false,
      position: { x: 0, y: 0 },
      link: null
    });
  };

  const copyLinkToClipboard = () => {
    if (!contextMenu.link) return;
    
    navigator.clipboard.writeText(contextMenu.link.url)
      .then(() => {
        setToast('链接已复制到剪贴板');
      })
      .catch(err => {
        console.error('复制链接失败:', err);
      });
    
    closeContextMenu();
  };

  const showQRCode = () => {
    if (!contextMenu.link) return;
    
    setQrCodeModal({
      isOpen: true,
      url: contextMenu.link.url,
      title: contextMenu.link.title
    });
    
    closeContextMenu();
  };

  const editLinkFromContextMenu = () => {
    if (!contextMenu.link) return;
    
    setEditingLink(contextMenu.link);
    setIsModalOpen(true);
    closeContextMenu();
  };

  const deleteLinkFromContextMenu = () => {
    if (!contextMenu.link) return;
    // 与卡片入口行为一致：删除需要登录，匿名访客只能改本地（脱敏）数据造成“已生效”假象
    if (!authToken) { setIsAuthOpen(true); closeContextMenu(); return; }
    
    if (window.confirm(`确定要删除"${contextMenu.link.title}"吗？`)) {
      const newLinks = links.filter(link => link.id !== contextMenu.link!.id);
      updateData(newLinks, categories);
    }
    
    closeContextMenu();
  };

  const togglePinFromContextMenu = () => {
    if (!contextMenu.link) return;
    if (!authToken) { setIsAuthOpen(true); closeContextMenu(); return; }
    
    const linkToToggle = links.find(l => l.id === contextMenu.link!.id);
    if (!linkToToggle) return;
    
    // 如果是设置为置顶，则设置pinnedOrder为当前置顶链接数量
    // 如果是取消置顶，则清除pinnedOrder
    const updated = links.map(l => {
      if (l.id === contextMenu.link!.id) {
        const isPinned = !l.pinned;
        return { 
          ...l, 
          pinned: isPinned,
          pinnedOrder: isPinned ? links.filter(link => link.pinned).length : undefined
        };
      }
      return l;
    });
    
    updateData(updated, categories);
    closeContextMenu();
  };

  // 加载链接图标缓存
  // tokenOverride：刷新时 authToken state 尚未更新，由调用方传入闭包内的 savedToken，避免误判为未登录
  const loadLinkIcons = async (linksToLoad: LinkItem[], tokenOverride?: string) => {
    if (!(tokenOverride ?? authToken)) return; // 只有在已登录状态下才加载图标缓存
    
    const domainsToFetch: string[] = [];
    const seenDomains = new Set<string>();
    
    // 收集所有链接的域名（包括已有图标的链接，同域名去重）
    for (const link of linksToLoad) {
      if (link.url) {
        try {
          let domain = link.url;
          if (!link.url.startsWith('http://') && !link.url.startsWith('https://')) {
            domain = 'https://' + link.url;
          }
          
          if (domain.startsWith('http://') || domain.startsWith('https://')) {
            const urlObj = new URL(domain);
            domain = urlObj.hostname;
            if (!seenDomains.has(domain)) {
              seenDomains.add(domain);
              domainsToFetch.push(domain);
            }
          }
        } catch (e) {
          console.error("Failed to parse URL for icon loading", e);
        }
      }
    }
    
    // 批量获取图标（限制并发：千级域名去重后仍可能一次性发出大量请求，用工作池控制并发度）
    if (domainsToFetch.length > 0) {
      const CONCURRENCY = 6;
      const iconResults: ({ domain: string; icon: string } | null)[] = new Array(domainsToFetch.length).fill(null);
      let cursor = 0;
      const worker = async () => {
        while (cursor < domainsToFetch.length) {
          const index = cursor++;
          const domain = domainsToFetch[index];
          try {
            const response = await fetch(`/api/storage?getConfig=favicon&domain=${encodeURIComponent(domain)}`);
            if (response.ok) {
              const data = await response.json();
              if (data.cached && data.icon) {
                iconResults[index] = { domain, icon: data.icon };
              }
            }
          } catch (error) {
            console.log(`Failed to fetch cached icon for ${domain}`, error);
          }
        }
      };
      
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domainsToFetch.length) }, worker));
      
      // 更新链接的图标（不可变更新，避免直接改动 state 对象与并发 updateData 竞态）
      const iconMap = new Map<string, string>();
      iconResults.forEach(result => {
        if (result) iconMap.set(result.domain, result.icon);
      });
      
      let changed = false;
      // 以最新 dataRef 为底合并：图标请求耗时较长，期间用户可能已增删改链接，
      // 若用过期快照覆盖会丢失这些变更。只按 id 回填 icon 字段。
      const merged = dataRef.current.links.map(link => {
        if (!link.url) return link;
        let domain = link.url;
        try {
          if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
            domain = 'https://' + domain;
          }
          domain = new URL(domain).hostname;
        } catch (e) {
          return link;
        }
        const icon = iconMap.get(domain);
        // 只有当链接没有图标，或者当前图标是 gstatic.cn 生成的，或者缓存中的图标是自定义图标时才更新
        if (icon && (!link.icon || link.icon.includes('gstatic.cn') || !icon.includes('gstatic.cn'))) {
          changed = true;
          return { ...link, icon };
        }
        return link;
      });
      
      // 只更新当前展示的图标，不在页面加载时回写整包数据。
      // 登录状态下回写会和尚未就绪的空分类竞态，把侧边栏目录清空并同步到云端。
      if (changed) {
        dataRef.current = { ...dataRef.current, links: merged };
        setLinks(merged);
      }
    }
  };

  // --- Effects ---

  // 切换分类或搜索词变化时清空批量选中的链接：批量删除/移动按全量 links 过滤 selectedLinks，
  // 保留跨分类/跨搜索态的选中集会误删当前视图已不可见的链接（合并了原先两个完全相同的 effect）
  useEffect(() => {
    setSelectedLinks(new Set());
  }, [selectedCategory, searchQuery]);

  // 迁移：把旧版明文分类密码升级为 PBKDF2 哈希。
  // 只有登录态拿到的完整数据才含 password 字段（脱敏视图已剥离），未登录时此 effect 自然空转。
  useEffect(() => {
    if (!authToken || categories.length === 0) return;
    const hasLegacy = categories.some(c => c.password && !isCategoryPasswordHash(c.password));
    if (!hasLegacy) return;
    let cancelled = false;
    (async () => {
      try {
        const migrated = await Promise.all(categories.map(async c =>
          c.password && !isCategoryPasswordHash(c.password)
            ? { ...c, password: await hashCategoryPassword(c.password) }
            : c
        ));
        if (!cancelled) updateData(links, migrated);
      } catch (e) {
        console.error('分类密码哈希迁移失败，将在下次加载时重试', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, categories]);

  useEffect(() => {
    // Theme init
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }

    // Load Token：是否过期交给服务端判定（verifyAuthToken 校验签发时间与过期天数），
    // initData 拿到 401（含“过期”）时已统一清除令牌并弹出登录框。
    // 本地用 siteSettings 初值（localStorage 默认 7 天）判断会在跨设备修改过过期天数时误清登录态
    const savedToken = localStorage.getItem(AUTH_KEY);
    
    if (savedToken) {
      setAuthToken(savedToken);
    }

    // Handle URL Params for Bookmarklet (Add Link)
    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
        const addTitle = urlParams.get('add_title') || '';
        // Clean URL params to avoid re-triggering on refresh
        window.history.replaceState({}, '', window.location.pathname);
        
        setPrefillLink({
            title: addTitle,
            url: addUrl,
            categoryId: 'common' // Default, Modal will handle selection
        });
        setEditingLink(undefined);
        setIsModalOpen(true);
    }

    // Initial Data Fetch
    const initData = async () => {
        // 首先检查是否需要认证
        let authCheckPassed = false;
        try {
            const authRes = await fetch('/api/storage?checkAuth=true');
            if (authRes.ok) {
                const authData = await authRes.json();
                setRequiresAuth(authData.requiresAuth);
                authCheckPassed = true;

                // 如果需要认证但用户未登录，则不获取数据
                if (authData.requiresAuth && !savedToken) {
                    setIsAuthOpen(true);
                    return;
                }
            }
        } catch (e) {
            console.warn("Failed to check auth requirement.", e);
        }
        if (!authCheckPassed) {
            // checkAuth 失败或非 200（网络抖动/服务端 500）：fail-closed 收严为需要验密，
            // 验密站点不再因状态未知直接展示主界面（新设备会露出演示数据）
            setRequiresAuth(true);
            setIsAuthOpen(true);
            return;
        }
        
        // 获取数据
        let hasCloudData = false;
        try {
            const res = await fetch('/api/storage', {
                // 用闭包内的 savedToken 而非 state authToken（setAuthToken 后 state 尚未更新，会带不上密码头导致 401）
                headers: savedToken ? { 'x-auth-password': savedToken } : {}
            });
            if (res.ok) {
                const data = await res.json();
                // 记录数据来源：脱敏视图（未登录公开数据）不可回写云端
                dataSanitizedRef.current = isSanitizedData(data);
                dataRevisionRef.current = Number(data.revision) || 0;
                if (data.links && data.links.length > 0) {
                    const loadedCategories = data.categories?.length
                      ? data.categories
                      : (dataRef.current.categories.length ? dataRef.current.categories : DEFAULT_CATEGORIES);
                    dataRef.current = { links: data.links, categories: loadedCategories };
                    setLinks(data.links);
                    setCategories(loadedCategories);
                    writeLocalCache(data.links, loadedCategories);
                    
                    // 加载链接图标缓存（传入 savedToken：此时 authToken state 尚未更新）
                    loadLinkIcons(data.links, savedToken);
                    hasCloudData = true;
                }
            } else if (res.status === 401) {
                // 如果返回401，可能是密码过期，清除本地token并要求重新登录
                const errorData = await res.json();
                if (errorData.error && errorData.error.includes('过期')) {
                    setAuthToken('');
                    localStorage.removeItem(AUTH_KEY);
                    setIsAuthOpen(true);
                    return;
                }
            }
        } catch (e) {
            console.warn("Failed to fetch from cloud, falling back to local.", e);
        }
        
        // 无论是否有云端数据，都尝试从KV空间加载搜索配置和网站配置
        let searchConfigLoaded = false;
        try {
            const searchConfigRes = await fetch('/api/storage?getConfig=search');
            if (searchConfigRes.ok) {
                const searchConfigData = await searchConfigRes.json();
                const safeSearchConfig = sanitizeSearchConfig(searchConfigData);
                if (safeSearchConfig) {
                    setSearchMode(safeSearchConfig.mode);
                    setExternalSearchSources(safeSearchConfig.externalSources);
                    setSelectedSearchSource(safeSearchConfig.selectedSource ?? null);
                    searchConfigLoaded = true;
                }
            }
            
            // 获取网站配置（包括密码过期时间设置）
            const websiteConfigRes = await fetch('/api/storage?getConfig=website');
            if (websiteConfigRes.ok) {
                const websiteConfigData = await websiteConfigRes.json();
                if (websiteConfigData) {
                    setSiteSettings(prev => ({
                        ...prev,
                        title: websiteConfigData.title || prev.title,
                        navTitle: websiteConfigData.navTitle || prev.navTitle,
                        favicon: websiteConfigData.favicon || prev.favicon,
                        cardStyle: websiteConfigData.cardStyle || prev.cardStyle,
                        passwordExpiryDays: websiteConfigData.passwordExpiryDays !== undefined ? websiteConfigData.passwordExpiryDays : prev.passwordExpiryDays,
                        requireLoginAccess: websiteConfigData.requireLoginAccess !== undefined ? websiteConfigData.requireLoginAccess : prev.requireLoginAccess,
                        wallpaper: websiteConfigData.wallpaper !== undefined ? websiteConfigData.wallpaper : prev.wallpaper
                    }));
                }
            }
        } catch (e) {
            console.warn("Failed to fetch configs from KV.", e);
        }
        
        // 如果有云端数据，则不需要加载本地数据
        if (hasCloudData) {
            setIsLoadingSearchConfig(false);
            return;
        }
        
        // 如果没有云端数据，则加载本地数据
        loadFromLocal();

        // KV 已有搜索配置时绝不能再用内置列表覆盖
        if (searchConfigLoaded) {
            setIsLoadingSearchConfig(false);
            return;
        }
        
        // 只有 KV 没有搜索配置时才写入内置默认源
        setSearchMode('external');
        setExternalSearchSources([
            {
                id: 'bing',
                name: '必应',
                url: 'https://www.bing.com/search?q={query}',
                icon: 'Search',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'google',
                name: 'Google',
                url: 'https://www.google.com/search?q={query}',
                icon: 'Search',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'baidu',
                name: '百度',
                url: 'https://www.baidu.com/s?wd={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'sogou',
                name: '搜狗',
                url: 'https://www.sogou.com/web?query={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'yandex',
                name: 'Yandex',
                url: 'https://yandex.com/search/?text={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'github',
                name: 'GitHub',
                url: 'https://github.com/search?q={query}',
                icon: 'Github',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'linuxdo',
                name: 'Linux.do',
                url: 'https://linux.do/search?q={query}',
                icon: 'Terminal',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'bilibili',
                name: 'B站',
                url: 'https://search.bilibili.com/all?keyword={query}',
                icon: 'Play',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'youtube',
                name: 'YouTube',
                url: 'https://www.youtube.com/results?search_query={query}',
                icon: 'Video',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'wikipedia',
                name: '维基',
                url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                icon: 'BookOpen',
                enabled: true,
                createdAt: Date.now()
            }
        ]);
        
        setIsLoadingSearchConfig(false);
    };

    initData();
  }, []);

  // Update page title and favicon when site settings change
  useEffect(() => {
    if (siteSettings.title) {
      document.title = siteSettings.title;
    }
    
    if (siteSettings.favicon) {
      // Remove existing favicon links
      const existingFavicons = document.querySelectorAll('link[rel="icon"]');
      existingFavicons.forEach(favicon => favicon.remove());
      
      // Add new favicon
      const favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.href = siteSettings.favicon;
      document.head.appendChild(favicon);
    }
  }, [siteSettings.title, siteSettings.favicon]);

  const toggleTheme = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // 视图模式切换处理函数
  const handleViewModeChange = (cardStyle: 'detailed' | 'simple') => {
    const newSiteSettings = { ...siteSettings, cardStyle };
    setSiteSettings(newSiteSettings);
    safeSetItem('cloudnav_site_settings', JSON.stringify(newSiteSettings));
    // 同步到云端：否则初始化时 KV 里的 cardStyle 会把本地切换打回，设置丢失
    if (authToken) {
        fetch('/api/storage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-password': authToken },
            body: JSON.stringify({ saveConfig: 'website', config: { cardStyle } })
        }).then(res => {
            if (!res.ok) updateSyncStatus('error');
        }).catch(() => updateSyncStatus('error'));
    }
  };

  // --- Batch Edit Functions ---
  const toggleBatchEditMode = () => {
    setIsBatchEditMode(!isBatchEditMode);
    setSelectedLinks(new Set()); // 退出批量编辑模式时清空选中的链接
  };

  const toggleLinkSelection = (linkId: string) => {
    setSelectedLinks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(linkId)) {
        newSet.delete(linkId);
      } else {
        newSet.add(linkId);
      }
      return newSet;
    });
  };

  const handleBatchDelete = () => {
    if (!authToken) { setIsAuthOpen(true); return; }
    
    if (selectedLinks.size === 0) {
      alert('请先选择要删除的链接');
      return;
    }
    
    if (confirm(`确定要删除选中的 ${selectedLinks.size} 个链接吗？`)) {
      const newLinks = links.filter(link => !selectedLinks.has(link.id));
      updateData(newLinks, categories);
      setSelectedLinks(new Set());
      setIsBatchEditMode(false);
    }
  };

  const handleBatchMove = (targetCategoryId: string) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    
    if (selectedLinks.size === 0) {
      alert('请先选择要移动的链接');
      return;
    }
    
    const newLinks = links.map(link => 
      selectedLinks.has(link.id) ? { ...link, categoryId: targetCategoryId } : link
    );
    updateData(newLinks, categories);
    setSelectedLinks(new Set());
    setIsBatchEditMode(false);
  };

  const handleBatchCopy = async () => {
    const urls = displayedLinks.filter(link => selectedLinks.has(link.id)).map(link => link.url).filter(Boolean);
    if (urls.length === 0) {
      alert('请先选择要复制的网站');
      return;
    }
    const text = urls.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert(`已复制 ${urls.length} 个网站链接`);
    } catch {
      window.prompt('复制失败，请手动复制以下链接', text);
    }
  };

  const handleSelectAll = () => {
    // 获取当前显示的所有链接ID
    const currentLinkIds = displayedLinks.map(link => link.id);
    
    // 如果已选中的链接数量等于当前显示的链接数量，则取消全选
    if (selectedLinks.size === currentLinkIds.length && currentLinkIds.every(id => selectedLinks.has(id))) {
      setSelectedLinks(new Set());
    } else {
      // 否则全选当前显示的所有链接
      setSelectedLinks(new Set(currentLinkIds));
    }
  };

  // --- Actions ---

  const handleLogin = async (password: string): Promise<boolean> => {
      try {
        // 首先验证密码
        const authResponse = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': password
            },
            body: JSON.stringify({ authOnly: true }) // 只用于验证密码，不更新数据
        });
        
        if (authResponse.ok) {
            const authData = await authResponse.json().catch(() => ({}));
            // 服务端签发的签名令牌；旧服务未返回 token 时才退回明文密码
            const sessionToken = authData.token || password;
            setAuthToken(sessionToken);
            // 只持久化服务端签发的签名令牌；旧服务端回退的明文密码仅保存在内存中，
            // 不落 localStorage，避免明文密码被本机其他程序/浏览器扩展读取（刷新后需重新登录）
            if (authData.token) {
                localStorage.setItem(AUTH_KEY, authData.token);
            }
            setIsAuthOpen(false);
            updateSyncStatus('saved');
            
            // 登录成功后，获取网站配置（包括密码过期时间设置）
            try {
                const websiteConfigRes = await fetch('/api/storage?getConfig=website');
                if (websiteConfigRes.ok) {
                    const websiteConfigData = await websiteConfigRes.json();
                    if (websiteConfigData) {
                        setSiteSettings(prev => ({
                            ...prev,
                            title: websiteConfigData.title || prev.title,
                            navTitle: websiteConfigData.navTitle || prev.navTitle,
                            favicon: websiteConfigData.favicon || prev.favicon,
                            cardStyle: websiteConfigData.cardStyle || prev.cardStyle,
                            passwordExpiryDays: websiteConfigData.passwordExpiryDays !== undefined ? websiteConfigData.passwordExpiryDays : prev.passwordExpiryDays,
                            requireLoginAccess: websiteConfigData.requireLoginAccess !== undefined ? websiteConfigData.requireLoginAccess : prev.requireLoginAccess,
                            wallpaper: websiteConfigData.wallpaper !== undefined ? websiteConfigData.wallpaper : prev.wallpaper
                        }));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch website config after login.", e);
            }
            
            // 刚刚密码验证成功，直接刷新本地登录时间；过期控制由服务端 verifyAccess 负责
            localStorage.setItem('lastLoginTime', Date.now().toString());
            
            // 登录成功后，从服务器获取数据
            try {
                const res = await fetch('/api/storage', {
                    headers: { 'x-auth-password': sessionToken }
                });
                if (res.ok) {
                    const data = await res.json();
                    // 登录后拿到的是完整数据（带密码头验证通过），清除脱敏标记
                    dataSanitizedRef.current = isSanitizedData(data);
                    dataRevisionRef.current = Number(data.revision) || 0;
                            if ((data.links && data.links.length > 0) || (data.categories && data.categories.length > 0)) {
            // 云端有数据（links 或 categories 任一非空，仅看 links 会把只剩分类的云端误判为空）
            // 云端没带分类时保留当前已显示的目录，不能用空数组或默认分类把它清掉
            const loadedLinks = data.links ?? [];
            const loadedCategories = data.categories?.length
              ? data.categories
              : (dataRef.current.categories.length ? dataRef.current.categories : DEFAULT_CATEGORIES);
            dataRef.current = { links: loadedLinks, categories: loadedCategories };
            setLinks(loadedLinks);
            setCategories(loadedCategories);
            writeLocalCache(loadedLinks, loadedCategories);

            // 加载链接图标缓存（此时 authToken state 尚未提交，必须传 sessionToken）
            loadLinkIcons(loadedLinks, sessionToken);
        } else if (!dataSanitizedRef.current) {
            // 云端 links 与 categories 均为空（全新部署）才考虑把本地数据推上去。
            // 关键防护：此时 dataRef 可能还是初始空值（验密门槛提前返回、本地缓存从未加载），
            // 必须先 loadFromLocal 再判断，仅在有真实数据时回写，避免把空整包推上云端清掉分类密码
            loadFromLocal();
            const local = dataRef.current;
            const hasRealData = local.links.length > 0
              || local.categories.some(c => c.password || !DEFAULT_CATEGORIES.some(d => d.id === c.id));
            if (hasRealData) {
                writeLocalCache(local.links, local.categories);
                // 并将本地数据同步到服务器（syncToCloud 内部有脱敏闸门，来自脱敏视图的本地缓存会被拦截）
                syncToCloud(local.links, local.categories, sessionToken);

                // 加载链接图标缓存（此时 authToken state 尚未提交，必须传 sessionToken）
                loadLinkIcons(local.links, sessionToken);
            }
        }
                } 
            } catch (e) {
                console.warn("Failed to fetch data after login.", e);
                loadFromLocal();
                // loadFromLocal 载入的本地缓存可能来自脱敏视图；syncToCloud 内部会依据 dataSanitizedRef 拦截
                // 尝试将本地数据同步到服务器
                syncToCloud(dataRef.current.links, dataRef.current.categories, sessionToken);
            }
            
            // 登录成功后，从KV空间加载AI配置
            try {
                const aiConfigRes = await fetch('/api/storage?getConfig=ai', {
                    headers: { 'x-auth-password': sessionToken }
                });
                if (aiConfigRes.ok) {
                    const aiConfigData = await aiConfigRes.json();
                    if (aiConfigData && Object.keys(aiConfigData).length > 0) {
                        setAiConfig(aiConfigData);
                        safeSetItem(AI_CONFIG_KEY, JSON.stringify(aiConfigData));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch AI config after login.", e);
            }
            
            return true;
        }
        return false;
      } catch (e) {
          return false;
      }
  };

  const handleLogout = () => {
      setAuthToken('');
      localStorage.removeItem(AUTH_KEY);
      // 退出后重新锁定所有已解密的加密分类（大分类/子分类）
      setUnlockedCategoryIds(new Set());
      updateSyncStatus('offline');
      // 退出后重新加载本地数据
      loadFromLocal();
  };

  // 分类操作密码验证处理函数
  const handleCategoryActionAuth = async (password: string): Promise<boolean> => {
    try {
      // 验证密码
      const authResponse = await fetch('/api/storage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-password': password
        },
        body: JSON.stringify({ authOnly: true })
      });
      
      return authResponse.ok;
    } catch (error) {
      console.error('Category action auth error:', error);
      return false;
    }
  };

  // 打开分类操作验证弹窗
  const openCategoryActionAuth = (action: 'edit' | 'delete', categoryId: string, categoryName: string) => {
    setCategoryActionAuth({
      isOpen: true,
      action,
      categoryId,
      categoryName
    });
  };

  // 关闭分类操作验证弹窗
  const closeCategoryActionAuth = () => {
    setCategoryActionAuth({
      isOpen: false,
      action: 'edit',
      categoryId: '',
      categoryName: ''
    });
  };

  const handleImportConfirm = (newLinks: LinkItem[], newCategories: Category[]) => {
      // 方案A：保留备份中的分类ID与父子关系，不再按名称合并分类
      const mergedCategories = [...categories];

      if (!mergedCategories.some(c => c.id === 'common')) {
        mergedCategories.push({ id: 'common', name: '常用推荐', icon: 'Star' });
      }

      newCategories.forEach(nc => {
          if (!mergedCategories.some(c => c.id === nc.id)) {
              mergedCategories.push(nc);
          }
      });

      // 仅按链接ID去重，保持原始 categoryId 不变；协议白名单过滤作为最后一道防线（上游已校验）
      const existingLinkIds = new Set(links.map(l => l.id));
      const linksToAdd = newLinks.filter(l => !existingLinkIds.has(l.id) && isSafeBookmarkUrl(l.url));

      const mergedLinks = [...links, ...linksToAdd];
      const addedCategories = mergedCategories.length - categories.length;

      // 仅导入搜索/AI 配置、无书签与分类变化时，不必做一次无意义的整包保存
      if (linksToAdd.length === 0 && addedCategories === 0) {
          setIsImportModalOpen(false);
          alert('搜索/AI 配置已导入（无新书签与新分类）。');
          return;
      }

      updateData(mergedLinks, mergedCategories);
      setIsImportModalOpen(false);
      const parts: string[] = [];
      if (linksToAdd.length > 0) parts.push(`${linksToAdd.length} 个新书签`);
      if (addedCategories > 0) parts.push(`${addedCategories} 个新分类`);
      alert(`成功导入 ${parts.join(' 和 ')}！`);
  };

  const handleAddLink = (data: Omit<LinkItem, 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    
    // 处理URL，确保有协议前缀
    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }
    
    // 获取当前分类下的所有链接（不包括置顶链接）
    const categoryLinks = links.filter(link => 
      !link.pinned && (data.categoryId === 'all' || link.categoryId === data.categoryId)
    );
    
    // 计算新链接的order值，使其排在分类最后
    const maxOrder = categoryLinks.length > 0 
      ? Math.max(...categoryLinks.map(link => link.order || 0))
      : -1;
    
    const newLink: LinkItem = {
      ...data,
      url: processedUrl, // 使用处理后的URL
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: Date.now(),
      order: maxOrder + 1, // 设置为当前分类的最大order加1，确保排在最后
      // 如果是置顶链接，设置pinnedOrder为当前置顶链接数量
      pinnedOrder: data.pinned ? links.filter(l => l.pinned).length : undefined
    };
    
    // 将新链接插入到合适的位置，而不是直接放在开头
    // 如果是置顶链接，放在置顶链接区域的最后
    if (newLink.pinned) {
      const firstNonPinnedIndex = links.findIndex(link => !link.pinned);
      if (firstNonPinnedIndex === -1) {
        // 如果没有非置顶链接，直接添加到末尾
        updateData([...links, newLink], categories);
      } else {
        // 插入到非置顶链接之前
        const updatedLinks = [...links];
        updatedLinks.splice(firstNonPinnedIndex, 0, newLink);
        updateData(updatedLinks, categories);
      }
    } else {
      // 非置顶链接，按照order字段排序后插入
      const updatedLinks = [...links, newLink].sort((a, b) => {
        // 置顶链接始终排在前面
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        
        // 同类型链接按照order排序
        const aOrder = a.order !== undefined ? a.order : a.createdAt;
        const bOrder = b.order !== undefined ? b.order : b.createdAt;
        return aOrder - bOrder;
      });
      updateData(updatedLinks, categories);
    }
    
    // Clear prefill if any
    setPrefillLink(undefined);
  };

  const handleEditLink = (data: Omit<LinkItem, 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (!editingLink) return;
    
    // 处理URL，确保有协议前缀
    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }
    
    const updated = links.map(l => l.id === editingLink.id ? { ...l, ...data, url: processedUrl } : l);
    updateData(updated, categories);
    setEditingLink(undefined);
  };

  // 排序开始前的快照：拖拽只改页面，点取消时按这份恢复
  const sortSnapshotRef = useRef<LinkItem[] | null>(null);
  // 排序期间直接使用这份画面顺序，避免每次拖动都重算过滤和排序
  const [sortingItems, setSortingItems] = useState<LinkItem[] | null>(null);

  const applyLocalOrder = (updatedLinks: LinkItem[]) => {
    dataRef.current = { ...dataRef.current, links: updatedLinks };
    setLinks(updatedLinks);
  };

  const moveItem = <T extends { id: string }>(items: T[], activeId: string, overId: string): T[] | null => {
    const oldIndex = items.findIndex(item => item.id === activeId);
    const newIndex = items.findIndex(item => item.id === overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;
    return arrayMove(items, oldIndex, newIndex);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !sortingItems) return;

    const reordered = moveItem(sortingItems, String(active.id), String(over.id)) ?? sortingItems;
    if (reordered === sortingItems) return;
    setSortingItems(reordered);

    // 副作用移出 setState updater：React 19 并发模式下 updater 可能被重复执行
    const orderMap = new Map(reordered.map((link, index) => [link.id, index]));
    applyLocalOrder(dataRef.current.links.map(link => (
      orderMap.has(link.id) ? { ...link, order: orderMap.get(link.id) } : link
    )));
  };

  const handlePinnedDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !sortingItems) return;

    const reordered = moveItem(sortingItems, String(active.id), String(over.id)) ?? sortingItems;
    if (reordered === sortingItems) return;
    setSortingItems(reordered);

    const pinnedOrderMap = new Map(reordered.map((link, index) => [link.id, index]));
    applyLocalOrder(dataRef.current.links.map(link => (
      pinnedOrderMap.has(link.id) ? { ...link, pinnedOrder: pinnedOrderMap.get(link.id) } : link
    )));
  };

  const rememberSortSnapshot = () => {
    sortSnapshotRef.current = dataRef.current.links.map(link => ({ ...link }));
  };

  const restoreSortSnapshot = () => {
    const restored = sortSnapshotRef.current;
    sortSnapshotRef.current = null;
    if (!restored) return;
    dataRef.current = { ...dataRef.current, links: restored };
    setLinks(restored);
    writeLocalCache(restored, dataRef.current.categories);
  };

  // 开始排序
  const startSorting = (categoryId: string) => {
    rememberSortSnapshot();
    setSortingItems(displayedLinks.map(link => ({ ...link })));
    setIsSortingMode(categoryId);
  };

  // 保存排序
  const saveSorting = () => {
    sortSnapshotRef.current = null;
    setSortingItems(null);
    updateData(dataRef.current.links, dataRef.current.categories);
    setIsSortingMode(null);
  };

  // 取消排序：恢复进入排序前的顺序
  const cancelSorting = () => {
    setSortingItems(null);
    restoreSortSnapshot();
    setIsSortingMode(null);
  };

  // 保存置顶链接排序
  const savePinnedSorting = () => {
    sortSnapshotRef.current = null;
    setSortingItems(null);
    updateData(dataRef.current.links, dataRef.current.categories);
    setIsSortingPinned(false);
  };

  // 取消置顶链接排序
  const cancelPinnedSorting = () => {
    setSortingItems(null);
    restoreSortSnapshot();
    setIsSortingPinned(false);
  };

  // 设置dnd-kit的传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDeleteLink = (id: string) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (confirm('确定删除此链接吗？')) {
      updateData(links.filter(l => l.id !== id), categories);
    }
  };

  const togglePin = (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!authToken) { setIsAuthOpen(true); return; }
      
      const linkToToggle = links.find(l => l.id === id);
      if (!linkToToggle) return;
      
      // 如果是设置为置顶，则设置pinnedOrder为当前置顶链接数量
      // 如果是取消置顶，则清除pinnedOrder
      const updated = links.map(l => {
        if (l.id === id) {
          const isPinned = !l.pinned;
          return { 
            ...l, 
            pinned: isPinned,
            pinnedOrder: isPinned ? links.filter(link => link.pinned).length : undefined
          };
        }
        return l;
      });
      
      updateData(updated, categories);
  };

  const handleSaveAIConfig = async (config: AIConfig, newSiteSettings?: SiteSettings) => {
      setAiConfig(config);
      safeSetItem(AI_CONFIG_KEY, JSON.stringify(config));
      
      if (newSiteSettings) {
          setSiteSettings(newSiteSettings);
          safeSetItem('cloudnav_site_settings', JSON.stringify(newSiteSettings));
      }
      
      if (authToken) {
          try {
              const response = await fetch('/api/storage', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'x-auth-password': authToken
                  },
                  body: JSON.stringify({
                      saveConfig: 'ai',
                      config: config
                  })
              });
              
              if (!response.ok) {
                  console.error('Failed to save AI config to KV:', response.statusText);
                  updateSyncStatus('error');
                  alert('AI 配置保存到云端失败，刷新后会丢失，请稍后重试');
              }
          } catch (error) {
              console.error('Error saving AI config to KV:', error);
              updateSyncStatus('error');
              alert('AI 配置保存到云端失败，刷新后会丢失，请稍后重试');
          }
          
          if (newSiteSettings) {
              try {
                  const response = await fetch('/api/storage', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                          'x-auth-password': authToken
                      },
                      body: JSON.stringify({
                          saveConfig: 'website',
                          config: newSiteSettings
                      })
                  });
                  
                  if (!response.ok) {
                      console.error('Failed to save website config to KV:', response.statusText);
                      updateSyncStatus('error');
                      alert('网站设置保存到云端失败，刷新后会丢失，请稍后重试');
                  }
              } catch (error) {
                  console.error('Error saving website config to KV:', error);
                  updateSyncStatus('error');
                  alert('网站设置保存到云端失败，刷新后会丢失，请稍后重试');
              }
          }
      }
  };

  // 切换"打开网站先验密"开关：即时保存到 KV，对所有访问者生效
  const handleToggleRequireLogin = async (enabled: boolean) => {
      const newSettings = { ...siteSettings, requireLoginAccess: enabled };
      setSiteSettings(newSettings);
      safeSetItem('cloudnav_site_settings', JSON.stringify(newSettings));
      // 同步更新认证门状态：开启后未登录的访问者会看到密码门，已登录用户不受影响；
      // 关闭则全站直接浏览（保存/修改等操作仍需密码）
      setRequiresAuth(enabled);
      
      if (!authToken) {
          console.warn('未登录，无法保存访问验密开关到服务器');
          return;
      }
      try {
          const response = await fetch('/api/storage', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'x-auth-password': authToken
              },
              body: JSON.stringify({
                  saveConfig: 'website',
                  config: newSettings
              })
          });
          if (!response.ok) {
              console.error('Failed to save website config to KV:', response.statusText);
              alert('访问验密开关保存到云端失败，刷新后会恢复原设置，请稍后重试');
          }
      } catch (error) {
          console.error('Error saving website config to KV:', error);
          alert('访问验密开关保存到云端失败，刷新后会恢复原设置，请稍后重试');
      }
  };

  const handleRestoreAIConfig = async (config: AIConfig) => {
      setAiConfig(config);
      safeSetItem(AI_CONFIG_KEY, JSON.stringify(config));
      
      // 同时保存到KV空间
      if (authToken) {
          try {
              const response = await fetch('/api/storage', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'x-auth-password': authToken
                  },
                  body: JSON.stringify({
                      saveConfig: 'ai',
                      config: config
                  })
              });
              
              if (!response.ok) {
                  console.error('Failed to restore AI config to KV:', response.statusText);
                  alert('AI 配置恢复到云端失败，刷新后会丢失，请稍后重试');
              }
          } catch (error) {
              console.error('Error restoring AI config to KV:', error);
              alert('AI 配置恢复到云端失败，刷新后会丢失，请稍后重试');
          }
      }
  };

  // --- Category Management & Security ---

  const handleCategoryClick = (cat: Category) => {
      // 检查当前分类或其父分类是否设置了密码且未解锁
      const getLockedAncestor = (category: Category): Category | null => {
          // 如果当前分类有密码且未解锁，返回当前分类
          if (category.password && !unlockedCategoryIds.has(category.id)) {
              return category;
          }
          // 如果有父分类，递归检查父分类
          if (category.parentId) {
              const parent = categories.find(c => c.id === category.parentId);
              if (parent) {
                  return getLockedAncestor(parent);
              }
          }
          return null;
      };

      const lockedAncestor = getLockedAncestor(cat);
      if (lockedAncestor) {
          setCatAuthModalData(lockedAncestor);
          setSidebarOpen(false);
          return;
      }
      
      // 切换分类时退出批量编辑并清空选择：避免上一分类的选中集合在批量删除时误伤其他分类的链接
      if (isBatchEditMode) {
          setIsBatchEditMode(false);
          setSelectedLinks(new Set());
      }

      setSelectedCategory(cat.id);
      setSidebarOpen(false);
  };

  const handleUnlockCategory = (catId: string) => {
      setUnlockedCategoryIds(prev => new Set(prev).add(catId));
      setSelectedCategory(catId);
  };

  const handleUpdateCategories = (newCats: Category[]) => {
      if (!authToken) { setIsAuthOpen(true); return; }
      updateData(links, newCats);
  };

  const handleDeleteCategory = (catId: string, mode: 'migrate' | 'delete_all' = 'migrate', targetId: string = 'common') => {
      if (!authToken) { setIsAuthOpen(true); return; }
      
      // 找出所有要删除的分类ID（包括子分类）
      const idsToDelete = [catId];
      const children = categories.filter(c => c.parentId === catId);
      children.forEach(child => idsToDelete.push(child.id));

      let newCats = categories.filter(c => !idsToDelete.includes(c.id));
      
      let newLinks;
      if (mode === 'migrate') {
        // 迁移书签
        newLinks = links.map(l => idsToDelete.includes(l.categoryId) ? { ...l, categoryId: targetId } : l);
      } else {
        // 连同书签一起删除
        newLinks = links.filter(l => !idsToDelete.includes(l.categoryId));
      }
      
      updateData(newLinks, newCats);
  };

  // 搜索源选择弹出窗口状态
  const [showSearchSourcePopup, setShowSearchSourcePopup] = useState(false);
  const [hoveredSearchSource, setHoveredSearchSource] = useState<ExternalSearchSource | null>(null);
  const [selectedSearchSource, setSelectedSearchSource] = useState<ExternalSearchSource | null>(null);
  const [isIconHovered, setIsIconHovered] = useState(false);
  const [isPopupHovered, setIsPopupHovered] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 处理弹出窗口显示/隐藏逻辑
  useEffect(() => {
    if (isIconHovered || isPopupHovered) {
      // 如果图标或弹出窗口被悬停，清除隐藏定时器并显示弹出窗口
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      setShowSearchSourcePopup(true);
    } else {
      // 如果图标和弹出窗口都没有被悬停，设置一个延迟隐藏弹出窗口
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setShowSearchSourcePopup(false);
        setHoveredSearchSource(null);
      }, 300);
    }
    
    // 清理函数
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [isIconHovered, isPopupHovered]);

  // 处理搜索源选择
  const handleSearchSourceSelect = async (source: ExternalSearchSource) => {
    if (!isSafeSearchSource(source)) return;

    // 更新选中的搜索源
    setSelectedSearchSource(source);
    
    // 先同步打开新标签页：下面的 await 保存会消耗 transient activation，
    // 放到 await 之后 window.open 会被弹窗拦截静默失败
    if (searchQuery.trim()) {
      const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
      window.open(searchUrl, '_blank', 'noopener,noreferrer');
    }
    
    // 保存选中的搜索源到KV空间
    await handleSaveSearchConfig(externalSearchSources, searchMode, source);
    
    setShowSearchSourcePopup(false);
    setHoveredSearchSource(null);
  };

  // --- Search Config ---
  const handleSaveSearchConfig = async (sources: ExternalSearchSource[], mode: SearchMode, selectedSource?: ExternalSearchSource | null) => {
      const safeSources = sources.filter(isSafeSearchSource);
      const requestedSelectedSource = selectedSource !== undefined ? selectedSource : selectedSearchSource;
      const safeSelectedSource = isSafeSearchSource(requestedSelectedSource)
          ? safeSources.find(source => source.id === requestedSelectedSource.id) ?? null
          : null;
      const searchConfig: SearchConfig = {
          mode,
          externalSources: safeSources,
          selectedSource: safeSelectedSource
      };
      
      setExternalSearchSources(safeSources);
      setSearchMode(mode);
      if (selectedSource !== undefined) {
          setSelectedSearchSource(safeSelectedSource);
      }
      
      // 只保存到KV空间（搜索配置允许无密码访问）
      try {
          const headers: Record<string, string> = {
              'Content-Type': 'application/json'
          };
          
          // 如果有认证令牌，添加认证头
          if (authToken) {
              headers['x-auth-password'] = authToken;
          }
          
          const response = await fetch('/api/storage', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({
                  saveConfig: 'search',
                  config: searchConfig
              })
          });
          
          if (!response.ok) {
              console.error('Failed to save search config to KV:', response.statusText);
              // 未登录时搜索配置只在本地生效（服务端返回 401），首次明确告知用户
              if (response.status === 401 && !authToken) {
                  if (!searchPersistNoticeShown.current) {
                      searchPersistNoticeShown.current = true;
                      alert('当前未登录：搜索配置仅在本地生效，登录后才会保存到云端。');
                  }
              } else {
                  updateSyncStatus('error');
              }
          }
      } catch (error) {
          console.error('Error saving search config to KV:', error);
          updateSyncStatus('error');
      }
  };

  const handleSearchModeChange = (mode: SearchMode) => {
      setSearchMode(mode);
      
      // 如果切换到外部搜索模式且搜索源列表为空，自动加载默认搜索源
      if (mode === 'external' && externalSearchSources.length === 0) {
          const defaultSources: ExternalSearchSource[] = [
              {
                  id: 'bing',
                  name: '必应',
                  url: 'https://www.bing.com/search?q={query}',
                  icon: 'Search',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'google',
                  name: 'Google',
                  url: 'https://www.google.com/search?q={query}',
                  icon: 'Search',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'baidu',
                  name: '百度',
                  url: 'https://www.baidu.com/s?wd={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'sogou',
                  name: '搜狗',
                  url: 'https://www.sogou.com/web?query={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'yandex',
                  name: 'Yandex',
                  url: 'https://yandex.com/search/?text={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'github',
                  name: 'GitHub',
                  url: 'https://github.com/search?q={query}',
                  icon: 'Github',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'linuxdo',
                  name: 'Linux.do',
                  url: 'https://linux.do/search?q={query}',
                  icon: 'Terminal',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'bilibili',
                  name: 'B站',
                  url: 'https://search.bilibili.com/all?keyword={query}',
                  icon: 'Play',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'youtube',
                  name: 'YouTube',
                  url: 'https://www.youtube.com/results?search_query={query}',
                  icon: 'Video',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'wikipedia',
                  name: '维基',
                  url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                  icon: 'BookOpen',
                  enabled: true,
                  createdAt: Date.now()
              }
          ];
          
          // 保存默认搜索源到状态和KV空间
          handleSaveSearchConfig(defaultSources, mode);
      } else {
          handleSaveSearchConfig(externalSearchSources, mode);
      }
  };

  const handleExternalSearch = () => {
      if (searchQuery.trim() && searchMode === 'external') {
          // 如果搜索源列表为空，自动加载默认搜索源
          if (externalSearchSources.length === 0) {
              const defaultSources: ExternalSearchSource[] = [
                  {
                      id: 'bing',
                      name: '必应',
                      url: 'https://www.bing.com/search?q={query}',
                      icon: 'Search',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'google',
                      name: 'Google',
                      url: 'https://www.google.com/search?q={query}',
                      icon: 'Search',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'baidu',
                      name: '百度',
                      url: 'https://www.baidu.com/s?wd={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'sogou',
                      name: '搜狗',
                      url: 'https://www.sogou.com/web?query={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'yandex',
                      name: 'Yandex',
                      url: 'https://yandex.com/search/?text={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'github',
                      name: 'GitHub',
                      url: 'https://github.com/search?q={query}',
                      icon: 'Github',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'linuxdo',
                      name: 'Linux.do',
                      url: 'https://linux.do/search?q={query}',
                      icon: 'Terminal',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'bilibili',
                      name: 'B站',
                      url: 'https://search.bilibili.com/all?keyword={query}',
                      icon: 'Play',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'youtube',
                      name: 'YouTube',
                      url: 'https://www.youtube.com/results?search_query={query}',
                      icon: 'Video',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'wikipedia',
                      name: '维基',
                      url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                      icon: 'BookOpen',
                      enabled: true,
                      createdAt: Date.now()
                  }
              ];
              
              // 保存默认搜索源到状态和KV空间
              handleSaveSearchConfig(defaultSources, 'external');
              
              // 使用第一个默认搜索源立即执行搜索
              const searchUrl = defaultSources[0].url.replace('{query}', encodeURIComponent(searchQuery));
              window.open(searchUrl, '_blank', 'noopener,noreferrer');
              return;
          }
          
          // 如果有选中的搜索源，使用选中的搜索源；否则使用第一个启用的搜索源
          let source = selectedSearchSource;
          if (!source) {
              const enabledSources = externalSearchSources.filter(s => s.enabled);
              if (enabledSources.length > 0) {
                  source = enabledSources[0];
              }
          }
          
          if (source && isSafeSearchSource(source)) {
              const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
              window.open(searchUrl, '_blank', 'noopener,noreferrer');
          }
      }
  };

  const handleRestoreBackup = async (restoredLinks: LinkItem[], restoredCategories: Category[]): Promise<boolean> => {
      // 启发式防护：当前数据含受保护分类而备份完全不包含分类密码时，可能是未登录时导出的脱敏快照，
      // forceFullData 会绕过脱敏闸门，恢复后密码与受保护链接将永久丢失——让用户显式确认
      const currentHasProtected = categories.some(c => c.password);
      const restoredHasProtected = restoredCategories.some(c => c.password);
      if (currentHasProtected && !restoredHasProtected) {
          const proceed = confirm(
              '警告：当前数据包含受密码保护的分类，但该备份中不包含任何分类密码。\n' +
              '若这是未登录状态下导出的脱敏备份，恢复后将丢失所有受保护分类的密码与链接。\n\n确定要继续恢复吗？'
          );
          if (!proceed) return false;
      }
      const ok = await updateData(restoredLinks, restoredCategories, { forceFullData: true });
      if (ok) setIsBackupModalOpen(false);
      return ok;
  };

  const handleRestoreSearchConfig = (restoredSearchConfig: SearchConfig) => {
      const safeSearchConfig = sanitizeSearchConfig(restoredSearchConfig);
      if (!safeSearchConfig) return;

      // 传入备份中的 selectedSource，避免回落到当前内存中的旧值
      handleSaveSearchConfig(safeSearchConfig.externalSources, safeSearchConfig.mode, safeSearchConfig.selectedSource ?? null);
  };

  // --- Filtering & Memo ---

  // Helper to check if a category is "Locked" (Has password AND not unlocked, or its parent is locked)
  const isCategoryLocked = (catId: string): boolean => {
      const cat = categories.find(c => c.id === catId);
      if (!cat) return false;
      
      // 检查当前分类是否锁定
      if (cat.password && !unlockedCategoryIds.has(catId)) return true;
      
      // 如果有父分类，递归检查父分类是否锁定
      if (cat.parentId) {
          return isCategoryLocked(cat.parentId);
      }
      
      return false;
  };

  const pinnedLinks = useMemo(() => {
      // Don't show pinned links if they belong to a locked category
      const filteredPinnedLinks = links.filter(l => l.pinned && !isCategoryLocked(l.categoryId));
      // 按照pinnedOrder字段排序，如果没有pinnedOrder字段则按创建时间排序
      return filteredPinnedLinks.sort((a, b) => {
        // 如果有pinnedOrder字段，则使用pinnedOrder排序
        if (a.pinnedOrder !== undefined && b.pinnedOrder !== undefined) {
          return a.pinnedOrder - b.pinnedOrder;
        }
        // 如果只有一个有pinnedOrder字段，有pinnedOrder的排在前面
        if (a.pinnedOrder !== undefined) return -1;
        if (b.pinnedOrder !== undefined) return 1;
        // 如果都没有pinnedOrder字段，则按创建时间排序
        return a.createdAt - b.createdAt;
      });
  }, [links, categories, unlockedCategoryIds]);

  // 全站搜索匹配（含标题/URL/描述/分类名 + 拼音首字母）；用 useCallback 稳定引用，避免 useMemo 依赖每次渲染变化导致缓存失效
  const isLinkMatchSearch = useCallback((link: LinkItem, q: string): boolean => {
    const matchText = (text?: string) => !!text && (
      text.toLowerCase().includes(q) || matchPinyinInitials(text, q)
    );
    const cat = categories.find(c => c.id === link.categoryId);
    return (
      matchText(link.title) ||
      matchText(link.url) ||
      matchText(link.description) ||
      matchText(cat?.name)
    );
  }, [categories]);

  // 分类或搜索条件变化时重置分批渲染计数
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setOtherResultsVisibleCount(PAGE_SIZE);
  }, [selectedCategory, searchQuery]);

  const displayedLinks = useMemo(() => {
    let result = links;
    
    // Security Filter: Always hide links from locked categories
    result = result.filter(l => !isCategoryLocked(l.categoryId));

    // Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => isLinkMatchSearch(l, q));
    }

    // Category Filter
    if (selectedCategory !== 'all') {
      // 获取当前分类及其所有子分类的ID
      const subCategoryIds = categories.filter(c => c.parentId === selectedCategory).map(c => c.id);
      result = result.filter(l => l.categoryId === selectedCategory || subCategoryIds.includes(l.categoryId));
    }
    
    // 按照order字段排序，如果没有order字段则按创建时间排序
    // 修改排序逻辑：order值越大排在越前面，新增的卡片order值最大，会排在最前面
    // 我们需要反转这个排序，让新增的卡片(order值最大)排在最后面
    return result.sort((a, b) => {
      const aOrder = a.order !== undefined ? a.order : a.createdAt;
      const bOrder = b.order !== undefined ? b.order : b.createdAt;
      // 改为升序排序，这样order值小(旧卡片)的排在前面，order值大(新卡片)的排在后面
      return aOrder - bOrder;
    });
  }, [links, selectedCategory, searchQuery, categories, unlockedCategoryIds, isLinkMatchSearch]);

  // 计算其他目录的搜索结果
  const otherCategoryResults = useMemo<Record<string, LinkItem[]>>(() => {
    if (!searchQuery.trim() || selectedCategory === 'all') {
      return {};
    }

    const q = searchQuery.toLowerCase();
    
    // 获取其他目录中匹配的链接
    // 当前分类及其子分类已经在主列表里，不能再出现在“其他目录”
    const visibleCategoryIds = new Set<string>([
      selectedCategory,
      ...categories.filter(c => c.parentId === selectedCategory).map(c => c.id)
    ]);
    const otherLinks = links.filter(link => {
      if (visibleCategoryIds.has(link.categoryId)) {
        return false;
      }
      
      // 排除锁定的目录
      if (isCategoryLocked(link.categoryId)) {
        return false;
      }
      
      // 搜索匹配
      return isLinkMatchSearch(link, q);
    });

    // 按目录分组
    const groupedByCategory = otherLinks.reduce((acc, link) => {
      if (!acc[link.categoryId]) {
        acc[link.categoryId] = [];
      }
      acc[link.categoryId].push(link);
      return acc;
    }, {} as Record<string, LinkItem[]>);

    // 对每个目录内的链接进行排序
    Object.keys(groupedByCategory).forEach(categoryId => {
      groupedByCategory[categoryId].sort((a, b) => {
        const aOrder = a.order !== undefined ? a.order : a.createdAt;
        const bOrder = b.order !== undefined ? b.order : b.createdAt;
        return aOrder - bOrder;
      });
    });

    return groupedByCategory;
  }, [links, selectedCategory, searchQuery, categories, unlockedCategoryIds, isLinkMatchSearch]);


  // --- Render Components ---

  const renderLinkCard = (link: LinkItem) => {
    const isSelected = selectedLinks.has(link.id);
    
    // 检查是否在有二级分类的一级分类页面下，且该站点未归属到二级分类
    const isUnassignedHighlight = selectedCategory !== 'all' && 
                                 !categories.find(c => c.id === selectedCategory)?.parentId && 
                                 link.categoryId === selectedCategory && 
                                 categories.some(c => c.parentId === selectedCategory);

    // 根据视图模式决定卡片样式
    const isDetailedView = siteSettings.cardStyle === 'detailed';
    
    return (
      <div
        key={link.id}
        className={`group relative transition-all duration-200 hover:shadow-lg hover:shadow-blue-100/50 dark:hover:shadow-blue-900/20 ${
          isSelected 
            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' 
            : isUnassignedHighlight
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/30'
              : 'bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-slate-200 dark:border-slate-700'
        } ${isBatchEditMode ? 'cursor-pointer' : ''} ${
          isDetailedView 
            ? 'flex flex-col rounded-2xl border shadow-sm p-4 min-h-[100px] hover:border-blue-400 dark:hover:border-blue-500' 
            : 'flex items-center justify-between rounded-xl border shadow-sm p-3 hover:border-blue-300 dark:hover:border-blue-600'
        }`}
        onClick={() => isBatchEditMode && toggleLinkSelection(link.id)}
        onContextMenu={(e) => handleContextMenu(e, link)}
      >
        {/* 链接内容 - 在批量编辑模式下不使用a标签 */}
        {isBatchEditMode ? (
          <div className={`flex flex-1 min-w-0 overflow-hidden h-full ${
            isDetailedView ? 'flex-col' : 'items-center'
          }`}>
            {/* 第一行：图标和标题水平排列 */}
            <div className={`flex items-center gap-3 w-full`}>
              {/* Icon */}
              <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
                isDetailedView ? 'w-8 h-8 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800' : 'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
              }`}>
                  {link.icon ? <img src={link.icon} alt="" className="w-5 h-5"/> : link.title.charAt(0)}
              </div>
              
              {/* 标题 */}
              <h3 className={`text-slate-900 dark:text-slate-100 truncate overflow-hidden text-ellipsis ${
                isDetailedView ? 'text-base' : 'text-sm font-medium text-slate-800 dark:text-slate-200'
              }`} title={link.title}>
                  {link.title}
              </h3>
            </div>
            
            {/* 第二行：描述文字 */}
            {isDetailedView && link.description && (
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                {link.description}
              </p>
            )}
          </div>
        ) : (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-1 min-w-0 overflow-hidden h-full ${
              isDetailedView ? 'flex-col' : 'items-center'
            }`}
            title={link.description || link.url}
          >
            {/* 第一行：图标和标题水平排列 */}
            <div className={`flex items-center gap-3 w-full`}>
              {/* Icon */}
              <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
                isDetailedView ? 'w-8 h-8 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800' : 'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
              }`}>
                  {link.icon ? <img src={link.icon} alt="" className="w-5 h-5"/> : link.title.charAt(0)}
              </div>
              
              {/* 标题 */}
                <h3 className={`text-slate-800 dark:text-slate-200 truncate whitespace-nowrap overflow-hidden text-ellipsis group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors ${
                  isDetailedView ? 'text-base' : 'text-sm font-medium'
                }`} title={link.title}>
                    {link.title}
                </h3>
            </div>
            
            {/* 第二行：描述文字 */}
              {isDetailedView && link.description && (
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                  {link.description}
                </p>
              )}
            {!isDetailedView && link.description && (
              <div className="tooltip-custom absolute left-0 bottom-full mb-2 w-max max-w-xs bg-black text-white text-xs leading-relaxed p-2 rounded opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all z-20 pointer-events-none whitespace-normal break-words line-clamp-4">
                {link.description}
              </div>
            )}
          </a>
        )}

        {/* Hover Actions (Absolute Right) - 在批量编辑模式下隐藏 */}
        {!isBatchEditMode && (
          <div className={`flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-50 dark:bg-blue-900/20 backdrop-blur-sm rounded-md p-1 absolute ${
            isDetailedView ? 'top-3 right-3' : 'top-1/2 -translate-y-1/2 right-2'
          }`}>
              <button 
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingLink(link); setIsModalOpen(true); }}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md"
                  title="编辑"
              >
                                    <Edit2 size={15} />
              </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden text-slate-900 dark:text-slate-50">
      {/* 全屏壁纸层：固定在视口，从顶栏底部（h-16）开始铺满剩余区域，不随侧边栏展开/收起变化 */}
      {siteSettings.wallpaper?.url && (
        <div className="fixed left-0 right-0 top-16 bottom-0 z-0 pointer-events-none overflow-hidden">
          <img
            src={siteSettings.wallpaper.url}
            alt=""
            className="w-full h-full object-cover"
            style={{
              filter: `blur(${siteSettings.wallpaper.blur ?? 0}px) brightness(${siteSettings.wallpaper.brightness ?? 1}) saturate(${siteSettings.wallpaper.saturate ?? 1})`,
              transform: (siteSettings.wallpaper.blur ?? 0) > 0 ? 'scale(1.05)' : undefined // 模糊时轻微放大避免边缘发白
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          {/* 渐变遮罩：保证内容可读性，强度由设置控制 */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, rgba(248,250,252,${siteSettings.wallpaper.mask ?? 0.4}) 0%, rgba(241,245,249,${(siteSettings.wallpaper.mask ?? 0.4) * 0.85}) 60%, rgba(248,250,252,${siteSettings.wallpaper.mask ?? 0.4}) 100%)`
            }}
          />
        </div>
      )}
      {/* 认证遮罩层 - 当需要认证时显示 */}
      {requiresAuth && !authToken && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-slate-900 flex items-center justify-center">
          <div className="w-full max-w-md p-6">
            <div className="text-center mb-8">
              <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 mb-2">
                需要身份验证
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                此导航页面设置了访问密码，请输入密码以继续访问。
              </p>
            </div>
            <AuthModal isOpen={true} onLogin={handleLogin} />
          </div>
        </div>
      )}
      
      {/* 主要内容 - 只有在不需要认证或已认证时显示 */}
      {(!requiresAuth || authToken) && (
        <>
          <AuthModal isOpen={isAuthOpen} onLogin={handleLogin} onClose={() => setIsAuthOpen(false)} />
      
      <CategoryAuthModal 
        isOpen={!!catAuthModalData}
        category={catAuthModalData}
        onClose={() => setCatAuthModalData(null)}
        onUnlock={handleUnlockCategory}
      />

      <Suspense fallback={null}>
        <CategoryManagerModal
          isOpen={isCatManagerOpen}
          onClose={() => setIsCatManagerOpen(false)}
          categories={categories}
          onUpdateCategories={handleUpdateCategories}
          onDeleteCategory={handleDeleteCategory}
          onVerifyPassword={handleCategoryActionAuth}
        />

        {isBackupModalOpen && (
          <BackupModal
            isOpen
            onClose={() => setIsBackupModalOpen(false)}
            links={links}
            categories={categories}
            onRestore={handleRestoreBackup}
            authToken={authToken}
            searchConfig={{ mode: searchMode, externalSources: externalSearchSources, selectedSource: selectedSearchSource }}
            onRestoreSearchConfig={handleRestoreSearchConfig}
            aiConfig={aiConfig}
            onRestoreAIConfig={handleRestoreAIConfig}
          />
        )}

        {isImportModalOpen && (
          <ImportModal
            isOpen
            onClose={() => setIsImportModalOpen(false)}
            existingLinks={links}
            categories={categories}
            onImport={handleImportConfirm}
            onImportSearchConfig={handleRestoreSearchConfig}
            onImportAIConfig={handleRestoreAIConfig}
          />
        )}

        {isSettingsModalOpen && (
          <SettingsModal
            isOpen
            onClose={() => setIsSettingsModalOpen(false)}
            config={aiConfig}
            siteSettings={siteSettings}
            onSave={handleSaveAIConfig}
            links={links}
            categories={categories}
            onUpdateLinks={(newLinks) => updateData(newLinks, categories)}
            authToken={authToken}
            onToggleRequireLogin={handleToggleRequireLogin}
            searchConfig={{ mode: searchMode, externalSources: externalSearchSources, selectedSource: selectedSearchSource }}
            aiConfig={aiConfig}
            onRestore={handleRestoreBackup}
            onRestoreSearchConfig={handleRestoreSearchConfig}
            onRestoreAIConfig={handleRestoreAIConfig}
          />
        )}

        {isSearchConfigModalOpen && (
          <SearchConfigModal
            isOpen
            onClose={() => setIsSearchConfigModalOpen(false)}
            sources={externalSearchSources}
            onSave={(sources) => handleSaveSearchConfig(sources, searchMode)}
          />
        )}

        {isLinkCheckModalOpen && (
          <LinkCheckModal
            isOpen
            onClose={() => setIsLinkCheckModalOpen(false)}
            links={links}
            categories={categories}
            authToken={authToken}
          />
        )}
      </Suspense>

      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black/50 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`
          fixed lg:relative inset-y-0 left-0 z-50 w-64 transform transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          ${isSidebarCollapsed ? 'lg:w-16' : 'lg:w-64'} lg:translate-x-0
        `}
      >
        {/* Logo */}
        <div 
          className={`h-16 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 shrink-0 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] px-6 ${
            isSidebarCollapsed ? 'lg:px-[17px]' : ''
          }`}>
            <span className={`text-xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent whitespace-nowrap truncate min-w-0 max-w-[200px] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              isSidebarCollapsed ? 'lg:max-w-0 lg:opacity-0' : 'delay-100'
            }`}>
              {siteSettings.navTitle || 'CloudNav'}
            </span>
            <>
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex lg:hidden p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="关闭侧边栏"
              >
                <X size={20} />
              </button>

              {/* 桌面端：展开/收起按钮（收起后保留在图标栏顶部） */}
              <button 
                onClick={() => { setIsSidebarCollapsed(!isSidebarCollapsed); setPinnedRailCategory(null); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors hidden lg:flex"
                title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              >
                {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
            </>
        </div>

        {/* Categories List */}
        <div 
          className="flex-1 overflow-y-auto py-4 space-y-1 scrollbar-hide"
          onScroll={() => { setHoveredCategory(null); setPinnedRailCategory(null); }}
        >
            <div className="px-4">
              <button
                onClick={() => {
                  // 切换回置顶页同样退出批量编辑并清空选择，避免误删
                  if (isBatchEditMode) { setIsBatchEditMode(false); setSelectedLinks(new Set()); }
                  setSelectedCategory('all'); setSidebarOpen(false); setPinnedRailCategory(null);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] whitespace-nowrap ${
                  isSidebarCollapsed ? 'lg:px-[2px]' : ''
                } ${
                  selectedCategory === 'all' 
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' 
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <div className={`p-1 shrink-0`}><Icon name="LayoutGrid" size={18} /></div>
                <span className={`truncate min-w-0 max-w-[120px] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  isSidebarCollapsed ? 'lg:max-w-0 lg:opacity-0' : 'delay-100'
                }`}>置顶网站</span>
              </button>
            </div>
            
            <div className="flex items-center justify-between pt-4 pb-2 px-8">
               <span className={`text-xs font-semibold text-slate-400 uppercase tracking-wider truncate min-w-0 max-w-[120px] transition-all duration-200 ${isSidebarCollapsed ? 'lg:max-w-0 lg:opacity-0 lg:pointer-events-none' : 'delay-100'}`}>分类目录</span>
               <button 
                  onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsCatManagerOpen(true); }}
                  onPointerEnter={loadCategoryManagerModal}
                  onFocus={loadCategoryManagerModal}
                  className={`p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-all duration-200 ${isSidebarCollapsed ? 'lg:opacity-0 lg:pointer-events-none' : ''}`}
                  title="管理分类"
               >
                  <Settings size={14} />
               </button>
            </div>

            {categories.filter(c => !c.parentId).map(cat => {
                const isLocked = cat.password && !unlockedCategoryIds.has(cat.id);
                const subCats = categories.filter(c => c.parentId === cat.id);
                return (
                  <div 
                    key={cat.id} 
                    className="relative px-4"
                    onMouseEnter={(e) => {
                      setHoveredCategory(cat.id);
                      setHoveredCategoryTop(e.currentTarget.getBoundingClientRect().top);
                    }}
                    onMouseLeave={() => setHoveredCategory(null)}
                  >
                    <button
                      onClick={() => {
                        handleCategoryClick(cat);
                        // 图标栏模式下：有子分类时点击固定展开子分类菜单，再次点击切换关闭
                        if (isSidebarCollapsed && subCats.length > 0 && !isLocked) {
                          setPinnedRailCategory(prev => prev === cat.id ? null : cat.id);
                        } else {
                          setPinnedRailCategory(null);
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group whitespace-nowrap ${
                        isSidebarCollapsed ? 'lg:px-[2px]' : ''
                      } ${
                        selectedCategory === cat.id || (subCats.some(sc => sc.id === selectedCategory))
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' 
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${selectedCategory === cat.id ? 'bg-blue-100 dark:bg-blue-800' : 'bg-slate-100 dark:bg-slate-800'}`}>
                        {isLocked ? <Lock size={16} className="text-amber-500" /> : <Icon name={cat.icon} size={16} />}
                      </div>
                      <span className={`truncate flex-1 min-w-0 max-w-[200px] text-left transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                        isSidebarCollapsed ? 'lg:max-w-0 lg:opacity-0' : 'delay-100'
                      }`}>{cat.name}</span>
                      {(selectedCategory === cat.id || subCats.some(sc => sc.id === selectedCategory)) && <div className={`w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 transition-opacity duration-200 ${isSidebarCollapsed ? 'lg:opacity-0' : ''}`}></div>}
                      {subCats.length > 0 && (
                        <div className={`text-slate-400 group-hover:text-blue-500 transition-all duration-200 ${isSidebarCollapsed ? 'lg:opacity-0' : ''}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                        </div>
                      )}
                    </button>

                    {/* 二级分类悬浮菜单（加密分类未解锁时不显示，避免泄露子分类名） */}
                    {(hoveredCategory === cat.id || (isSidebarCollapsed && pinnedRailCategory === cat.id)) && subCats.length > 0 && !isLocked && (
                      <div 
                          className={`fixed ${isSidebarCollapsed ? 'lg:left-16' : 'lg:left-64'} w-[166px] bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-2 z-[60] animate-in fade-in slide-in-from-left-2 duration-200 hidden lg:block`}
                          style={{ top: Math.max(8, Math.min(hoveredCategoryTop, (typeof window !== 'undefined' ? window.innerHeight : 1080) - (48 + subCats.length * 37 + 14) - 8)) }}
                        >
                        {/* 增加一个透明的遮罩层，防止鼠标移动到间隙时消失 */}
                        <div className="absolute -left-4 top-0 bottom-0 w-4 bg-transparent" />
                        
                        <div className="px-4 py-1 mb-1 border-b border-slate-100 dark:border-slate-700">
                          <span className="font-bold text-slate-400 uppercase tracking-widest" style={{ fontSize: '13px' }}>{cat.name} / 二级分类</span>
                        </div>
                        {subCats.map(subCat => {
                          const isSubLocked = isCategoryLocked(subCat.id);
                          return (
                            <button
                              key={subCat.id}
                              onClick={() => { handleCategoryClick(subCat); setPinnedRailCategory(null); }}
                              className={`w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left ${
                                selectedCategory === subCat.id ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {isSubLocked ? <Lock size={14} className="text-amber-500" /> : <Icon name={subCat.icon} size={14} />}
                              <span className="text-sm truncate">{subCat.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
            })}
        </div>

        {/* Footer Actions */}
        <div className={`p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 shrink-0 ${isSidebarCollapsed ? 'lg:px-2' : ''}`}>
            
            <div className={`grid grid-cols-4 gap-2 mb-2 ${isSidebarCollapsed ? 'lg:grid-cols-1' : ''}`}>
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsImportModalOpen(true); }}
                    onPointerEnter={loadImportModal}
                    onFocus={loadImportModal}
                    className={`flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all ${
                      isSidebarCollapsed ? 'lg:hidden' : ''
                    }`}
                    title="导入书签"
                >
                    <Upload size={14} />
                    <span className={isSidebarCollapsed ? 'lg:hidden' : ''}>导入</span>
                </button>
                
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsBackupModalOpen(true); }}
                    onPointerEnter={loadBackupModal}
                    onFocus={loadBackupModal}
                    className={`flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all ${
                      isSidebarCollapsed ? 'lg:hidden' : ''
                    }`}
                    title="备份与恢复"
                >
                    <CloudCog size={14} />
                    <span className={isSidebarCollapsed ? 'lg:hidden' : ''}>备份</span>
                </button>

                <button 
                    onClick={() => setIsSettingsModalOpen(true)}
                    onPointerEnter={loadSettingsModal}
                    onFocus={loadSettingsModal}
                    className={`flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all ${
                      isSidebarCollapsed && !authToken ? 'lg:hidden' : ''
                    }`}
                                        title="打开设置"
                  >
                    <Settings size={14} />
                    <span className={isSidebarCollapsed ? 'lg:hidden' : ''}>设置</span>
                </button>

                <button 
                    onClick={() => setIsLinkCheckModalOpen(true)}
                    onPointerEnter={loadLinkCheckModal}
                    onFocus={loadLinkCheckModal}
                    className={`flex flex-col items-center justify-center gap-1 p-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all ${
                      isSidebarCollapsed ? 'lg:hidden' : ''
                    }`}
                    title="批量检测链接可用性"
                >
                    <Activity size={14} />
                    <span className={isSidebarCollapsed ? 'lg:hidden' : ''}>检测</span>
                </button>
            </div>
            
            <div className={`flex items-center justify-between text-xs px-2 mt-2 ${isSidebarCollapsed ? 'lg:flex-col lg:items-center lg:gap-1.5' : ''}`}>
               <div className="flex items-center gap-1 text-slate-400">
                 {syncStatus === 'saving' && <Loader2 className="animate-spin w-3 h-3 text-blue-500" />}
                 {syncStatus === 'saved' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                 {syncStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
                 <span className={isSidebarCollapsed ? 'lg:hidden' : ''}>{authToken
                    ? <span className={syncStatus === 'error' ? 'text-red-500' : 'text-green-600'}>
                        {syncStatus === 'saving' ? '保存中' : syncStatus === 'error' ? '同步失败' : '已同步'}
                      </span>
                    : <span className="text-amber-500">离线</span>}</span>
               </div>

               <a 
                 href={GITHUB_REPO_URL} 
                 target="_blank" 
                 rel="noopener noreferrer"
                 className={`flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ${isSidebarCollapsed ? 'lg:hidden' : ''}`}
                 title="在 GitHub 上 Fork 本项目"
               >
                 <GitFork size={14} />
                 <span className={isSidebarCollapsed ? 'lg:hidden' : ''}>Fork 项目 v1.8.2</span>
               </a>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 flex flex-col h-full overflow-hidden relative ${siteSettings.wallpaper?.url ? '' : 'bg-slate-50 dark:bg-slate-900'}`}>
        
        {/* Header */}
        <header className="h-16 px-4 lg:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <button onClick={() => setSidebarOpen(true)} aria-label="打开侧边栏" className="p-2 -ml-2 text-slate-600 dark:text-slate-300 lg:hidden">
              <Menu size={24} />
            </button>

            {/* 搜索模式切换 + 搜索框 */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* 移动端搜索图标 - 仅在手机端显示，平板端隐藏 */}
              <button 
                onClick={() => {
                  setIsMobileSearchOpen(!isMobileSearchOpen);
                  // 手机端点击搜索图标时默认使用站外搜索
                  if (searchMode !== 'external') {
                    handleSearchModeChange('external');
                  }
                }}
                className="sm:flex md:hidden lg:hidden p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="搜索"
                aria-label="搜索"
              >
                <Search size={20} />
              </button>

              {/* 搜索模式切换 - 平板端和桌面端显示，手机端隐藏 */}
              <div className="hidden sm:hidden md:flex lg:flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-1">
                  <button
                    onClick={() => handleSearchModeChange('internal')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center justify-center min-h-[24px] min-w-[40px] ${
                      searchMode === 'internal'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站内搜索"
                  >
                    站内
                  </button>
                  <button
                    onClick={() => handleSearchModeChange('external')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center justify-center min-h-[24px] min-w-[40px] ${
                      searchMode === 'external'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站外搜索"
                  >
                    站外
                  </button>
                </div>
                
                {/* 搜索配置管理按钮 */}
                {searchMode === 'external' && (
                  <button
                    onClick={() => setIsSearchConfigModalOpen(true)}
                    onPointerEnter={loadSearchConfigModal}
                    onFocus={loadSearchConfigModal}
                    className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                    title="管理搜索源"
                    aria-label="管理搜索源"
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>

              {/* 搜索框 */}
              <div className={`relative w-full max-w-lg ${isMobileSearchOpen ? 'block' : 'hidden'} sm:block`}>
                {/* 搜索源选择弹出窗口 */}
                {searchMode === 'external' && showSearchSourcePopup && (
                  <div 
                    className="absolute left-0 top-full w-full pt-2 z-[80]"
                    onMouseEnter={() => setIsPopupHovered(true)}
                    onMouseLeave={() => setIsPopupHovered(false)}
                  >
                  <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 p-3">
                    <div className="grid grid-cols-5 sm:grid-cols-5 gap-2">
                      {externalSearchSources
                        .filter(source => source.enabled)
.map((source) => (
<button
key={source.id}
                            onClick={() => handleSearchSourceSelect(source)}
                            onMouseEnter={() => setHoveredSearchSource(source)}
                            onMouseLeave={() => setHoveredSearchSource(null)}
                            className="px-2 py-2 text-sm rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-1 justify-center"
                          >
                            <img 
                              src={`https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://${safeHost(source.url)}`}
                              alt={source.name}
                              className="w-4 h-4"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                              }}
                            />
                            <span className="truncate hidden sm:inline">{source.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                  </div>
                )}
                
                {/* 搜索图标 */}
                <div 
                  role="button"
                  tabIndex={0}
                  aria-label="选择搜索源"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer"
                  onMouseEnter={() => searchMode === 'external' && setIsIconHovered(true)}
                  onMouseLeave={() => setIsIconHovered(false)}
                  onFocus={() => searchMode === 'external' && setIsIconHovered(true)}
                  onBlur={() => setIsIconHovered(false)}
                  onKeyDown={(e) => {
                    // 键盘可达：Enter/空格等价于点击（移动端点击展开搜索源选择窗口）
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (searchMode === 'external') {
                        setShowSearchSourcePopup(!showSearchSourcePopup);
                      }
                    }
                  }}
                  onClick={() => {
                    // 移动端点击事件：显示搜索源选择窗口
                    if (searchMode === 'external') {
                      setShowSearchSourcePopup(!showSearchSourcePopup);
                    }
                  }}
                >
                  {searchMode === 'internal' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search">
                      <path d="m21 21-4.35-4.35"></path>
                      <circle cx="11" cy="11" r="8"></circle>
                    </svg>
                  ) : (hoveredSearchSource || selectedSearchSource) ? (
                    <img 
                      src={`https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://${safeHost((hoveredSearchSource || selectedSearchSource)?.url)}`}
                      alt={(hoveredSearchSource || selectedSearchSource).name}
                      className="w-4 h-4"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                      }}
                    />
                  ) : (
                    <Search size={16} />
                  )}
                </div>
                
                <input
                  type="text"
                  placeholder={
                    searchMode === 'internal' 
                      ? "搜索站内内容..." 
                      : selectedSearchSource 
                        ? `在${selectedSearchSource.name}搜索内容` 
                        : "搜索站外内容..."
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchMode === 'external') {
                      handleExternalSearch();
                    }
                  }}
                  className="w-full pl-9 pr-4 py-2 rounded-full bg-slate-100 dark:bg-slate-700/50 border-none text-sm focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-slate-400 outline-none transition-all"
                  // 移动端优化：防止页面缩放
                  style={{ fontSize: '16px' }}
                  inputMode="search"
                  enterKeyHint="search"
                />
                
                {searchMode === 'external' && searchQuery.trim() && (
                  <button
                    onClick={handleExternalSearch}
                    className="absolute right-10 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-500"
                    title="执行站外搜索"
                    aria-label="执行站外搜索"
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
                
                {searchQuery.trim() && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-all"
                    title="清空搜索"
                    aria-label="清空搜索"
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 实时时钟（24 小时制）：与右侧视图切换保持适当间距 */}
            <div
              className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex items-center gap-1.5 px-1 mr-3`}
              title="当前时间"
            >
              <Clock size={20} className="text-blue-500 shrink-0" />
              <span className="text-xl font-bold text-slate-700 dark:text-slate-200 tabular-nums">{currentTime.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
            {/* 视图切换控制器 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-1`}>
              <button
                onClick={() => handleViewModeChange('simple')}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  siteSettings.cardStyle === 'simple'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="简约版视图"
              >
                简约
              </button>
              <button
                onClick={() => handleViewModeChange('detailed')}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  siteSettings.cardStyle === 'detailed'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="详情版视图"
              >
                详情
              </button>
            </div>

            {/* 主题切换按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <button onClick={toggleTheme} aria-label={darkMode ? '切换到浅色模式' : '切换到深色模式'} className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700`}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* 登录/退出按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'}`}>
              {!authToken ? (
                  <button onClick={() => setIsAuthOpen(true)} aria-label="登录" className="flex items-center gap-2 bg-slate-200 dark:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium">
                      <Cloud size={14} /> <span className="hidden sm:inline">登录</span>
                  </button>
              ) : (
                  <button onClick={handleLogout} aria-label="退出登录" className="flex items-center gap-2 bg-slate-200 dark:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium">
                      <LogOut size={14} /> <span className="hidden sm:inline">退出</span>
                  </button>
              )}
            </div>

            {/* 添加按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'}`}>
              <button
                onClick={() => { if(!authToken) setIsAuthOpen(true); else { setEditingLink(undefined); setIsModalOpen(true); }}}
                aria-label="添加链接"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-full text-sm font-medium shadow-lg shadow-blue-500/30"
              >
                <Plus size={16} /> <span className="hidden sm:inline">添加</span>
              </button>
            </div>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-8 space-y-8 relative z-10">
            
            {/* 1. Pinned Area (Custom Top Area) */}
            {pinnedLinks.length > 0 && !searchQuery && (selectedCategory === 'all') && (
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Pin size={16} className="text-blue-500 fill-blue-500" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                置顶 / 常用
                            </h2>
                            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                                {pinnedLinks.length}
                            </span>
                        </div>
                        {isSortingPinned ? (
                            <div className="flex gap-2">
                                <button 
                                    onClick={savePinnedSorting}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                    title="保存顺序"
                                >
                                    <Save size={14} />
                                    <span>保存顺序</span>
                                </button>
                                <button 
                                    onClick={cancelPinnedSorting}
                                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all"
                                    title="取消排序"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <button 
                                onClick={() => { rememberSortSnapshot(); setSortingItems(pinnedLinks.map(link => ({ ...link }))); setIsSortingPinned(true); }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                title="排序"
                            >
                                <GripVertical size={14} />
                                <span>排序</span>
                            </button>
                        )}
                    </div>
                    {isSortingPinned ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            autoScroll={{ threshold: { x: 0.15, y: 0.15 }, acceleration: 12 }}
                            onDragEnd={handlePinnedDragEnd}
                        >
                            <SortableContext
                                items={(sortingItems ?? pinnedLinks).map(link => link.id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className={`grid gap-3 ${
                                  siteSettings.cardStyle === 'detailed' 
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                                    : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                                }`}>
                                    {(sortingItems ?? pinnedLinks).map(link => (
                                        <SortableLinkCard key={link.id} link={link} cardStyle={siteSettings.cardStyle} sortingActive={!!isSortingMode || isSortingPinned} />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                            {pinnedLinks.map(link => renderLinkCard(link))}
                        </div>
                    )}
                </section>
            )}

            {/* 2. Main Grid */}
            {(selectedCategory !== 'all' || searchQuery) && (
            <section>
                 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                     <div className="flex items-center flex-wrap gap-y-2">
                         <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mr-4">
                             {selectedCategory === 'all' 
                                ? (searchQuery ? '搜索结果' : '所有链接') 
                                : (() => {
                                    const currentCat = categories.find(c => c.id === selectedCategory);
                                    const primaryCat = currentCat?.parentId 
                                      ? categories.find(c => c.id === currentCat.parentId) 
                                      : currentCat;
                                    
                                    if (!primaryCat) return '未知分类';

                                    const subCats = categories.filter(c => c.parentId === primaryCat.id);
                                    
                                    return (
                                        <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <Icon name={primaryCat.icon} size={20} className="text-blue-500" />
                                          <button 
                                            onClick={() => handleCategoryClick(primaryCat)}
                                            className={`hover:text-blue-600 transition-colors ${selectedCategory === primaryCat.id ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 font-medium'}`}
                                          >
                                            {primaryCat.name}
                                          </button>
                                          {isCategoryLocked(primaryCat.id) && <Lock size={14} className="text-amber-500" />}
                                        </div>

                                        {/* 父分类已锁定时隐藏子分类名，避免泄露 */}
                                        {subCats.length > 0 && !isCategoryLocked(primaryCat.id) && (
                                          <>
                                            <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-600 mx-1" />
                                            <div className="flex items-center gap-4 overflow-x-auto scrollbar-hide py-1 min-w-0">
                                              {subCats.map(sub => (
                                                <button
                                                  key={sub.id}
                                                  onClick={() => handleCategoryClick(sub)}
                                                  className={`text-sm whitespace-nowrap transition-all relative py-1 ${
                                                    selectedCategory === sub.id 
                                                      ? 'text-blue-600 dark:text-blue-400 font-bold' 
                                                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium'
                                                  }`}
                                                >
                                                  <div className="flex items-center gap-1">
                                                    {sub.name}
                                                    {isCategoryLocked(sub.id) && <Lock size={12} className="text-amber-500" />}
                                                  </div>
                                                  {selectedCategory === sub.id && (
                                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full animate-in fade-in zoom-in duration-300" />
                                                  )}
                                                </button>
                                              ))}
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })()
                             }
                         </h2>
                         {selectedCategory !== 'all' && (
                           <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                             {displayedLinks.length}
                           </span>
                         )}
                     </div>
                     {selectedCategory !== 'all' && !isCategoryLocked(selectedCategory) && (
                         isSortingMode === selectedCategory ? (
                             <div className="flex gap-2">
                                 <button 
                                     onClick={saveSorting}
                                     className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                     title="保存顺序"
                                 >
                                     <Save size={14} />
                                     <span>保存顺序</span>
                                 </button>
                                 <button 
                                     onClick={cancelSorting}
                                     className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all"
                                     title="取消排序"
                                 >
                                     取消
                                 </button>
                             </div>
                         ) : (
                             <div className="flex gap-2">
                                 <button 
                                     onClick={toggleBatchEditMode}
                                     className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs font-medium rounded-full transition-colors ${
                                         isBatchEditMode 
                                             ? 'bg-red-600 hover:bg-red-700' 
                                             : 'bg-blue-600 hover:bg-blue-700'
                                     }`}
                                     title={isBatchEditMode ? "退出批量编辑" : "批量编辑"}
                                 >
                                     {isBatchEditMode ? '取消' : '批量编辑'}
                                 </button>
                                 {isBatchEditMode ? (
                                     <>
                                         <button 
                                             onClick={handleBatchDelete}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-full transition-colors"
                                             title="批量删除"
                                         >
                                             <Trash2 size={14} />
                                             <span>批量删除</span>
                                         </button>
                                         <button 
                                             onClick={handleSelectAll}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                             title="全选/取消全选"
                                         >
                                             <CheckSquare size={14} />
                                             <span>{selectedLinks.size === displayedLinks.length ? '取消全选' : '全选'}</span>
                                         </button>
                                         <div className="relative group">
                                              <button 
                                                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                                  title="批量移动"
                                              >
                                                  <Upload size={14} />
                                                  <span>批量移动</span>
                                              </button>
                                              <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 overflow-hidden max-h-[500px] overflow-y-auto no-scrollbar">
                                                  {(() => {
                                                    const flattened = [];
                                                    const parents = categories.filter(c => !c.parentId);
                                                    
                                                    for (const parent of parents) {
                                                      if (parent.id !== selectedCategory) {
                                                        flattened.push({
                                                          id: parent.id,
                                                          displayName: parent.name
                                                        });
                                                      }
                                                      
                                                      const children = categories.filter(c => c.parentId === parent.id);
                                                      for (const child of children) {
                                                        if (child.id !== selectedCategory) {
                                                          flattened.push({
                                                            id: child.id,
                                                            displayName: `${parent.name} / ${child.name}`
                                                          });
                                                        }
                                                      }
                                                    }
                                                    
                                                    return flattened.map(cat => (
                                                      <button
                                                          key={cat.id}
                                                          onClick={() => handleBatchMove(cat.id)}
                                                          className="w-full text-left px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors"
                                                      >
                                                          {cat.displayName}
                                                      </button>
                                                    ));
                                                  })()}
                                              </div>
                                          </div>
                                          <button
                                              onClick={handleBatchCopy}
                                              className="flex items-center gap-1 px-3 py-1.5 bg-slate-600 hover:bg-slate-700 text-white text-xs font-medium rounded-full transition-colors"
                                              title="复制选中网站的链接"
                                          >
                                              <Copy size={14} />
                                              <span>批量复制</span>
                                          </button>
                                     </>
                                 ) : (
                                     <button 
                                         onClick={() => startSorting(selectedCategory)}
                                         className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                         title="排序"
                                     >
                                         <GripVertical size={14} />
                                         <span>排序</span>
                                     </button>
                                 )}
                             </div>
                         )
                     )}
                 </div>

                 {displayedLinks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        {isCategoryLocked(selectedCategory) ? (
                            <>
                                <Lock size={40} className="text-amber-400 mb-4" />
                                <p>该目录已锁定</p>
                                <button onClick={() => {
                                    // 锁定可能挂在父分类上（当前选中的可以是无密码子分类），
                                    // 必须解析出真正上锁的分类对象，否则解锁了错误对象、页面永远解不开
                                    const resolveLocked = (cat: Category): Category | null => {
                                        if (cat.password && !unlockedCategoryIds.has(cat.id)) return cat;
                                        if (cat.parentId) {
                                            const parent = categories.find(c => c.id === cat.parentId);
                                            if (parent) return resolveLocked(parent);
                                        }
                                        return null;
                                    };
                                    setCatAuthModalData(resolveLocked(categories.find(c => c.id === selectedCategory) || ({ id: selectedCategory, name: '', icon: '' } as Category)) || null);
                                }} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-lg">输入密码解锁</button>
                            </>
                        ) : (
                            <>
                                <Search size={40} className="opacity-30 mb-4" />
                                <p>没有找到相关内容</p>
                                {selectedCategory !== 'all' && (
                                    <button onClick={() => setIsModalOpen(true)} className="mt-4 text-blue-500 hover:underline">添加一个</button>
                                )}
                            </>
                        )}
                    </div>
                 ) : (
                    isSortingMode === selectedCategory ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            autoScroll={{ threshold: { x: 0.15, y: 0.15 }, acceleration: 12 }}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={(sortingItems ?? displayedLinks).map(link => link.id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className={`grid gap-3 ${
                                  siteSettings.cardStyle === 'detailed' 
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                                    : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                                }`}>
                                    {(sortingItems ?? displayedLinks).map(link => (
                                        <SortableLinkCard key={link.id} link={link} cardStyle={siteSettings.cardStyle} sortingActive={!!isSortingMode || isSortingPinned} />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                        <>
                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                            {displayedLinks.slice(0, visibleCount).map(link => renderLinkCard(link))}
                        </div>
                        {displayedLinks.length > visibleCount && (
                            <div className="flex justify-center mt-6">
                                <button 
                                    onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                                    className="px-6 py-2 text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 text-slate-600 dark:text-slate-300 rounded-full transition-colors"
                                >
                                    加载更多（已显示 {visibleCount} / {displayedLinks.length}）
                                </button>
                            </div>
                        )}
                        </>
                    )
                 )}
            </section>
            )}

            {/* 其他目录搜索结果区域 */}
            {searchQuery.trim() && selectedCategory !== 'all' && (
              <section className="mt-8 pt-8 border-t-2 border-slate-200 dark:border-slate-700">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-folder-search">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                    <path d="M11 11h.01"></path>
                  </svg>
                  其他目录搜索结果
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-full">
                    {Object.values(otherCategoryResults).flat().length}
                  </span>
                </h2>

                {Object.keys(otherCategoryResults).length > 0 ? (
                  <>
                  {(Object.entries(otherCategoryResults) as [string, LinkItem[]][]).map(([categoryId, links]) => {
                    const category = categories.find(c => c.id === categoryId);
                    if (!category) return null;

                    return (
                      <div key={categoryId} className="mb-6 last:mb-0">
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            {category.name}
                          </h3>
                          <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-full">
                            {links.length}
                          </span>
                        </div>

                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                          {links.slice(0, otherResultsVisibleCount).map(link => renderLinkCard(link))}
                          {links.length > otherResultsVisibleCount && (
                            <div className="col-span-full text-center text-xs text-slate-400">
                              该目录还有 {links.length - otherResultsVisibleCount} 条结果未展示
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {Object.values(otherCategoryResults).flat().length > otherResultsVisibleCount && (
                    <div className="flex justify-center mt-6">
                      <button
                        onClick={() => setOtherResultsVisibleCount(c => c + PAGE_SIZE)}
                        className="px-6 py-2 text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 text-slate-600 dark:text-slate-300 rounded-full transition-colors"
                      >
                        加载更多（已显示 {otherResultsVisibleCount} / {Object.values(otherCategoryResults).flat().length}）
                      </button>
                    </div>
                  )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30 mb-4">
                      <circle cx="11" cy="11" r="8"></circle>
                      <path d="m21 21-4.35-4.35"></path>
                    </svg>
                    <p className="text-sm">其他目录中没有找到相关内容</p>
                  </div>
                )}
              </section>
            )}
        </div>
      </main>

          {/* 轻量操作反馈 toast */}
          {toast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-slate-900/85 dark:bg-slate-700/95 text-white text-sm shadow-lg pointer-events-none">
              {toast}
            </div>
          )}

          <LinkModal
            isOpen={isModalOpen}
            onClose={() => { setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined); }}
            onSave={editingLink ? handleEditLink : handleAddLink}
            onDelete={editingLink ? handleDeleteLink : undefined}
            categories={categories}
            initialData={editingLink || (prefillLink as LinkItem)}
            aiConfig={aiConfig}
            authToken={authToken}
            defaultCategoryId={selectedCategory !== 'all' ? selectedCategory : undefined}
          />

          {/* 右键菜单 */}
          <ContextMenu
            isOpen={contextMenu.isOpen}
            position={contextMenu.position}
            onClose={closeContextMenu}
            onCopyLink={copyLinkToClipboard}
            onShowQRCode={showQRCode}
            onEditLink={editLinkFromContextMenu}
            onDeleteLink={deleteLinkFromContextMenu}
            onTogglePin={togglePinFromContextMenu}
          />

          {/* 二维码模态框 */}
          <QRCodeModal
            isOpen={qrCodeModal.isOpen}
            url={qrCodeModal.url || ''}
            title={qrCodeModal.title || ''}
            onClose={() => setQrCodeModal({ isOpen: false, url: '', title: '' })}
          />
        </>
      )}
    </div>
  );
}

export default App;

