import React from 'react';
import { usePulse } from '../context/PulseContext';
import { Check, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = usePulse();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none max-w-md w-full px-4 items-center">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-full bg-ink text-paper shadow-xl transition-all duration-300 animate-slide-up text-[13px] font-medium max-w-full"
        >
          <div className="flex items-center gap-2 min-w-0">
            {toast.type === 'success' && (
              <span className="w-4 h-4 rounded-full bg-meta text-white flex items-center justify-center shrink-0">
                <Check className="w-2.5 h-2.5" />
              </span>
            )}
            {toast.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-white shrink-0" />
            )}
            {toast.type === 'info' && (
              <Info className="w-4 h-4 text-ash shrink-0" />
            )}
            <span className="truncate">{toast.message}</span>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-ash hover:text-paper p-0.5 rounded-full transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
