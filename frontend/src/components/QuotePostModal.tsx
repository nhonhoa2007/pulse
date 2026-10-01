import React, { useState, useRef, useEffect } from 'react';
import { PostDto, ReplyPrivacy } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { VerifiedBadge } from './VerifiedBadge';
import { ReplyPrivacySelector } from './ReplyPrivacySelector';
import { formatRelativeTime } from '../utils/formatters';
import { X, Image as ImageIcon, Loader2 } from 'lucide-react';

interface QuotePostModalProps {
  post: PostDto | null;
  isOpen: boolean;
  onClose: () => void;
  onPostCreated?: (post: PostDto) => void;
}

export const QuotePostModal: React.FC<QuotePostModalProps> = ({
  post,
  isOpen,
  onClose,
  onPostCreated,
}) => {
  const { currentUser, addToast } = usePulse();
  const [content, setContent] = useState('');
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [replyPrivacy, setReplyPrivacy] = useState<ReplyPrivacy>('EVERYONE');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_CHARS = 280;
  const remainingChars = MAX_CHARS - content.length;
  const isOverLimit = remainingChars < 0;

  useEffect(() => {
    if (isOpen) {
      setContent('');
      setMediaUrls([]);
      setReplyPrivacy('EVERYONE');
      setIsSubmitting(false);
      setIsUploading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !post) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = 4 - mediaUrls.length;
    if (remainingSlots <= 0) {
      addToast('Chỉ được đính kèm tối đa 4 hình ảnh', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      addToast(`Chỉ được tải lên tối đa 4 hình ảnh (đã lấy ${remainingSlots} ảnh đầu)`, 'info');
    }

    setIsUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) {
          addToast(`Tệp ${file.name} không phải là hình ảnh hợp lệ`, 'error');
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          addToast(`Tệp ${file.name} vượt quá dung lượng 5MB cho phép`, 'error');
          continue;
        }
        const url = await api.uploadMedia(file);
        uploaded.push(url);
      }

      if (uploaded.length > 0) {
        setMediaUrls((prev) => [...prev, ...uploaded].slice(0, 4));
        addToast(`Đã tải lên ${uploaded.length} hình ảnh`, 'success');
      }
    } catch (err: any) {
      addToast(err.message || 'Tải ảnh lên thất bại', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveMedia = (index: number) => {
    setMediaUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (isOverLimit || isSubmitting || isUploading) return;

    setIsSubmitting(true);
    try {
      const createdPost = await api.createPost({
        content: content.trim(),
        quoteOfId: post.id,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        replyPrivacy,
        reply_privacy: replyPrivacy,
      });

      addToast('Đã trích dẫn bài viết', 'success');
      setContent('');
      setMediaUrls([]);
      onClose();
      if (onPostCreated) {
        onPostCreated(createdPost);
      }
    } catch (err: any) {
      addToast(err.message || 'Không thể trích dẫn bài viết', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 md:pt-20 px-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl bg-paper border border-cloud rounded-[18px] shadow-2xl overflow-hidden animate-scale-up">
        {/* Modal Header (~53px tall, Paper White, centered title 15px/600 #000000) */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-cloud bg-paper">
          <div className="w-8" />
          <span className="text-[15px] font-semibold text-ink">
            Trích dẫn bài viết
          </span>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center text-ash hover:text-ink rounded-full hover:bg-mist transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4">
          <div className="flex gap-3">
            {/* Current user avatar (40px circular, no border) */}
            <img
              src={
                currentUser.avatarUrl ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
              }
              alt={currentUser.displayName}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />

            <div className="flex-1 min-w-0">
              {/* User identification */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[15px] font-semibold text-ink">
                  {currentUser.displayName}
                </span>
                {currentUser.isCelebrity && (
                  <VerifiedBadge size={12} title="Celebrity VIP" />
                )}
                <span className="text-[13px] text-graphite">
                  @{currentUser.username}
                </span>
              </div>

              {/* Textarea for new thoughts */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Thêm suy nghĩ của bạn..."
                autoFocus
                rows={3}
                className="w-full bg-transparent text-ink placeholder-ash text-[15px] leading-[1.4] resize-none focus:outline-none focus:ring-0"
              />

              {/* Image Previews if any attached to the quote */}
              {mediaUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 my-2.5">
                  {mediaUrls.map((url, idx) => (
                    <div
                      key={idx}
                      className="relative rounded-[8px] overflow-hidden border border-cloud w-24 h-24 bg-mist"
                    >
                      <img
                        src={url}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveMedia(idx)}
                        className="absolute top-1 right-1 p-1 bg-ink/75 hover:bg-ink text-white rounded-full transition-colors"
                        title="Xóa ảnh"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Embedded Quoted Post Preview Card (1px #d5d5d5 border, 8px radius, padding 12px) */}
              <div className="mt-2 mb-3 p-3 rounded-[8px] border border-cloud bg-paper text-[13px]">
                <div className="flex items-center gap-2 mb-1.5">
                  <img
                    src={
                      post.author.avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.username}`
                    }
                    alt={post.author.displayName}
                    className="w-5 h-5 rounded-full object-cover shrink-0"
                  />
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="font-semibold text-ink text-[13px]">
                      {post.author.displayName}
                    </span>
                    {post.author.isCelebrity && (
                      <VerifiedBadge size={11} title="VIP" />
                    )}
                    <span className="text-graphite text-[12px]">
                      @{post.author.username}
                    </span>
                    <span className="text-ash text-[12px]">•</span>
                    <span className="text-graphite text-[12px]">
                      {formatRelativeTime(post.createdAt)}
                    </span>
                  </div>
                </div>

                <p className="text-[14px] leading-[1.4] text-ink line-clamp-3 mb-1.5 font-normal">
                  {post.content}
                </p>

                {post.mediaUrls && post.mediaUrls.length > 0 && (
                  <div className="flex gap-1.5 mt-2 overflow-hidden rounded-[6px]">
                    {post.mediaUrls.slice(0, 3).map((mUrl, mIdx) => (
                      <img
                        key={mIdx}
                        src={mUrl}
                        alt="Quoted media"
                        className="w-16 h-16 object-cover rounded-[6px] border border-cloud bg-mist"
                      />
                    ))}
                    {post.mediaUrls.length > 3 && (
                      <div className="w-16 h-16 rounded-[6px] bg-mist border border-cloud flex items-center justify-center text-[12px] font-semibold text-graphite">
                        +{post.mediaUrls.length - 3}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Reply Privacy Selector */}
              <div className="pt-2 pb-1">
                <ReplyPrivacySelector
                  value={replyPrivacy}
                  onChange={setReplyPrivacy}
                  disabled={isSubmitting}
                />
              </div>

              {/* Bottom Actions Row */}
              <div className="flex items-center justify-between pt-2 border-t border-cloud/60 mt-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (mediaUrls.length >= 4) {
                        addToast('Chỉ được đính kèm tối đa 4 hình ảnh', 'error');
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    disabled={mediaUrls.length >= 4 || isUploading || isSubmitting}
                    className="p-1.5 rounded-full text-ash hover:text-ink hover:bg-mist transition-colors focus:outline-none disabled:opacity-40"
                    title={
                      mediaUrls.length >= 4
                        ? 'Đã đạt giới hạn 4 ảnh'
                        : 'Thêm ảnh (tối đa 4)'
                    }
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-ink" />
                    ) : (
                      <ImageIcon className="w-5 h-5" />
                    )}
                  </button>
                  {mediaUrls.length > 0 && (
                    <span className="text-[12px] text-graphite">
                      {mediaUrls.length}/4 ảnh
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* Character Counter (13px/400 Graphite #424242) */}
                  <span
                    className={`text-[13px] tabular-nums font-normal ${
                      isOverLimit ? 'text-ink font-bold' : 'text-graphite'
                    }`}
                  >
                    {remainingChars}
                  </span>

                  {/* Submit button: Pill shape (rounded-full, #000000 fill, #fafafa text) */}
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isOverLimit || isSubmitting || isUploading}
                    className={`px-5 py-2 rounded-full text-[15px] font-semibold transition-all duration-150 ${
                      !isOverLimit && !isSubmitting && !isUploading
                        ? 'bg-ink hover:bg-ink/85 text-paper cursor-pointer active:scale-95'
                        : 'bg-ink/20 text-paper/60 cursor-not-allowed'
                    }`}
                  >
                    {isSubmitting ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-paper/40 border-t-paper rounded-full animate-spin" />
                        <span>Đang đăng...</span>
                      </div>
                    ) : (
                      <span>Đăng trích dẫn</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
