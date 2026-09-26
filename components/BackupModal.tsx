import React, { useState, useEffect } from 'react';
import { X, Cloud, Download, Upload, CheckCircle2, AlertCircle, RefreshCw, Loader2, Trash2 } from 'lucide-react';
import { Category, LinkItem, SearchConfig, AIConfig } from '../types';
import { saveKvBackup, listKvBackups, downloadKvBackup, deleteKvBackup, KvBackupFile } from '../services/kvBackupService';
import { generateBookmarkHtml, downloadHtmlFile } from '../services/exportService';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  links: LinkItem[];
  categories: Category[];
  authToken: string | null;
  onRestore: (links: LinkItem[], categories: Category[]) => Promise<boolean> | boolean;
  searchConfig: SearchConfig;
  onRestoreSearchConfig: (searchConfig: SearchConfig) => void;
  aiConfig: AIConfig;
  onRestoreAIConfig: (aiConfig: AIConfig) => void;
}

const BackupModal: React.FC<BackupModalProps> = ({
  isOpen, onClose, links, categories, authToken, onRestore, searchConfig, onRestoreSearchConfig, aiConfig, onRestoreAIConfig
}) => {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'uploading' | 'downloading' | 'success' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [backupFiles, setBackupFiles] = useState<KvBackupFile[]>([]);
  const [isListing, setIsListing] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleList = async () => {
    setIsListing(true);
    const result = await listKvBackups(authToken);
    setBackupFiles(result.files || []);
    if (result.error) setStatusMsg(result.error);
    setIsListing(false);
  };

  useEffect(() => {
    if (isOpen) {
        setSyncStatus('idle');
        setStatusMsg('');
        handleList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleBackupToCloud = async () => {
    if (!authToken) {
        setSyncStatus('error');
        setStatusMsg('请先登录后再使用在线备份。');
        return;
    }
    setSyncStatus('uploading');
    setStatusMsg('正在上传...');
    const result = await saveKvBackup(authToken, { links, categories, searchConfig, aiConfig });
    if (result.success === false) {
        setSyncStatus('error');
        setStatusMsg(result.error);
        return;
    }
    setSyncStatus('success');
    setStatusMsg('备份成功！');
    handleList();
  };

  const handleRestoreFromCloud = async (file: KvBackupFile) => {
    if (!authToken) {
        setSyncStatus('error');
        setStatusMsg('请先登录后再恢复备份。');
        return;
    }
    const timeStr = new Date(file.createdAt).toLocaleString('zh-CN');
    if (!confirm(`确定要恢复 ${timeStr} 的备份吗？这将覆盖当前的本地数据。`)) return;

    setSyncStatus('downloading');
    setStatusMsg('正在下载并恢复...');
    setRestoringId(file.id);
    const result = await downloadKvBackup(authToken, file.id);

    if (result.data) {
        const data = result.data;
        const ok = await onRestore(data.links, data.categories);
        if (ok === false) {
            setSyncStatus('error');
            setStatusMsg('恢复未写入 KV，请重新登录后再试');
            setRestoringId(null);
            return;
        }
        if (data.searchConfig) onRestoreSearchConfig(data.searchConfig);
        if (data.aiConfig) onRestoreAIConfig(data.aiConfig);
        setSyncStatus('success');
        setStatusMsg('恢复成功！');
    } else {
        setSyncStatus('error');
        setStatusMsg(result.error || '下载失败或数据格式错误。');
    }
    setRestoringId(null);
  };

  const handleDeleteBackup = async (file: KvBackupFile) => {
    if (!authToken) return;
    if (!confirm('确定要删除这份备份吗？删除后不可恢复。')) return;
    setDeletingId(file.id);
    const err = await deleteKvBackup(authToken, file.id);
    if (err) {
        setSyncStatus('error');
        setStatusMsg(err);
    } else {
        handleList();
    }
    setDeletingId(null);
  };

  const handleExportHtml = () => {
    const html = generateBookmarkHtml(links, categories);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadHtmlFile(html, `bookmarks_${dateStr}.html`);
  };

  const handleExportJson = () => {
    const data = { links, categories, searchConfig, aiConfig };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cloudnav_backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2">
            <Cloud className="text-blue-500" /> 备份与恢复
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">

            {/* Section 1: Online Backup (Cloudflare KV) */}
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Cloud size={18} className="text-blue-500" /> 云端备份 (KV 存储)
                    </h4>
                    <button
                        onClick={handleList}
                        disabled={isListing}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={isListing ? 'animate-spin' : ''} /> 刷新
                    </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    备份保存在站点同款 Cloudflare KV 存储中，无需额外配置；需登录后使用，云端保留最近 20 份快照。
                </p>

                <div className="grid grid-cols-1 gap-4">
                    <button
                        onClick={handleBackupToCloud}
                        disabled={syncStatus === 'uploading' || syncStatus === 'downloading'}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        <Upload className="w-8 h-8 text-blue-500 mb-2 group-hover:-translate-y-1 transition-transform" />
                        <span className="text-sm font-medium dark:text-white">立即备份</span>
                        <span className="text-xs text-slate-500 mt-1">保存当前数据为一份新快照</span>
                    </button>
                </div>

                <div className="space-y-2">
                    {isListing && (
                        <div className="text-sm text-slate-500 text-center p-4">正在获取备份列表...</div>
                    )}
                    {!isListing && backupFiles.length === 0 && (
                        <div className="text-sm text-slate-500 text-center p-4 bg-slate-50 dark:bg-slate-700/30 rounded-lg">
                            云端暂无备份，点击上方「立即备份」创建第一份
                        </div>
                    )}
                    {!isListing && backupFiles.map((file, idx) => {
                        const d = file.createdAt ? new Date(file.createdAt) : null;
                        const timeStr = d && !isNaN(d.getTime()) ? d.toLocaleString('zh-CN') : '—';
                        const sizeStr = file.size > 0 ? `${(file.size / 1024).toFixed(1)} KB` : '—';
                        return (
                            <div key={file.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium dark:text-white truncate flex items-center gap-2">
                                        {`备份 ${timeStr}`}
                                        {idx === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 shrink-0">最新</span>}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5">{timeStr} · {sizeStr} · {file.links} 个站点 · {file.categories} 个分类</div>
                                </div>
                                <div className="ml-3 shrink-0 flex items-center gap-2">
                                    <button
                                        onClick={() => handleRestoreFromCloud(file)}
                                        disabled={restoringId !== null || deletingId !== null}
                                        className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50"
                                    >
                                        {restoringId === file.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                        {restoringId === file.id ? '恢复中...' : '恢复'}
                                    </button>
                                    <button
                                        onClick={() => handleDeleteBackup(file)}
                                        disabled={restoringId !== null || deletingId !== null}
                                        className="px-2.5 py-1.5 text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50"
                                    >
                                        {deletingId === file.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {syncStatus !== 'idle' && (
                    <div className={`text-sm text-center p-2 rounded ${
                        syncStatus === 'success' ? 'bg-green-50 text-green-600 dark:bg-green-900/20' :
                        syncStatus === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-900/20' :
                        'bg-blue-50 text-blue-600 dark:bg-blue-900/20'
                    }`}>
                        {statusMsg}
                    </div>
                )}
            </section>

            <hr className="border-slate-200 dark:border-slate-700" />

             {/* Section 2: Local Export */}
             <section className="space-y-4">
                <h4 className="font-medium text-slate-800 dark:text-slate-200">本地导出</h4>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 flex items-center justify-between">
                    <div>
                        <h5 className="text-sm font-medium dark:text-slate-200">导出 HTML 书签文件</h5>
                        <p className="text-xs text-slate-500 mt-1">兼容 Chrome, Edge, Firefox 导入格式，保留目录结构</p>
                    </div>
                    <button
                        onClick={handleExportHtml}
                        className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-blue-500 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <Download size={16} /> 导出 HTML
                    </button>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 flex items-center justify-between">
                    <div>
                        <h5 className="text-sm font-medium dark:text-slate-200">导出 cloudnav_backup.json 文件</h5>
                        <p className="text-xs text-slate-500 mt-1">与在线备份格式一致，便于数据迁移</p>
                    </div>
                    <button
                        onClick={handleExportJson}
                        className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-blue-500 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <Download size={16} /> 导出 JSON
                    </button>
                </div>
             </section>

        </div>
      </div>
    </div>
  );
};

export default BackupModal;
