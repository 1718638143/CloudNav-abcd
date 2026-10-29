import React, { useState } from 'react';
import { X, Trash2, AlertCircle } from 'lucide-react';
import { Category } from '../types';

interface CategoryDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryName: string;
  categories: Category[];
  categoryId: string;
  onConfirm: (mode: 'migrate' | 'delete_all', targetCategoryId?: string) => void;
}

const CategoryDeleteModal: React.FC<CategoryDeleteModalProps> = ({
  isOpen,
  onClose,
  categoryName,
  categories,
  categoryId,
  onConfirm,
}) => {
  const [mode, setMode] = useState<'migrate' | 'delete_all'>('migrate');

  // 过滤掉当前要删除的分类及其子分类（如果是父分类的话）
  const availableCategories = categories.filter(c => {
    if (c.id === categoryId) return false;
    // 如果是父分类，不能迁移到自己的子分类
    if (categories.find(parent => parent.id === categoryId && !parent.parentId)) {
        if (c.parentId === categoryId) return false;
    }
    return true;
  });

  const [targetCategoryId, setTargetCategoryId] = useState<string>(() => {
    if (availableCategories.some(c => c.id === 'common')) return 'common';
    return availableCategories[0]?.id || '';
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-start p-6">
          <div className="flex gap-4">
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-500">
              <Trash2 size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">删除分类</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="px-6 py-2 space-y-4">
          {/* Option 1: Migrate */}
          <div 
            onClick={() => setMode('migrate')}
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
              mode === 'migrate' 
                ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20' 
                : 'border-slate-100 dark:border-slate-700 hover:border-slate-200 dark:hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                mode === 'migrate' ? 'border-blue-500' : 'border-slate-300 dark:border-slate-600'
              }`}>
                {mode === 'migrate' && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
              </div>
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">迁移当前分类下的网站后删除</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">当前分类下的网站会移动到目标分类</div>
              </div>
            </div>
          </div>

          {/* Target Category Selector */}
          {mode === 'migrate' && (
            <div className="px-2">
              <select
                value={targetCategoryId}
                onChange={(e) => setTargetCategoryId(e.target.value)}
                className="w-full p-2.5 rounded-xl border-2 border-slate-900 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {/* 常用推荐始终作为第一项 */}
                {availableCategories.find(c => c.id === 'common') && (
                    <option value="common">常用推荐</option>
                )}
                {/* 其他一级分类 */}
                {availableCategories.filter(c => !c.parentId && c.id !== 'common').map(parent => (
                    <React.Fragment key={parent.id}>
                        <option value={parent.id}>{parent.name}</option>
                        {availableCategories.filter(c => c.parentId === parent.id).map(sub => (
                            <option key={sub.id} value={sub.id}>{parent.name} / {sub.name}</option>
                        ))}
                    </React.Fragment>
                ))}
              </select>
            </div>
          )}

          {/* Option 2: Delete All */}
          <div 
            onClick={() => setMode('delete_all')}
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
              mode === 'delete_all' 
                ? 'border-red-500 bg-red-50/50 dark:bg-red-900/20' 
                : 'border-slate-100 dark:border-slate-700 hover:border-slate-200 dark:hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                mode === 'delete_all' ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
              }`}>
                {mode === 'delete_all' && <div className="w-2.5 h-2.5 rounded-full bg-red-500" />}
              </div>
              <div>
                <div className="font-semibold text-red-500">连同分类一起删除</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">分类下的网站会一起删除</div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 flex justify-end gap-3 mt-2">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(mode, targetCategoryId)}
            // 迁移模式下必须有可用目标分类（可用分类为空时迁入空串会让链接无归属）
            disabled={mode === 'migrate' && !targetCategoryId}
            className={`px-6 py-2.5 rounded-xl text-white font-medium transition-all shadow-lg ${
              mode === 'delete_all' 
                ? 'bg-red-600 hover:bg-red-700 shadow-red-500/30' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {mode === 'migrate' && !targetCategoryId ? '无可用目标分类' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CategoryDeleteModal;
