import React, { useState } from 'react';
import { DmMessageDto } from '../../types/PulseTypes';
import { formatRelativeTime } from '../../utils/formatters';
import { Check, CheckCheck, Trash2, Loader2 } from 'lucide-react';

interface DmMessageBubbleProps {
  message: DmMessageDto;
  isOwn: boolean;
  isReadByOther?: boolean;
  onDelete?: (messageId: string) => Promise<void> | void;
}

export const DmMessageBubble: React.FC<DmMessageBubbleProps> = ({
  message,
  isOwn,
  isReadByOther = false,
  onDelete,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const fullTime = new Date(message.createdAt).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const handleDelete = async () => {
    if (!onDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(message.id);
      setShowConfirmDelete(false);
    } catch {
      // Error handled by parent toast
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className={`group relative flex flex-col mb-3 transition-opacity ${
        isOwn ? 'items-end' : 'items-start'
      }`}
    >
      <div className="flex items-center gap-1.5 max-w-[85%] sm:max-w-[75%]">
        {/* Delete action button for sender (shown on hover/focus on desktop) */}
        {isOwn && !message.isDeleted && onDelete && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center shrink-0">
            {showConfirmDelete ? (
              <div className="flex items-center gap-1 bg-paper border border-cloud rounded-full px-2 py-0.5 shadow-md animate-fade-in text-[11px]">
                <span className="text-graphite">Xóa tin?</span>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="text-red-600 font-bold hover:underline px-1"
                >
                  {isDeleting ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Xóa'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmDelete(false)}
                  className="text-ash hover:text-ink px-1"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirmDelete(true)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-ash hover:text-red-600 hover:bg-mist transition-colors focus:outline-none"
                title="Xóa tin nhắn"
                aria-label="Xóa tin nhắn"
              >
                <Trash2 className="w-3.5 h-3.5 stroke-[1.8]" />
              </button>
            )}
          </div>
        )}

        {/* The Message Bubble */}
        <div
          className={`relative px-4 py-2.5 break-words select-text ${
            message.isDeleted
              ? 'bg-mist/60 border border-dashed border-cloud text-ash italic text-[14px] rounded-[18px]'
              : isOwn
              ? 'bg-ink text-paper rounded-[18px] rounded-br-[4px]'
              : 'bg-mist text-ink rounded-[18px] rounded-bl-[4px]'
          }`}
        >
          {/* Deleted message state */}
          {message.isDeleted ? (
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="text-[13px]">This message was deleted</span>
            </div>
          ) : (
            <>
              {/* Media images if any */}
              {message.mediaUrls && message.mediaUrls.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 mb-2 rounded-[12px] overflow-hidden">
                  {message.mediaUrls.map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt="Ảnh đính kèm"
                      className="w-full h-36 object-cover rounded-[8px] border border-black/10"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Message text content */}
              <p className="text-[14.5px] leading-[1.45] whitespace-pre-wrap">
                {message.content}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Timestamp & Read Receipt Checkmarks */}
      <div
        className={`flex items-center gap-1 mt-1 px-1 text-[11px] text-ash select-none ${
          isOwn ? 'flex-row-reverse' : 'flex-row'
        }`}
        title={fullTime}
      >
        <span>{formatRelativeTime(message.createdAt)}</span>

        {/* Read receipts for own sent messages */}
        {isOwn && !message.isDeleted && (
          <span className="flex items-center ml-0.5">
            {isReadByOther ? (
              <span className="flex items-center text-meta" title="Đã xem (Read)">
                <CheckCheck className="w-3.5 h-3.5 stroke-[2.2]" />
              </span>
            ) : (
              <span className="flex items-center text-ash" title="Đã gửi (Sent)">
                <Check className="w-3.5 h-3.5 stroke-[2]" />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
};
