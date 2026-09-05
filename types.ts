export interface LinkItem {
  id: string;
  title: string;
  url: string;
  icon?: string;
  description?: string;
  categoryId: string;
  createdAt: number;
  pinned?: boolean; // New field for pinning
  pinnedOrder?: number; // Field for pinned link sorting order
}

export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name or emoji
  password?: string; // Optional password for category protection
  parentId?: string; // ID of the parent category if this is a sub-category
}

export interface SiteSettings {
  title: string;
  navTitle: string;
  favicon: string;
  cardStyle: 'detailed' | 'simple';
  passwordExpiryDays: number; // 密码过期天数，0表示永久不退出
  requirePasswordOnAccess?: boolean; // 访问时先验密：true=打开网站先输密码，false=仅管理操作需验密
}

export interface AppState {
  links: LinkItem[];
  categories: Category[];
  darkMode: boolean;
  settings?: SiteSettings;
}

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  enabled: boolean;
}

export type AIProvider = 'gemini' | 'openai';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  websiteTitle?: string; // 网站标题 (浏览器标签)
  faviconUrl?: string; // 网站图标URL
  navigationName?: string;
}



// 搜索模式类型
export type SearchMode = 'internal' | 'external';

// 外部搜索源配置
export interface ExternalSearchSource {
  id: string;
  name: string;
  url: string;
  icon?: string;
  enabled: boolean;
  createdAt: number;
}

// 搜索配置
export interface SearchConfig {
  mode: SearchMode;
  externalSources: ExternalSearchSource[];
  selectedSource?: ExternalSearchSource | null; // 选中的搜索源
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'common', name: '常用推荐', icon: 'Star' },
  { id: 'sub-search', name: '搜索引擎', icon: 'Search', parentId: 'common' },
  { id: 'sub-news', name: '即时资讯', icon: 'Newspaper', parentId: 'common' },
  { id: 'dev', name: '开发工具', icon: 'Code' },
  { id: 'design', name: '设计资源', icon: 'Palette' },
  { id: 'ent', name: '休闲娱乐', icon: 'Gamepad2' },
  { id: 'ai', name: '人工智能', icon: 'Bot' },
];

export const INITIAL_LINKS: LinkItem[] = [
  // 常用推荐 - 二级分类: 搜索引擎
  { id: 's1', title: 'Google', url: 'https://www.google.com', categoryId: 'sub-search', createdAt: Date.now(), description: '全球最大的搜索引擎', pinned: true, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://www.google.com' },
  { id: 's2', title: '百度', url: 'https://www.baidu.com', categoryId: 'sub-search', createdAt: Date.now(), description: '国内主流搜索引擎', pinned: true, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://www.baidu.com' },
  
  // 常用推荐 - 二级分类: 即时资讯
  { id: 'n1', title: 'IT之家', url: 'https://www.ithome.com', categoryId: 'sub-news', createdAt: Date.now(), description: '数码科技资讯平台', pinned: true, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://www.ithome.com' },
  
  // 开发工具
  { id: '1', title: 'GitHub', url: 'https://github.com', categoryId: 'dev', createdAt: Date.now(), description: '代码托管平台', pinned: true, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://github.com' },
  { id: '2', title: 'React', url: 'https://react.dev', categoryId: 'dev', createdAt: Date.now(), description: '构建Web用户界面的库', pinned: false, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://react.dev' },
  
  // 设计资源
  { id: '3', title: 'Tailwind CSS', url: 'https://tailwindcss.com', categoryId: 'design', createdAt: Date.now(), description: '原子化CSS框架', pinned: false, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://tailwindcss.com' },
  { id: 'd1', title: 'Dribbble', url: 'https://dribbble.com', categoryId: 'design', createdAt: Date.now(), description: '全球设计作品展示社区', pinned: false, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://dribbble.com' },

  // 休闲娱乐
  { id: 'e1', title: 'Bilibili', url: 'https://www.bilibili.com', categoryId: 'ent', createdAt: Date.now(), description: '国内知名的弹幕视频网站', pinned: false, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://www.bilibili.com' },
  { id: 'e2', title: 'Steam', url: 'https://store.steampowered.com', categoryId: 'ent', createdAt: Date.now(), description: '数字游戏发行平台', pinned: false, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://store.steampowered.com' },

  // 人工智能
  { id: '4', title: 'ChatGPT', url: 'https://chat.openai.com', categoryId: 'ai', createdAt: Date.now(), description: 'OpenAI聊天机器人', pinned: true, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://chat.openai.com' },
  { id: '5', title: 'Gemini', url: 'https://gemini.google.com', categoryId: 'ai', createdAt: Date.now(), description: 'Google DeepMind AI', pinned: true, icon: 'https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=https://gemini.google.com' },
];
