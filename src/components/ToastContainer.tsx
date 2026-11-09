import React from 'react';
import { useAuth } from '../context/AuthContext';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useAuth();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-xl border transition-all duration-300 transform translate-y-0 ${
              isSuccess
                ? 'bg-slate-900 text-white border-emerald-500/30 ring-1 ring-emerald-500/20'
                : isError
                ? 'bg-slate-900 text-white border-rose-500/30 ring-1 ring-rose-500/20'
                : 'bg-slate-900 text-white border-amber-500/30 ring-1 ring-amber-500/20'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {isError && <AlertCircle className="w-5 h-5 text-rose-400" />}
              {!isSuccess && !isError && <Info className="w-5 h-5 text-amber-400" />}
            </div>

            <div className="flex-1 min-w-0">
              {toast.title && (
                <h4 className="text-sm font-semibold text-slate-100 mb-0.5">
                  {toast.title}
                </h4>
              )}
              <p className="text-xs text-slate-300 leading-relaxed break-words">
                {toast.message}
              </p>
            </div>

            <button
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 text-slate-400 hover:text-white transition-colors p-1 -mr-1 -mt-1 rounded-lg"
              aria-label="Tutup notifikasi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
