import React from 'react';
import { DmConversationDto } from '../../types/PulseTypes';
import { formatRelativeTime } from '../../utils/formatters';

interface DmConversationListItemProps {
  conversation: DmConversationDto;
  isSelected: boolean;
  onClick: () => void;
  currentUserId: string;
}

export const DmConversationListItem: React.FC<DmConversationListItemProps> = ({
  conversation,
  isSelected,
  onClick,
  currentUserId,
}) => {
  const { otherUser, lastMessage, unreadCount, updatedAt } = conversation;
  const isLastMessageFromMe = lastMessage && lastMessage.senderId === currentUserId;

  const renderLastMessagePreview = () => {
    if (!lastMessage) {
      return (
        <span className="text-ash italic text-[13px]">
          Bắt đầu cuộc trò chuyện mới
        </span>
      );
    }

    if (lastMessage.isDeleted) {
      return (
        <span className="text-ash italic text-[13px]">
          {isLastMessageFromMe ? 'Bạn: ' : ''}Tin nhắn đã bị xóa
        </span>
      );
    }

    const prefix = isLastMessageFromMe ? 'Bạn: ' : '';
    const content = lastMessage.content || (lastMessage.mediaUrls?.length ? '[Hình ảnh]' : '');

    return (
      <span
        className={`text-[13px] truncate ${
          unreadCount > 0 ? 'text-ink font-medium' : 'text-graphite'
        }`}
      >
        {prefix}
        {content}
      </span>
    );
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 text-left transition-all rounded-[14px] focus:outline-none select-none ${
        isSelected
          ? 'bg-mist text-ink shadow-sm'
          : 'hover:bg-mist/60 text-ink'
      }`}
      aria-selected={isSelected}
    >
      {/* Avatar with unread indicator dot */}
      <div className="relative shrink-0">
        <img
          src={
            otherUser.avatarUrl ||
            `https://api.dicebear.com/7.x/bottts/svg?seed=${otherUser.username}`
          }
          alt={otherUser.displayName}
          className="w-12 h-12 rounded-full object-cover border border-cloud bg-paper"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/bottts/svg?seed=${otherUser.username}`;
          }}
        />
        {unreadCount > 0 && (
          <span
            className="absolute top-0 right-0 w-3 h-3 rounded-full bg-meta border-2 border-paper"
            title={`${unreadCount} tin nhắn chưa đọc`}
          />
        )}
      </div>

      {/* Details (Name, last message preview, timestamp) */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-[14px] truncate ${
                unreadCount > 0 ? 'font-bold text-ink' : 'font-semibold text-ink'
              }`}
            >
              {otherUser.displayName}
            </span>
            <span className="text-[12px] text-ash truncate">
              @{otherUser.username}
            </span>
          </div>

          <span className="text-[11px] text-ash shrink-0 font-normal">
            {formatRelativeTime(updatedAt)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0 truncate">{renderLastMessagePreview()}</div>

          {unreadCount > 0 && (
            <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-meta text-white text-[11px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};
