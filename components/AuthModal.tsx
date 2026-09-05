import React, { useState, useEffect } from 'react';
import { X, Lock, ArrowRight, Loader2 } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onLogin: (password: string) => Promise<boolean>;
  onClose?: () => void; // 可选：传入时显示关闭/取消按钮（用于操作触发的验证），整站锁屏不传则不显示
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onLogin, onClose }) => {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setError('');
    setIsLoading(false);
  }, [isOpen]);

  // Esc 关闭（仅当提供 onClose 时）
  useEffect(() => {
    if (!isOpen || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    const success = await onLogin(password);
    if (!success) {
      setError('密码错误或无法连接服务器');
    }
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md" onClick={onClose ? () => onClose() : undefined}>
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-700 p-8" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 dark:text-slate-500 transition-colors"
            title="关闭"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        )}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400">
            <Lock size={32} />
          </div>
          <h2 className="text-xl font-bold dark:text-white">身份验证</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">
            请输入部署时设置的 PASSWORD 以同步数据
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-center tracking-widest"
              placeholder="访问密码"
              autoFocus
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2"
          >
            {isLoading ? <Loader2 className="animate-spin" /> : <>解锁进入 <ArrowRight size={18} /></>}
          </button>
        </form>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-full mt-2 py-2.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
};

export default AuthModal;
