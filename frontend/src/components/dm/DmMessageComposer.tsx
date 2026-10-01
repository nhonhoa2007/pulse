import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Ban } from 'lucide-react';

interface DmMessageComposerProps {
  conversationId: string;
  isBlocked?: boolean;
  onSendMessage: (content: string) => Promise<void>;
  isSending?: boolean;
}

export const DmMessageComposer: React.FC<DmMessageComposerProps> = ({
  conversationId,
  isBlocked = false,
  onSendMessage,
  isSending = false,
}) => {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when conversation changes
  useEffect(() => {
    setContent('');
    if (!isBlocked) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [conversationId, isBlocked]);

  // Auto-resize textarea height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 140);
      textarea.style.height = `${Math.max(40, newHeight)}px`;
    }
  }, [content]);

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || isSending || isBlocked) return;

    try {
      setContent('');
      if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
      }
      await onSendMessage(trimmed);
      textareaRef.current?.focus();
    } catch {
      // Restore content on send failure so user doesn't lose text
      setContent(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isBlocked) {
    return (
      <div className="p-4 bg-[#efefef]/60 border-t border-[#d5d5d5] flex items-center justify-center gap-2 text-[13px] text-[#424242]">
        <Ban className="w-4 h-4 text-red-500 shrink-0" />
        <span>Bạn không thể gửi tin nhắn vì cuộc trò chuyện này đã bị chặn.</span>
      </div>
    );
  }

  const isOverLimit = content.length > 5000;
  const canSend = content.trim().length > 0 && !isSending && !isOverLimit;

  return (
    <div className="p-3 bg-[#fafafa] border-t border-[#d5d5d5]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-end gap-2 bg-[#efefef] rounded-[20px] p-1.5 pl-3 border border-transparent focus-within:border-[#385898]/40 focus-within:bg-[#fafafa] transition-all shadow-inner"
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nhập tin nhắn... (Enter để gửi, Shift+Enter xuống dòng)"
          disabled={isSending}
          rows={1}
          maxLength={5000}
          className="flex-1 bg-transparent text-[14.5px] text-[#000000] placeholder-[#969696] resize-none focus:outline-none py-1.5 max-h-[140px] leading-relaxed select-text"
        />

        {/* Character warning if near limit */}
        {content.length > 4500 && (
          <span
            className={`text-[11px] font-medium px-1 mb-2 ${
              isOverLimit ? 'text-red-500 font-bold' : 'text-[#969696]'
            }`}
          >
            {5000 - content.length}
          </span>
        )}

        <button
          type="submit"
          disabled={!canSend}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all ${
            canSend
              ? 'bg-[#000000] text-[#fafafa] hover:scale-105 active:scale-95 shadow-sm cursor-pointer'
              : 'bg-[#d5d5d5] text-[#969696] cursor-not-allowed opacity-60'
          }`}
          title="Gửi tin nhắn (Enter)"
          aria-label="Gửi tin nhắn"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4 stroke-[2.2] translate-x-px" />
          )}
        </button>
      </form>
    </div>
  );
};
