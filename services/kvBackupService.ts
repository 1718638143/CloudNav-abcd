
import { Category, LinkItem, SearchConfig, AIConfig } from "../types";

export interface KvBackupFile {
    id: string;
    createdAt: number;
    size: number;
    links: number;
    categories: number;
}

export interface KvBackupData {
    links: LinkItem[];
    categories: Category[];
    searchConfig?: SearchConfig;
    aiConfig?: AIConfig;
}

const withAuth = (authToken: string | null): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['x-auth-password'] = authToken;
    return headers;
};

const explainStatus = (status: number): string => {
    switch (status) {
        case 400: return '请求参数错误。';
        case 401: return '登录已过期或密码错误，请重新登录后再试。';
        case 404: return '备份不存在或已被清理。';
        default: return `操作失败 (HTTP ${status})，请稍后重试。`;
    }
};

// 保存 KV 在线备份
export const saveKvBackup = async (authToken: string | null, data: { links: LinkItem[], categories: Category[], searchConfig?: SearchConfig, aiConfig?: AIConfig }): Promise<{ success: true; id: string; total: number } | { success: false; error: string }> => {
    try {
        const response = await fetch('/api/storage', {
            method: 'POST',
            headers: withAuth(authToken),
            body: JSON.stringify({ saveConfig: 'backup', data })
        });

        if (!response.ok) {
            let msg = explainStatus(response.status);
            try {
                const errData = await response.json();
                if (errData?.error) msg = errData.error;
            } catch (e) {}
            return { success: false, error: msg };
        }

        const result = await response.json();
        if (result?.success && result.id) {
            return { success: true, id: result.id, total: result.total ?? 0 };
        }
        return { success: false, error: '保存失败，返回数据异常。' };
    } catch (e: any) {
        return { success: false, error: `网络错误：${e?.message || '无法连接服务器'}` };
    }
};

// 获取云端备份列表
export const listKvBackups = async (authToken: string | null): Promise<{ files: KvBackupFile[] | null; error: string | null }> => {
    try {
        const response = await fetch('/api/storage?getConfig=backup', {
            headers: withAuth(authToken)
        });

        if (!response.ok) {
            return { files: null, error: explainStatus(response.status) };
        }

        const result = await response.json();
        if (result?.success && Array.isArray(result.files)) {
            return { files: result.files as KvBackupFile[], error: null };
        }
        return { files: [], error: null };
    } catch (e: any) {
        return { files: null, error: `网络错误：${e?.message || '无法连接服务器'}` };
    }
};

// 下载指定备份用于恢复
export const downloadKvBackup = async (authToken: string | null, id: string): Promise<{ data: KvBackupData; error?: undefined } | { data: null; error: string }> => {
    try {
        const response = await fetch(`/api/storage?getConfig=backup&id=${encodeURIComponent(id)}`, {
            headers: withAuth(authToken)
        });

        if (!response.ok) {
            return { data: null, error: explainStatus(response.status) };
        }

        let result: any;
        try {
            result = await response.json();
        } catch (e) {
            return { data: null, error: '备份数据不是有效的 JSON。' };
        }

        if (result && Array.isArray(result.links) && Array.isArray(result.categories)) {
            const links = (result.links as LinkItem[]).filter(l => l && typeof l === 'object' && typeof l.id === 'string' && typeof l.url === 'string' && typeof l.categoryId === 'string');
            const categories = (result.categories as Category[]).filter(c => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string');
            return { data: { links, categories, searchConfig: result.searchConfig, aiConfig: result.aiConfig } };
        }
        return { data: null, error: '备份文件结构不完整（缺少 links 或 categories）。' };
    } catch (e: any) {
        return { data: null, error: `网络错误：${e?.message || '无法连接服务器'}` };
    }
};

// 删除指定备份
export const deleteKvBackup = async (authToken: string | null, id: string): Promise<string | null> => {
    try {
        const response = await fetch('/api/storage', {
            method: 'POST',
            headers: withAuth(authToken),
            body: JSON.stringify({ deleteBackup: id })
        });

        if (!response.ok) {
            return explainStatus(response.status);
        }

        const result = await response.json();
        return result?.success === true ? null : '删除失败，返回数据异常。';
    } catch (e: any) {
        return `网络错误：${e?.message || '无法连接服务器'}`;
    }
};
