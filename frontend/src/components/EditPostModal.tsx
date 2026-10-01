import React, { useState, useEffect, useRef } from 'react';
import { PostDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { computeEditWindowRemaining } from '../utils/trustSafety';
import { X, Clock, AlertTriangle, ShieldAlert, Loader2 } from 'lucide-react';

export interface EditPostModalProps {
  post: PostDto;
  isOpen: boolean;
  onClose: () => void;
  onPostUpdated: (updatedPost: PostDto) => void;
}

export const EditPostModal: React.FC<EditPostModalProps> = ({
  post,
  isOpen,
  onClose,
  onPostUpdated,
}) => {
  const { addToast } = usePulse();

  const [content, setContent] = useState<string>(post.content || '');
  const [hasContentWarning, setHasContentWarning] = useState<boolean>(
    Boolean(post.contentWarning || post.isSensitive)
  );
  const [contentWarning, setContentWarning] = useState<string>(post.contentWarning || '');
  const [isSensitive, setIsSensitive] = useState<boolean>(Boolean(post.isSensitive));
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync state whenever opened with a post
  useEffect(() => {
    if (isOpen) {
      setContent(post.content || '');
      setHasContentWarning(Boolean(post.contentWarning || post.isSensitive));
      setContentWarning(post.contentWarning || '');
      setIsSensitive(Boolean(post.isSensitive));
      setNowMs(Date.now());
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, post]);

  // 1-second interval to update live countdown timer
  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const editWindow = computeEditWindowRemaining(post.createdAt, nowMs);
  const isExpired = editWindow.isExpired;

  const MAX_CHARS = 280;
  const remainingChars = MAX_CHARS - content.length;
  const isOverLimit = remainingChars < 0;

  const canSubmit =
    !isExpired &&
    !isSubmitting &&
    content.trim().length > 0 &&
    !isOverLimit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      setIsSubmitting(true);
      const payload = {
        content: content.trim(),
        contentWarning: hasContentWarning && contentWarning.trim() ? contentWarning.trim() : undefined,
        isSensitive: hasContentWarning && isSensitive,
      };

      const updated = await api.updatePost(post.id, payload);
      addToast('Đã chỉnh sửa bài viết thành công', 'success');
      onPostUpdated(updated);
      onClose();
    } catch (err: any) {
      console.error('Failed to update post:', err);
      addToast(err.message || 'Không thể chỉnh sửa bài viết', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 md:pt-20 px-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        data-testid="edit-post-modal"
        className="w-full max-w-xl bg-[#fafafa] border border-[#d5d5d5] rounded-[18px] shadow-2xl overflow-hidden animate-scale-up"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-[#d5d5d5] bg-[#fafafa]">
          <span className="text-[15px] font-semibold text-[#000000]">
            Chỉnh sửa bài viết
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center text-[#969696] hover:text-[#000000] rounded-full hover:bg-[#efefef] transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 15-Minute Countdown Status Bar */}
        <div className="px-4 pt-3">
          <div
            data-testid="edit-countdown-banner"
            className={`flex items-center gap-2 p-2.5 rounded-[12px] border text-[13px] transition-colors ${
              isExpired
                ? 'bg-[#fee2e2] border-[#fecaca] text-[#991b1b]'
                : 'bg-[#efefef] border-[#d5d5d5] text-[#424242]'
            }`}
          >
            {isExpired ? (
              <AlertTriangle className="w-4 h-4 shrink-0 text-[#dc2626]" />
            ) : (
              <Clock className="w-4 h-4 shrink-0 text-[#385898]" />
            )}
            <span
              data-testid="edit-countdown-text"
              className="font-medium flex-1 truncate"
            >
              {editWindow.formatted}
            </span>
            {!isExpired && (
              <span className="text-[12px] text-[#71717a] font-mono tabular-nums shrink-0">
                {editWindow.shortFormatted}
              </span>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <textarea
              ref={textareaRef}
              data-testid="edit-post-content-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isExpired || isSubmitting}
              rows={4}
              placeholder="Chỉnh sửa nội dung bài viết..."
              className={`w-full p-3 text-[15px] leading-[1.4] rounded-[12px] border bg-[#fafafa] text-[#000000] focus:outline-none focus:ring-1 focus:ring-[#000000] resize-none transition-colors ${
                isExpired ? 'bg-[#efefef] text-[#71717a] cursor-not-allowed' : 'border-[#d5d5d5]'
              }`}
            />

            <div className="flex items-center justify-between text-[12px] text-[#71717a] px-1 mt-1">
              <span>Cửa sổ 15 phút lưu lại lịch sử chỉnh sửa</span>
              <span className={isOverLimit ? 'text-red-500 font-semibold' : ''}>
                {remainingChars} ký tự còn lại
              </span>
            </div>
          </div>

          {/* Content Warning Options */}
          <div className="p-3 bg-[#efefef]/60 border border-[#d5d5d5] rounded-[12px] space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[13px] font-semibold text-[#000000] cursor-pointer">
                <ShieldAlert className="w-4 h-4 text-[#71717a]" />
                <span>Cảnh báo nội dung (Content Warning)</span>
              </label>
              <input
                type="checkbox"
                data-testid="edit-content-warning-checkbox"
                checked={hasContentWarning}
                disabled={isExpired || isSubmitting}
                onChange={(e) => setHasContentWarning(e.target.checked)}
                className="w-4 h-4 accent-[#000000] rounded cursor-pointer"
              />
            </div>

            {hasContentWarning && (
              <div className="space-y-2.5 pt-1 animate-fade-in">
                <input
                  type="text"
                  data-testid="edit-content-warning-input"
                  value={contentWarning}
                  disabled={isExpired || isSubmitting}
                  onChange={(e) => setContentWarning(e.target.value)}
                  placeholder="Lý do cảnh báo (ví dụ: Tiết lộ cốt truyện, Nhạy cảm...)"
                  className="w-full px-3 py-2 text-[13px] bg-[#fafafa] border border-[#d5d5d5] rounded-[8px] text-[#000000] focus:outline-none focus:border-[#000000]"
                />
                <label className="flex items-center gap-2 text-[12px] text-[#424242] cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="edit-is-sensitive-checkbox"
                    checked={isSensitive}
                    disabled={isExpired || isSubmitting}
                    onChange={(e) => setIsSensitive(e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#000000] rounded"
                  />
                  <span>Đánh dấu toàn bộ bài viết / hình ảnh là nhạy cảm</span>
                </label>
              </div>
            )}
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#d5d5d5]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-[14px] font-semibold text-[#424242] hover:text-[#000000] hover:bg-[#efefef] rounded-full transition-colors focus:outline-none"
            >
              Hủy
            </button>
            <button
              type="submit"
              data-testid="edit-post-submit-button"
              disabled={!canSubmit}
              className={`flex items-center gap-1.5 px-5 py-2 text-[14px] font-semibold rounded-full transition-all focus:outline-none shadow-sm ${
                canSubmit
                  ? 'bg-[#000000] text-[#fafafa] hover:bg-[#000000]/85 cursor-pointer active:scale-95'
                  : 'bg-[#d5d5d5] text-[#969696] cursor-not-allowed'
              }`}
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{isSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
