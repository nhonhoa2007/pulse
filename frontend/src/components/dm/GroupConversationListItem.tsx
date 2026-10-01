import React from 'react';
import { GroupConversationDto } from '../../types/PulseTypes';
import { formatRelativeTime } from '../../utils/formatters';
import { Users } from 'lucide-react';

interface GroupConversationListItemProps {
  group: GroupConversationDto;
  isSelected: boolean;
  onClick: () => void;
  currentUserId: string;
}

export const GroupConversationListItem: React.FC<GroupConversationListItemProps> = ({
  group,
  isSelected,
  onClick,
  currentUserId,
}) => {
  const { title, avatarUrl, members = [], lastMessage, unreadCount, updatedAt } = group;
  const isLastMessageFromMe = lastMessage && lastMessage.senderId === currentUserId;

  const renderLastMessagePreview = () => {
    if (!lastMessage) {
      return (
        <span className="text-ash italic text-[13px]">
          Chưa có tin nhắn nào trong nhóm
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

    const senderName = isLastMessageFromMe
      ? 'Bạn'
      : lastMessage.sender?.displayName || lastMessage.sender?.username || 'Thành viên';

    const content =
      lastMessage.content ||
      (lastMessage.mediaUrls?.length ? '[Hình ảnh]' : '');

    return (
      <span
        className={`text-[13px] truncate ${
          unreadCount > 0 ? 'text-ink font-semibold' : 'text-graphite'
        }`}
      >
        <span className="text-ash">{senderName}: </span>
        {content}
      </span>
    );
  };

  const memberCount = members.length;

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
      data-testid="group-conversation-item"
      data-group-id={group.id}
    >
      {/* Group Avatar Icon with unread badge */}
      <div className="relative shrink-0">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={title}
            className="w-12 h-12 rounded-full object-cover border border-cloud bg-paper"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-mist border border-cloud flex items-center justify-center text-graphite">
            <Users className="w-6 h-6 stroke-[1.8]" />
          </div>
        )}

        {unreadCount > 0 && (
          <span
            className="absolute top-0 right-0 w-3 h-3 rounded-full bg-meta border-2 border-paper"
            title={`${unreadCount} tin nhắn chưa đọc`}
          />
        )}
      </div>

      {/* Details: Group Title, Member count, Last message preview, Timestamp */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-[14px] truncate ${
                unreadCount > 0 ? 'font-bold text-ink' : 'font-semibold text-ink'
              }`}
            >
              {title}
            </span>
            <span className="text-[11px] text-ash shrink-0 px-1.5 py-0.2 bg-mist rounded-full border border-cloud/60">
              {memberCount} thành viên
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
