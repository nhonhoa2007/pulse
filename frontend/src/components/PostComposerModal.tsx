import React from 'react';
import { usePulse } from '../context/PulseContext';
import { PostComposerCard } from './PostComposerCard';
import { X } from 'lucide-react';

export const PostComposerModal: React.FC = () => {
  const { isComposerOpen, setIsComposerOpen, navigateTo } = usePulse();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && isComposerOpen) {
        setIsComposerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isComposerOpen, setIsComposerOpen]);

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
      <div className="w-full max-w-xl bg-paper border border-cloud rounded-[18px] shadow-2xl overflow-hidden animate-scale-up">
        {/* Modal Header (~53px tall, Paper White, centered title 15px/600 #000000) */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-cloud bg-paper">
          <div className="w-8" />
          <span className="text-[15px] font-semibold text-ink">
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
            autoFocus={true}
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
