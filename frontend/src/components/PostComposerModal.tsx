import React from 'react';
import { usePulseUi } from '../context/PulseContexts';
import { PostComposerCard } from './PostComposerCard';
import { X } from 'lucide-react';
import { useAccessibleDialog } from '../utils/useAccessibleDialog';

export const PostComposerModal: React.FC = () => {
  const { isComposerOpen, setIsComposerOpen, navigateTo } = usePulseUi();
  const dialogRef = useAccessibleDialog(isComposerOpen, () => setIsComposerOpen(false));

  if (!isComposerOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 md:pt-20 px-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setIsComposerOpen(false);
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-dialog-title"
        className="w-full max-w-xl bg-paper border border-cloud rounded-[18px] shadow-2xl overflow-hidden animate-scale-up"
      >
        {/* Modal Header (~53px tall, Paper White, centered title 15px/600 #000000) */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-cloud bg-paper">
          <div className="w-8" />
          <span id="composer-dialog-title" className="text-[15px] font-semibold text-ink">
            Bài viết mới
          </span>
          <button
            onClick={() => setIsComposerOpen(false)}
            className="w-8 h-8 flex items-center justify-center text-ash hover:text-ink rounded-full hover:bg-mist transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Composer Body */}
        <div>
          <PostComposerCard
            // The dialog effect captures the opener before moving focus. Native
            // autoFocus would run during commit and make the textarea look like
            // the opener, preventing focus restoration when the dialog closes.
            autoFocus={false}
            onPostCreated={() => {
              setIsComposerOpen(false);
              navigateTo('home');
            }}
          />
        </div>
      </div>
    </div>
  );
};
