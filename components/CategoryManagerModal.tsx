import React, { useEffect, useRef, useState } from 'react';
import { X, ArrowUp, ArrowDown, Trash2, Edit2, Plus, Check, Lock, Unlock, Palette } from 'lucide-react';
import { Category } from '../types';
import Icon from './Icon';
import IconSelector from './IconSelector';
import CategoryActionAuthModal from './CategoryActionAuthModal';
import CategoryDeleteModal from './CategoryDeleteModal';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onUpdateCategories: (newCategories: Category[]) => void;
  onDeleteCategory: (id: string, mode: 'migrate' | 'delete_all', targetId?: string) => void;
  onVerifyPassword?: (password: string) => Promise<boolean>;
}

const CATEGORY_MANAGER_UNLOCK_DURATION_MS = 10 * 60 * 1000;

const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({ 
  isOpen, 
  onClose, 
  categories, 
  onUpdateCategories,
  onDeleteCategory,
  onVerifyPassword
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editParentId, setEditParentId] = useState<string | undefined>(undefined);
  
  const [newCatName, setNewCatName] = useState('');
  const [newCatPassword, setNewCatPassword] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('Folder');
  const [newCatParentId, setNewCatParentId] = useState<string | undefined>(undefined);
  
  const [isIconSelectorOpen, setIsIconSelectorOpen] = useState(false);
  const [iconSelectorTarget, setIconSelectorTarget] = useState<'edit' | 'new' | null>(null);
  
  // 分类操作验证相关状态
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: 'edit' | 'delete';
    categoryId: string;
    categoryName: string;
  } | null>(null);

  // 临时授权仅保存在当前组件内存中，不保存密码或写入任何浏览器存储。
  const [isTemporarilyUnlocked, setIsTemporarilyUnlocked] = useState(false);
  const unlockExpiresAtRef = useRef(0);
  const unlockTimerRef = useRef<number | null>(null);

  // 删除确认弹窗状态
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const lockCategoryManager = () => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
    unlockExpiresAtRef.current = 0;
    setIsTemporarilyUnlocked(false);
  };

  const refreshTemporaryUnlock = () => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
    }

    unlockExpiresAtRef.current = Date.now() + CATEGORY_MANAGER_UNLOCK_DURATION_MS;
    unlockTimerRef.current = window.setTimeout(
      lockCategoryManager,
      CATEGORY_MANAGER_UNLOCK_DURATION_MS
    );
    setIsTemporarilyUnlocked(true);
  };

  const hasActiveTemporaryUnlock = () => {
    if (!isTemporarilyUnlocked || Date.now() >= unlockExpiresAtRef.current) {
      if (isTemporarilyUnlocked) {
        lockCategoryManager();
      }
      return false;
    }

    refreshTemporaryUnlock();
    return true;
  };

  useEffect(() => {
    return () => {
      if (unlockTimerRef.current !== null) {
        window.clearTimeout(unlockTimerRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    lockCategoryManager();
    setPendingAction(null);
    setIsAuthModalOpen(false);
    onClose();
  };

  if (!isOpen) return null;

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const cat = categories[index];
    const newCats = [...categories];

    if (cat.parentId) {
      // 二级分类：只能在其父分类下的二级分类中移动
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex >= 0 && targetIndex < newCats.length && newCats[targetIndex].parentId === cat.parentId) {
        [newCats[index], newCats[targetIndex]] = [newCats[targetIndex], newCats[index]];
      }
    } else {
      // 一级分类：带着其下的二级分类一起整体移动
      const getBlock = (list: Category[], idx: number) => {
        const p = list[idx];
        const block = [p];
        let i = idx + 1;
        while (i < list.length && list[i].parentId === p.id) {
          block.push(list[i]);
          i++;
        }
        return block;
      };

      const currentBlock = getBlock(categories, index);
      if (direction === 'up') {
        let prevParentIdx = -1;
        for (let i = index - 1; i >= 0; i--) {
          if (!categories[i].parentId) {
            prevParentIdx = i;
            break;
          }
        }
        if (prevParentIdx !== -1) {
          const prevBlock = getBlock(categories, prevParentIdx);
          newCats.splice(prevParentIdx, prevBlock.length + currentBlock.length, ...currentBlock, ...prevBlock);
        }
      } else {
        let nextParentIdx = -1;
        for (let i = index + currentBlock.length; i < categories.length; i++) {
          if (!categories[i].parentId) {
            nextParentIdx = i;
            break;
          }
        }
        if (nextParentIdx !== -1) {
          const nextBlock = getBlock(categories, nextParentIdx);
          newCats.splice(index, currentBlock.length + nextBlock.length, ...nextBlock, ...currentBlock);
        }
      }
    }
    onUpdateCategories(newCats);
  };

  // 辅助函数：检查是否可以移动
  const canMoveUp = (index: number) => {
    const cat = categories[index];
    if (index === 0) return false;
    if (cat.parentId) {
      return categories[index - 1].parentId === cat.parentId;
    }
    // 一级分类只要上方还有一级分类就可以上移
    return categories.slice(0, index).some(c => !c.parentId);
  };

  const canMoveDown = (index: number) => {
    const cat = categories[index];
    if (index === categories.length - 1) return false;
    if (cat.parentId) {
      return categories[index + 1].parentId === cat.parentId;
    }
    // 一级分类只要下方还有一级分类就可以下移
    const currentBlockSize = categories.slice(index + 1).findIndex(c => !c.parentId);
    if (currentBlockSize === -1) return false; // 下方没有别的一级分类了
    return true;
  };

  // 处理密码验证
  const handlePasswordVerification = async (password: string): Promise<boolean> => {
    if (!onVerifyPassword) return true; // 如果没有提供验证函数，默认通过
    
    try {
      const isValid = await onVerifyPassword(password);
      return isValid;
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  };

  // 处理编辑分类前的验证
  const handleStartEdit = (cat: Category) => {
    if (!onVerifyPassword || hasActiveTemporaryUnlock()) {
      startEdit(cat);
      return;
    }

    // 设置待处理的操作
    setPendingAction({
      type: 'edit',
      categoryId: cat.id,
      categoryName: cat.name
    });
    
    // 打开验证弹窗
    setIsAuthModalOpen(true);
  };

  // 处理删除分类前的验证
  const handleDeleteClick = (cat: Category) => {
    if (!onVerifyPassword || hasActiveTemporaryUnlock()) {
      setDeletingCategory(cat);
      setIsDeleteModalOpen(true);
      return;
    }

    // 设置待处理的操作
    setPendingAction({
      type: 'delete',
      categoryId: cat.id,
      categoryName: cat.name
    });
    
    // 打开验证弹窗
    setIsAuthModalOpen(true);
  };

  // 处理验证成功后的操作
  const handleAuthSuccess = () => {
    if (!pendingAction) return;

    refreshTemporaryUnlock();
    setIsAuthModalOpen(false);

    if (pendingAction.type === 'edit') {
      const cat = categories.find(c => c.id === pendingAction.categoryId);
      if (cat) {
        startEdit(cat);
      }
    } else if (pendingAction.type === 'delete') {
      const cat = categories.find(c => c.id === pendingAction.categoryId);
      if (cat) {
        setDeletingCategory(cat);
        setIsDeleteModalOpen(true);
      }
    }

    // 清除待处理的操作
    setPendingAction(null);
  };

  const handleConfirmDelete = (mode: 'migrate' | 'delete_all', targetCategoryId?: string) => {
    if (deletingCategory) {
      onDeleteCategory(deletingCategory.id, mode, targetCategoryId);
      setIsDeleteModalOpen(false);
      setDeletingCategory(null);
    }
  };

  // 处理验证弹窗关闭
  const handleAuthModalClose = () => {
    setIsAuthModalOpen(false);
    setPendingAction(null);
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditPassword(cat.password || '');
    setEditIcon(cat.icon);
    setEditParentId(cat.parentId);
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    
    const oldCat = categories.find(c => c.id === editingId);
    const parentChanged = oldCat?.parentId !== editParentId;
    
    let updatedCats = categories.map(c => c.id === editingId ? { 
        ...c, 
        name: editName.trim(),
        icon: editIcon,
        password: editPassword.trim() || undefined,
        parentId: editParentId
    } : c);

    if (parentChanged) {
      // 如果归属改变了，重新排列数组以保持父子关系连贯
      const catToMove = updatedCats.find(c => c.id === editingId)!;
      // 移除旧位置
      let filtered = updatedCats.filter(c => c.id !== editingId);
      
      if (editParentId) {
        // 插入到新父分类及其子分类之后
        const parentIdx = filtered.findIndex(c => c.id === editParentId);
        if (parentIdx !== -1) {
          let insertIdx = parentIdx + 1;
          while (insertIdx < filtered.length && filtered[insertIdx].parentId === editParentId) {
            insertIdx++;
          }
          filtered.splice(insertIdx, 0, catToMove);
          updatedCats = filtered;
        }
      } else {
        // 变为一级分类，移到末尾
        filtered.push(catToMove);
        updatedCats = filtered;
      }
    }

    onUpdateCategories(updatedCats);
    setEditingId(null);
  };

  const handleAdd = () => {
    if (!newCatName.trim()) return;
    const newCat: Category = {
      id: Date.now().toString(),
      name: newCatName.trim(),
      icon: newCatIcon,
      password: newCatPassword.trim() || undefined,
      parentId: newCatParentId
    };

    let newCats;
    if (newCatParentId) {
      // 插入到父分类及其所有子分类之后，而不是数组末尾
      const parentIdx = categories.findIndex(c => c.id === newCatParentId);
      if (parentIdx !== -1) {
        let insertIdx = parentIdx + 1;
        while (insertIdx < categories.length && categories[insertIdx].parentId === newCatParentId) {
          insertIdx++;
        }
        newCats = [...categories];
        newCats.splice(insertIdx, 0, newCat);
      } else {
        newCats = [...categories, newCat];
      }
    } else {
      newCats = [...categories, newCat];
    }

    onUpdateCategories(newCats);
    setNewCatName('');
    setNewCatPassword('');
    setNewCatIcon('Folder');
    setNewCatParentId(undefined);
  };

  const openIconSelector = (target: 'edit' | 'new') => {
    setIconSelectorTarget(target);
    setIsIconSelectorOpen(true);
  };
  
  const handleIconSelect = (iconName: string) => {
    if (iconSelectorTarget === 'edit') {
      setEditIcon(iconName);
    } else if (iconSelectorTarget === 'new') {
      setNewCatIcon(iconName);
    }
  };
  
  const cancelIconSelector = () => {
    setIsIconSelectorOpen(false);
    setIconSelectorTarget(null);
  };
  
  const cancelAdd = () => {
    setNewCatName('');
    setNewCatPassword('');
    setNewCatIcon('Folder');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[85vh]">
        <div className="flex justify-between items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold dark:text-white">分类管理</h3>
            {isTemporarilyUnlocked && (
              <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400" title="连续操作会刷新有效期；关闭弹窗或闲置 10 分钟后自动锁定">
                已临时解锁，闲置 10 分钟后自动锁定
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isTemporarilyUnlocked && (
              <button
                type="button"
                onClick={lockCategoryManager}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                title="立即清除本次分类管理临时授权"
              >
                <Lock size={14} />
                立即锁定
              </button>
            )}
            <button onClick={handleClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
              <X className="w-5 h-5 dark:text-slate-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {categories.map((cat, index) => (
            <div 
              key={cat.id} 
              className={`flex flex-col p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg group gap-2 transition-all ${
                cat.parentId ? 'ml-8 border-l-2 border-blue-200 dark:border-blue-900/50' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                  {/* Order Controls */}
                  <div className="flex flex-col gap-1 mr-2">
                    <button 
                      onClick={() => handleMove(index, 'up')}
                      disabled={!canMoveUp(index)}
                      className="p-0.5 text-slate-400 hover:text-blue-500 disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button 
                      onClick={() => handleMove(index, 'down')}
                      disabled={!canMoveDown(index)}
                      className="p-0.5 text-slate-400 hover:text-blue-500 disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {editingId === cat.id ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Icon name={editIcon} size={16} />
                          <input 
                            type="text" 
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none"
                            placeholder="分类名称"
                            autoFocus
                          />
                          <button
                            type="button"
                            className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                            onClick={() => openIconSelector('edit')}
                            title="选择图标"
                          >
                            <Palette size={16} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Lock size={14} className="text-slate-400" />
                          <input 
                            type="password" 
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            className="flex-1 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none"
                            placeholder="密码（可选）"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">所属一级分类:</span>
                          <select
                            value={editParentId || ''}
                            onChange={(e) => setEditParentId(e.target.value || undefined)}
                            className="flex-1 p-1.5 text-xs rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none"
                          >
                            <option value="">(无 - 作为一级分类)</option>
                            {categories
                              .filter(c => !c.parentId && c.id !== editingId)
                              .map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))
                            }
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Icon name={cat.icon} size={16} />
                        <span className="font-medium dark:text-slate-200 truncate">
                          {cat.parentId && (
                            <span className="text-[10px] bg-slate-200 dark:bg-slate-600 px-1 rounded mr-1 text-slate-500 dark:text-slate-400">
                              {categories.find(c => c.id === cat.parentId)?.name} &gt;
                            </span>
                          )}
                          {cat.name}
                        </span>
                        {cat.password && (
                          <Lock size={12} className="text-slate-400" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 self-start mt-1">
                    {editingId === cat.id ? (
                       <button onClick={saveEdit} className="text-green-500 hover:bg-green-50 dark:hover:bg-slate-600 p-1.5 rounded bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-600"><Check size={16}/></button>
                    ) : (
                       <>
                        <button onClick={() => handleStartEdit(cat)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-200 dark:hover:bg-slate-600 rounded">
                            <Edit2 size={14} />
                        </button>
                        <button 
                        onClick={() => handleDeleteClick(cat)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
                        >
                        <Trash2 size={14} />
                        </button>
                       </>
                    )}
                  </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
           <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">添加新分类</label>
           <div className="flex flex-col gap-2">
             <div className="flex items-center gap-2">
               <Icon name={newCatIcon} size={16} />
               <input 
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="分类名称"
                  className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
               />
               <button
                 type="button"
                 className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                 onClick={() => openIconSelector('new')}
                 title="选择图标"
               >
                 <Palette size={16} />
               </button>
             </div>
             <div className="flex gap-2">
                 <div className="flex-1 relative">
                    <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text"
                        value={newCatPassword}
                        onChange={(e) => setNewCatPassword(e.target.value)}
                        placeholder="密码 (可选)"
                        className="w-full pl-8 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    />
                 </div>
                 <div className="flex-1">
                    <select
                      value={newCatParentId || ''}
                      onChange={(e) => setNewCatParentId(e.target.value || undefined)}
                      className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">(无 - 作为一级分类)</option>
                      {categories.filter(c => !c.parentId).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                 </div>
                 <button 
                    onClick={handleAdd}
                    disabled={!newCatName.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors flex items-center"
                 >
                   <Plus size={18} />
                 </button>
             </div>
           </div>
          
          {/* 图标选择器弹窗 */}
          {isIconSelectorOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">选择图标</h3>
                  <button
                    type="button"
                    onClick={cancelIconSelector}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <IconSelector 
                    onSelectIcon={(iconName) => {
                      handleIconSelect(iconName);
                      setIsIconSelectorOpen(false);
                      setIconSelectorTarget(null);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* 分类操作密码验证弹窗 */}
          {isAuthModalOpen && pendingAction && (
            <CategoryActionAuthModal
              isOpen={isAuthModalOpen}
              onClose={handleAuthModalClose}
              onVerify={handlePasswordVerification}
              onVerified={handleAuthSuccess}
              actionType={pendingAction.type}
              categoryName={pendingAction.categoryName}
            />
          )}

          {/* 删除确认弹窗 */}
          {isDeleteModalOpen && deletingCategory && (
            <CategoryDeleteModal
              isOpen={isDeleteModalOpen}
              onClose={() => { setIsDeleteModalOpen(false); setDeletingCategory(null); }}
              categoryName={deletingCategory.name}
              categories={categories}
              categoryId={deletingCategory.id}
              onConfirm={handleConfirmDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryManagerModal;