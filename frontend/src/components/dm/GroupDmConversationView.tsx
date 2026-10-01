import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  GroupConversationDto,
  GroupMessageDto,
  RealtimeEvent,
} from '../../types/PulseTypes';
import { api } from '../../api/PulseApiClient';
import { usePulse } from '../../context/PulseContext';
import { GroupMembersModal } from './GroupMembersModal';
import { formatRelativeTime } from '../../utils/formatters';
import {
  ArrowLeft,
  Users,
  Send,
  Loader2,
  AlertCircle,
  ChevronUp,
  Image as ImageIcon,
  X,
  Trash2,
} from 'lucide-react';

interface GroupDmConversationViewProps {
  group: GroupConversationDto;
  onBack?: () => void;
  onGroupUpdated?: (updated: GroupConversationDto) => void;
  onLeaveGroup?: () => void;
}

export const GroupDmConversationView: React.FC<GroupDmConversationViewProps> = ({
  group,
  onBack,
  onGroupUpdated,
  onLeaveGroup,
}) => {
  const { currentUser, addToast } = usePulse();
  const [messages, setMessages] = useState<GroupMessageDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [inputContent, setInputContent] = useState('');
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto scroll to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  // Mark group conversation read
  const markAsRead = useCallback(
    async (msgId?: string) => {
      try {
        await api.markGroupRead(group.id, msgId);
        if (onGroupUpdated && group.unreadCount > 0) {
          onGroupUpdated({ ...group, unreadCount: 0 });
        }
      } catch {
        // ignore
      }
    },
    [group, onGroupUpdated]
  );

  // Load initial group messages
  const loadInitialMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getGroupMessages(group.id, { limit: 30 });
      const loaded = res.messages ? [...res.messages].reverse() : [];
      setMessages(loaded);
      setNextCursor(res.nextCursor || null);
      setHasMore(!!res.hasMore);

      const latestMsg = loaded[loaded.length - 1];
      markAsRead(latestMsg?.id);

      setTimeout(() => scrollToBottom(false), 60);
    } catch (err: any) {
      console.error('Failed to load group messages:', err);
      setError(err.message || 'Không thể tải tin nhắn nhóm.');
    } finally {
      setIsLoading(false);
    }
  }, [group.id, markAsRead, scrollToBottom]);

  // Load older messages (cursor pagination)
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore || !nextCursor) return;

    setIsLoadingMore(true);
    if (messagesContainerRef.current) {
      prevScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
    }

    try {
      const res = await api.getGroupMessages(group.id, {
        limit: 30,
        cursor: nextCursor,
        direction: 'before',
      });

      const olderMessages = res.messages ? [...res.messages].reverse() : [];
      setMessages((prev) => [...olderMessages, ...prev]);
      setNextCursor(res.nextCursor || null);
      setHasMore(!!res.hasMore);

      // Restore scroll position
      setTimeout(() => {
        if (messagesContainerRef.current) {
          const newScrollHeight = messagesContainerRef.current.scrollHeight;
          messagesContainerRef.current.scrollTop =
            newScrollHeight - prevScrollHeightRef.current;
        }
      }, 30);
    } catch (err: any) {
      console.error('Failed to load older group messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    loadInitialMessages();
  }, [loadInitialMessages]);

  // Real-time SSE listener for Group DMs (dm.group.message.new, etc.)
  useEffect(() => {
    if (!currentUser.id) return;

    const unsubscribe = api.subscribeRealtimeEvents(
      currentUser.id,
      (event: RealtimeEvent) => {
        // New group message arrived
        if (event.type === 'dm.group.message.new') {
          const { conversationId, message } = event.data || {};
          if (conversationId === group.id && message) {
            setMessages((prev) => {
              // Deduplicate
              if (prev.some((m) => m.id === message.id)) {
                return prev;
              }
              return [...prev, message];
            });

            // Mark read if chat is currently open
            markAsRead(message.id);

            // Update parent group list last message
            if (onGroupUpdated) {
              onGroupUpdated({
                ...group,
                lastMessage: message,
                updatedAt: message.createdAt,
              });
            }

            setTimeout(() => scrollToBottom(true), 50);
          }
        } else if (event.type === 'dm.group.message.deleted') {
          const { conversationId, messageId } = event.data || {};
          if (conversationId === group.id && messageId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId ? { ...m, isDeleted: true, content: '' } : m
              )
            );
          }
        } else if (event.type === 'dm.group.member.joined') {
          const { conversationId, member } = event.data || {};
          if (conversationId === group.id && member) {
            const exists = group.members.some((m) => m.userId === member.userId);
            if (!exists) {
              const updatedMembers = [...group.members, member];
              onGroupUpdated?.({ ...group, members: updatedMembers });
            }
          }
        } else if (event.type === 'dm.group.member.left') {
          const { conversationId, userId } = event.data || {};
          if (conversationId === group.id && userId) {
            const updatedMembers = group.members.filter((m) => m.userId !== userId);
            onGroupUpdated?.({ ...group, members: updatedMembers });
          }
        } else if (event.type === 'dm.group.updated') {
          const { conversationId, title, avatarUrl } = event.data || {};
          if (conversationId === group.id) {
            onGroupUpdated?.({
              ...group,
              ...(title ? { title } : {}),
              ...(avatarUrl !== undefined ? { avatarUrl } : {}),
            });
          }
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [currentUser.id, group, markAsRead, onGroupUpdated, scrollToBottom]);

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputContent.trim();
    if ((!trimmed && mediaUrls.length === 0) || isSending) return;

    setIsSending(true);
    setInputContent('');
    const urlsToSend = [...mediaUrls];
    setMediaUrls([]);

    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }

    try {
      const sent = await api.sendGroupMessage(group.id, {
        content: trimmed,
        mediaUrls: urlsToSend,
      });

      setMessages((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev;
        return [...prev, sent];
      });

      if (onGroupUpdated) {
        onGroupUpdated({
          ...group,
          lastMessage: sent,
          updatedAt: sent.createdAt,
        });
      }

      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      console.error('Failed to send group message:', err);
      setInputContent(trimmed);
      setMediaUrls(urlsToSend);
      addToast(err.message || 'Không thể gửi tin nhắn trong nhóm.', 'error');
    } finally {
      setIsSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  // Delete message
  const handleDeleteMessage = async (msgId: string) => {
    try {
      await api.deleteGroupMessage(group.id, msgId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, isDeleted: true, content: '' } : m
        )
      );
      addToast('Đã xóa tin nhắn', 'info');
    } catch (err: any) {
      addToast(err.message || 'Không thể xóa tin nhắn', 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Add dummy image prompt
  const handleAddMedia = () => {
    const url = window.prompt('Nhập đường dẫn URL ảnh (https://...):');
    if (url && url.trim().startsWith('http')) {
      setMediaUrls((prev) => [...prev, url.trim()]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-paper" data-testid="group-chat-window">
      {/* Header */}
      <header className="px-4 py-3 border-b border-cloud bg-paper/95 backdrop-blur-md flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 -ml-1 text-ash hover:text-ink rounded-full hover:bg-mist transition-colors md:hidden focus:outline-none"
              aria-label="Quay lại danh sách"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          {/* Group Avatar */}
          <div className="relative shrink-0">
            {group.avatarUrl ? (
              <img
                src={group.avatarUrl}
                alt={group.title}
                className="w-10 h-10 rounded-full object-cover border border-cloud"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-mist border border-cloud flex items-center justify-center text-ink">
                <Users className="w-5 h-5 stroke-[1.8]" />
              </div>
            )}
          </div>

          {/* Group Details */}
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-ink truncate">
              {group.title}
            </h2>
            <button
              type="button"
              onClick={() => setIsMembersModalOpen(true)}
              className="text-[12px] text-ash hover:text-ink hover:underline flex items-center gap-1 text-left"
            >
              <span>{group.members.length} thành viên</span>
              <span>•</span>
              <span className="text-meta">Quản lý nhóm</span>
            </button>
          </div>
        </div>

        {/* Header Action: Open Members Modal */}
        <button
          onClick={() => setIsMembersModalOpen(true)}
          className="p-2 text-graphite hover:text-ink hover:bg-mist rounded-full transition-colors focus:outline-none"
          title="Xem danh sách thành viên"
          aria-label="Xem thành viên"
          data-testid="group-members-btn"
        >
          <Users className="w-5 h-5" />
        </button>
      </header>

      {/* Messages Scroll Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-paper"
      >
        {/* Load More Button */}
        {hasMore && (
          <div className="text-center py-2">
            <button
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-mist hover:bg-cloud/60 text-[12px] font-semibold text-graphite rounded-full transition-colors disabled:opacity-50"
            >
              {isLoadingMore ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
              <span>Tải tin nhắn cũ hơn</span>
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-ash">
            <Loader2 className="w-6 h-6 animate-spin text-meta" />
            <span className="text-[13px]">Đang tải tin nhắn nhóm...</span>
          </div>
        ) : error ? (
          <div className="p-4 text-center">
            <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" />
            <p className="text-[13px] text-ink mb-2">{error}</p>
            <button
              onClick={loadInitialMessages}
              className="px-3 py-1 bg-ink text-white text-[12px] rounded-full font-semibold"
            >
              Thử lại
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-16 text-center text-ash">
            <div className="w-14 h-14 rounded-full bg-mist flex items-center justify-center mx-auto mb-3 text-ink">
              <Users className="w-7 h-7 stroke-[1.8]" />
            </div>
            <h3 className="text-[16px] font-bold text-ink mb-1">
              {group.title}
            </h3>
            <p className="text-[13px] text-ash max-w-xs mx-auto">
              Chưa có tin nhắn nào trong nhóm. Hãy bắt đầu cuộc trò chuyện đầu tiên!
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.senderId === currentUser.id;
            const senderName =
              message.sender?.displayName ||
              message.sender?.username ||
              'Thành viên';
            const senderAvatar = message.sender?.avatarUrl;

            return (
              <div
                key={message.id}
                className={`group flex flex-col ${
                  isOwn ? 'items-end' : 'items-start'
                }`}
                data-testid={`group-message-${message.id}`}
              >
                {/* Sender Display Name for other members */}
                {!isOwn && (
                  <span className="text-[11px] font-semibold text-ash ml-11 mb-1 truncate max-w-[240px]">
                    {senderName}
                  </span>
                )}

                <div className="flex items-end gap-2 max-w-[85%] sm:max-w-[75%]">
                  {/* Sender Avatar on Left (for others) */}
                  {!isOwn && (
                    <img
                      src={
                        senderAvatar ||
                        `https://api.dicebear.com/7.x/bottts/svg?seed=${senderName}`
                      }
                      alt={senderName}
                      className="w-8 h-8 rounded-full object-cover border border-cloud shrink-0"
                    />
                  )}

                  {/* Delete Button for Own Message */}
                  {isOwn && !message.isDeleted && (
                    <button
                      type="button"
                      onClick={() => handleDeleteMessage(message.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-ash hover:text-red-500 rounded-full transition-all"
                      title="Xóa tin nhắn"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`rounded-[18px] px-4 py-2.5 text-[14px] leading-relaxed transition-all select-text shadow-sm ${
                      message.isDeleted
                        ? 'bg-mist/70 text-ash italic border border-dashed border-cloud'
                        : isOwn
                        ? 'bg-ink text-paper rounded-br-[4px]'
                        : 'bg-mist text-ink border border-cloud/50 rounded-bl-[4px]'
                    }`}
                  >
                    {message.isDeleted ? (
                      <span>Tin nhắn đã bị xóa</span>
                    ) : (
                      <>
                        {message.content && (
                          <p className="whitespace-pre-wrap break-words">
                            {message.content}
                          </p>
                        )}

                        {/* Media URLs images */}
                        {message.mediaUrls && message.mediaUrls.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {message.mediaUrls.map((url, i) => (
                              <img
                                key={i}
                                src={url}
                                alt="Media đính kèm"
                                className="rounded-[12px] max-h-60 object-cover border border-black/10"
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Timestamp */}
                <span className={`text-[10.5px] text-ash mt-1 ${isOwn ? 'mr-1' : 'ml-11'}`}>
                  {formatRelativeTime(message.createdAt)}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Media previews before sending */}
      {mediaUrls.length > 0 && (
        <div className="p-2 border-t border-cloud bg-paper flex gap-2 overflow-x-auto">
          {mediaUrls.map((url, index) => (
            <div key={index} className="relative group shrink-0">
              <img
                src={url}
                alt="Đính kèm"
                className="w-16 h-16 rounded-[10px] object-cover border border-cloud"
              />
              <button
                type="button"
                onClick={() => setMediaUrls((prev) => prev.filter((_, i) => i !== index))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-black text-white rounded-full flex items-center justify-center shadow"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Message Composer Footer */}
      <footer className="p-3 border-t border-cloud bg-paper">
        <form onSubmit={handleSendMessage} className="flex items-end gap-2">
          <button
            type="button"
            onClick={handleAddMedia}
            className="p-2 text-ash hover:text-ink hover:bg-mist rounded-full transition-colors focus:outline-none"
            title="Đính kèm hình ảnh"
          >
            <ImageIcon className="w-5 h-5" />
          </button>

          <div className="flex-1 bg-mist rounded-[18px] border border-transparent focus-within:border-meta focus-within:bg-paper transition-all px-3 py-1.5 flex items-center">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputContent}
              onChange={(e) => setInputContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Gửi tin nhắn trong nhóm..."
              className="w-full bg-transparent text-[14px] text-ink placeholder-ash focus:outline-none resize-none max-h-32"
              data-testid="group-message-input"
            />
          </div>

          <button
            type="submit"
            disabled={(!inputContent.trim() && mediaUrls.length === 0) || isSending}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
              inputContent.trim() || mediaUrls.length > 0
                ? 'bg-ink hover:bg-graphite text-white'
                : 'bg-mist text-ash cursor-not-allowed'
            }`}
            data-testid="send-group-message-btn"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin text-paper" />
            ) : (
              <Send className="w-4 h-4 stroke-[2]" />
            )}
          </button>
        </form>
      </footer>

      {/* Group Members Management Modal */}
      <GroupMembersModal
        group={group}
        isOpen={isMembersModalOpen}
        onClose={() => setIsMembersModalOpen(false)}
        onGroupUpdated={(updated) => {
          onGroupUpdated?.(updated);
        }}
        onLeftGroup={() => {
          onLeaveGroup?.();
        }}
      />
    </div>
  );
};
