import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  DmConversationDto,
  DmMessageDto,
  RealtimeEvent,
} from '../../types/PulseTypes';
import { api } from '../../api/PulseApiClient';
import { usePulse } from '../../context/PulseContext';
import { DmMessageBubble } from './DmMessageBubble';
import { DmMessageComposer } from './DmMessageComposer';
import { VerifiedBadge } from '../VerifiedBadge';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronUp,
} from 'lucide-react';

interface DmChatWindowProps {
  conversation: DmConversationDto;
  onBack?: () => void;
  onConversationUpdated?: (updated: DmConversationDto) => void;
}

export const DmChatWindow: React.FC<DmChatWindowProps> = ({
  conversation,
  onBack,
  onConversationUpdated,
}) => {
  const { currentUser, navigateTo, addToast } = usePulse();
  const [messages, setMessages] = useState<DmMessageDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [lastReadMessageIdByOther, setLastReadMessageIdByOther] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);

  const { otherUser } = conversation;

  // Auto scroll to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  // Mark conversation as read
  const markAsRead = useCallback(async (msgId?: string) => {
    try {
      await api.markDmRead(conversation.id, msgId);
      if (onConversationUpdated && conversation.unreadCount > 0) {
        onConversationUpdated({ ...conversation, unreadCount: 0 });
      }
    } catch {
      // ignore
    }
  }, [conversation, onConversationUpdated]);

  // Load initial messages
  const loadInitialMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getDmMessages(conversation.id, { limit: 30 });
      // Reverse messages if server returns newest first, so top is oldest, bottom is newest
      const loaded = res.messages ? [...res.messages].reverse() : [];
      setMessages(loaded);
      setNextCursor(res.nextCursor || null);
      setHasMore(!!res.hasMore);

      // Mark conversation read
      const latestMsg = loaded[loaded.length - 1];
      markAsRead(latestMsg?.id);

      setTimeout(() => scrollToBottom(false), 50);
    } catch (err: any) {
      console.error('Failed to load DM messages:', err);
      setError(err.message || 'Không thể tải tin nhắn.');
    } finally {
      setIsLoading(false);
    }
  }, [conversation.id, markAsRead, scrollToBottom]);

  // Load older messages (cursor pagination)
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore || !nextCursor) return;

    setIsLoadingMore(true);
    if (messagesContainerRef.current) {
      prevScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
    }

    try {
      const res = await api.getDmMessages(conversation.id, {
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
      }, 20);
    } catch (err: any) {
      addToast(err.message || 'Không thể tải thêm tin nhắn cũ', 'error');
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    loadInitialMessages();
  }, [loadInitialMessages]);

  // Send message
  const handleSendMessage = async (content: string) => {
    setIsSending(true);
    try {
      const newMsg = await api.sendDmMessage(conversation.id, {
        content,
        messageType: 'TEXT',
      });

      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });

      if (onConversationUpdated) {
        onConversationUpdated({
          ...conversation,
          lastMessage: newMsg,
          updatedAt: newMsg.createdAt,
        });
      }

      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      console.error('Failed to send DM message:', err);
      addToast(err.message || 'Không thể gửi tin nhắn. Vui lòng thử lại.', 'error');
      throw err;
    } finally {
      setIsSending(false);
    }
  };

  // Delete message
  const handleDeleteMessage = async (messageId: string) => {
    try {
      await api.deleteDmMessage(messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, isDeleted: true, content: 'This message was deleted' }
            : m
        )
      );
      addToast('Đã xóa tin nhắn', 'success');
    } catch (err: any) {
      addToast(err.message || 'Không thể xóa tin nhắn', 'error');
      throw err;
    }
  };

  // SSE real-time stream listener for this conversation
  useEffect(() => {
    if (!currentUser.id) return;

    const unsubscribe = api.subscribeRealtimeEvents(
      currentUser.id,
      (event: RealtimeEvent) => {
        // 1. New message
        if (event.type === 'dm.message.new') {
          const eventData = event.data;
          if (eventData?.conversationId === conversation.id && eventData?.message) {
            const incoming = eventData.message;
            setMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev, incoming];
            });

            // If received from the other user, mark as read
            if (incoming.senderId !== currentUser.id) {
              markAsRead(incoming.id);
            }

            setTimeout(() => scrollToBottom(true), 50);
          }
        }
        // 2. Deleted message
        else if (event.type === 'dm.message.deleted') {
          const eventData = event.data;
          if (eventData?.conversationId === conversation.id && eventData?.messageId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === eventData.messageId
                  ? { ...m, isDeleted: true, content: 'This message was deleted' }
                  : m
              )
            );
          }
        }
        // 3. Read receipt updated
        else if (event.type === 'dm.read_receipt.updated') {
          const eventData = event.data;
          if (
            eventData?.conversationId === conversation.id &&
            eventData?.userId !== currentUser.id
          ) {
            setLastReadMessageIdByOther(eventData.lastReadMessageId);
          }
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [currentUser.id, conversation.id, markAsRead, scrollToBottom]);

  // Determine which sent messages are read by the other user
  const isMessageRead = (msg: DmMessageDto, index: number): boolean => {
    if (msg.senderId !== currentUser.id) return false;
    if (!lastReadMessageIdByOther) {
      // If other user has viewed conversation or receipt updated
      return false;
    }
    // If exact match or earlier than lastReadMessageId
    const readIndex = messages.findIndex((m) => m.id === lastReadMessageIdByOther);
    return readIndex !== -1 && index <= readIndex;
  };

  return (
    <div className="flex flex-col h-full bg-paper">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cloud bg-paper/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-1.5 -ml-1 text-ink hover:bg-mist rounded-full transition-colors"
              title="Quay lại danh sách"
              aria-label="Quay lại"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2]" />
            </button>
          )}

          {/* Recipient User Info */}
          <button
            type="button"
            onClick={() => navigateTo('profile', { username: otherUser.username })}
            className="flex items-center gap-2.5 min-w-0 group text-left focus:outline-none"
            title={`Xem hồ sơ @${otherUser.username}`}
          >
            <img
              src={
                otherUser.avatarUrl ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${otherUser.username}`
              }
              alt={otherUser.displayName}
              className="w-10 h-10 rounded-full object-cover border border-cloud group-hover:opacity-85 transition-opacity"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-[15px] font-semibold text-ink group-hover:underline truncate">
                  {otherUser.displayName}
                </span>
                <VerifiedBadge size={13} />
              </div>
              <span className="text-[12px] text-ash block truncate">
                @{otherUser.username}
              </span>
            </div>
          </button>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1 text-ash">
          <button
            onClick={() => loadInitialMessages()}
            className="p-2 rounded-full hover:text-ink hover:bg-mist transition-colors focus:outline-none"
            title="Làm mới tin nhắn"
            aria-label="Làm mới"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-1 select-text"
      >
        {/* Loading Spinner */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-ash">
            <Loader2 className="w-6 h-6 animate-spin text-meta" />
            <span className="text-[13px]">Đang tải tin nhắn...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-center p-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
            <p className="text-[14px] font-medium text-ink">{error}</p>
            <button
              onClick={() => loadInitialMessages()}
              className="px-4 py-1.5 bg-ink text-white text-[13px] font-semibold rounded-full hover:bg-graphite transition-colors"
            >
              Thử lại
            </button>
          </div>
        ) : (
          <>
            {/* Load more older messages button */}
            {hasMore && (
              <div className="flex justify-center py-2">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-mist hover:bg-cloud text-[12px] font-semibold text-graphite transition-colors"
                >
                  {isLoadingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                  <span>Tải thêm tin nhắn cũ</span>
                </button>
              </div>
            )}

            {/* Empty messages placeholder */}
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center p-6 text-ash">
                <img
                  src={
                    otherUser.avatarUrl ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${otherUser.username}`
                  }
                  alt={otherUser.displayName}
                  className="w-16 h-16 rounded-full object-cover border-2 border-cloud mb-3"
                />
                <h4 className="text-[16px] font-bold text-ink mb-1">
                  {otherUser.displayName}
                </h4>
                <p className="text-[13px] text-graphite max-w-xs mb-4">
                  Chưa có tin nhắn nào trong cuộc hội thoại này. Hãy gửi lời chào đầu tiên!
                </p>
                <button
                  type="button"
                  onClick={() => handleSendMessage('Xin chào! 👋')}
                  className="px-4 py-1.5 rounded-full border border-cloud hover:bg-mist text-[13px] font-semibold text-ink transition-colors"
                >
                  Gửi "Xin chào! 👋"
                </button>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <DmMessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.senderId === currentUser.id}
                  isReadByOther={isMessageRead(msg, idx)}
                  onDelete={handleDeleteMessage}
                />
              ))
            )}

            {/* Bottom anchor for auto scroll */}
            <div ref={messagesEndRef} className="h-2" />
          </>
        )}
      </div>

      {/* Composer at bottom */}
      <DmMessageComposer
        conversationId={conversation.id}
        isBlocked={!!conversation.isBlocked}
        onSendMessage={handleSendMessage}
        isSending={isSending}
      />
    </div>
  );
};
