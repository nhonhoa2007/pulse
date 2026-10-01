import React, { useState, useEffect, useCallback } from 'react';
import { NotificationDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { formatRelativeTime } from '../utils/formatters';
import { WebPushToggle } from '../components/WebPushToggle';
import {
  Heart,
  MessageCircle,
  Repeat,
  UserPlus,
  UserCheck,
  UserX,
  AtSign,
  Quote,
  Check,
  Bell,
  RefreshCw,
  Lock,
} from 'lucide-react';

export const NotificationCenterView: React.FC = () => {
  const {
    currentUser,
    setUnreadCount,
    navigateTo,
    addToast,
    openFollowRequestsModal,
    pendingFollowRequestsCount,
    setPendingFollowRequestsCount,
    refreshUsers,
  } = usePulse();

  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'LIKES' | 'FOLLOWS'>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isMarkingRead, setIsMarkingRead] = useState<boolean>(false);
  const [actionStatus, setActionStatus] = useState<Record<string, 'ACCEPTED' | 'REJECTED'>>({});
  const [processingMap, setProcessingMap] = useState<Record<string, boolean>>({});

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getNotifications();
      setNotifications(data);
      const unread = data.filter((n) => !n.isRead).length;
      setUnreadCount(unread);
    } catch {
      if (notifications.length === 0) {
        setNotifications(getFallbackNotifications());
      }
    } finally {
      setIsLoading(false);
    }
  }, [notifications.length, setUnreadCount]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications, currentUser.id]);

  const handleMarkAllRead = async () => {
    setIsMarkingRead(true);
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      addToast('Đã đánh dấu tất cả thông báo là đã đọc', 'success');
    } catch (err: any) {
      addToast(err.message || 'Không thể cập nhật trạng thái', 'error');
    } finally {
      setIsMarkingRead(false);
    }
  };

  const handleInlineAccept = async (notif: NotificationDto) => {
    const targetRequestId = notif.targetId || notif.id;
    setProcessingMap((prev) => ({ ...prev, [notif.id]: true }));

    try {
      const res = await api.acceptFollowRequest(targetRequestId);
      if (res.success) {
        setActionStatus((prev) => ({ ...prev, [notif.id]: 'ACCEPTED' }));
        setPendingFollowRequestsCount((prev) => Math.max(0, prev - 1));
        addToast(`Đã chấp nhận yêu cầu theo dõi từ @${notif.actor.username}`, 'success');
        refreshUsers();
      } else {
        addToast(res.error?.message || 'Chấp nhận yêu cầu theo dõi thất bại', 'error');
      }
    } catch (err: any) {
      addToast(err.message || 'Chấp nhận yêu cầu theo dõi thất bại', 'error');
    } finally {
      setProcessingMap((prev) => {
        const next = { ...prev };
        delete next[notif.id];
        return next;
      });
    }
  };

  const handleInlineReject = async (notif: NotificationDto) => {
    const targetRequestId = notif.targetId || notif.id;
    setProcessingMap((prev) => ({ ...prev, [notif.id]: true }));

    try {
      const res = await api.rejectFollowRequest(targetRequestId);
      if (res.success) {
        setActionStatus((prev) => ({ ...prev, [notif.id]: 'REJECTED' }));
        setPendingFollowRequestsCount((prev) => Math.max(0, prev - 1));
        addToast(`Đã từ chối yêu cầu theo dõi từ @${notif.actor.username}`, 'info');
      } else {
        addToast(res.error?.message || 'Từ chối yêu cầu theo dõi thất bại', 'error');
      }
    } catch (err: any) {
      addToast(err.message || 'Từ chối yêu cầu theo dõi thất bại', 'error');
    } finally {
      setProcessingMap((prev) => {
        const next = { ...prev };
        delete next[notif.id];
        return next;
      });
    }
  };

  const filteredNotifications = notifications.filter((item) => {
    if (filter === 'UNREAD') return !item.isRead;
    if (filter === 'LIKES') return item.verb === 'LIKE';
    if (filter === 'FOLLOWS') return item.verb === 'FOLLOW' || item.verb === 'FOLLOW_REQUEST' || item.verb === 'FOLLOW_ACCEPT';
    return true;
  });

  const getVerbDetails = (verb: NotificationDto['verb']) => {
    switch (verb) {
      case 'LIKE':
        return {
          icon: Heart,
          text: 'đã thích bài viết của bạn',
          color: 'text-[#000000] fill-[#000000]',
        };
      case 'REPLY':
        return {
          icon: MessageCircle,
          text: 'đã trả lời bài viết của bạn',
          color: 'text-[#000000]',
        };
      case 'REPOST':
        return {
          icon: Repeat,
          text: 'đã đăng lại bài viết của bạn',
          color: 'text-[#000000]',
        };
      case 'QUOTE':
        return {
          icon: Quote,
          text: 'đã trích dẫn bài viết của bạn',
          color: 'text-[#000000]',
        };
      case 'FOLLOW':
        return {
          icon: UserPlus,
          text: 'đã bắt đầu theo dõi bạn',
          color: 'text-[#385898]',
        };
      case 'FOLLOW_REQUEST':
        return {
          icon: Lock,
          text: 'đã gửi yêu cầu theo dõi bạn',
          color: 'text-[#385898]',
        };
      case 'FOLLOW_ACCEPT':
        return {
          icon: UserCheck,
          text: 'đã chấp nhận yêu cầu theo dõi của bạn',
          color: 'text-[#385898]',
        };
      case 'MENTION':
        return {
          icon: AtSign,
          text: 'đã nhắc đến bạn trong một bài viết',
          color: 'text-[#385898]',
        };
      default:
        return {
          icon: Bell,
          text: 'đã tương tác với bạn',
          color: 'text-[#424242]',
        };
    }
  };

  const handleNotificationClick = (notif: NotificationDto) => {
    if (notif.targetType === 'POST' && notif.targetId) {
      navigateTo('thread', { postId: notif.targetId });
    } else if (notif.targetType === 'USER' || notif.verb === 'FOLLOW' || notif.verb === 'FOLLOW_REQUEST' || notif.verb === 'FOLLOW_ACCEPT') {
      navigateTo('profile', { username: notif.actor.username });
    }
  };

  return (
    <div className="min-w-0 flex-1 min-h-screen pb-20 md:pb-8 bg-[#fafafa]">
      {/* Top Header (~53px tall, background Paper White #fafafa, centered section title in 15px/600 #000000) */}
      <header className="sticky top-0 z-20 bg-[#fafafa]/95 backdrop-blur-md border-b border-[#d5d5d5]">
        <div className="flex items-center justify-between h-[53px] px-4">
          <div className="w-8" />
          <h1 className="text-[15px] font-semibold text-[#000000]">Thông báo</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMarkAllRead}
              disabled={isMarkingRead || notifications.every((n) => n.isRead)}
              className="flex items-center gap-1 px-3 py-1 text-[12px] font-semibold rounded-full border border-[#d5d5d5] hover:border-[#000000] text-[#000000] hover:bg-[#efefef] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Đánh dấu tất cả là đã đọc"
            >
              <Check className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Đã đọc</span>
            </button>
            <button
              onClick={() => fetchNotifications()}
              className="p-1.5 text-[#969696] hover:text-[#000000] rounded-full hover:bg-[#efefef] transition-colors focus:outline-none"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto text-[13px]">
          {[
            { id: 'ALL', label: 'Tất cả' },
            { id: 'UNREAD', label: 'Chưa đọc' },
            { id: 'LIKES', label: 'Lượt thích' },
            { id: 'FOLLOWS', label: 'Người theo dõi' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id as any)}
              className={`px-3 py-1 rounded-full font-semibold whitespace-nowrap transition-colors focus:outline-none ${
                filter === item.id
                  ? 'bg-[#000000] text-[#fafafa]'
                  : 'border border-[#d5d5d5] text-[#424242] hover:text-[#000000] hover:bg-[#efefef]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* TASK-21: Follow Requests Banner for Private Accounts */}
      {(currentUser.isPrivate || pendingFollowRequestsCount > 0) && (
        <div
          onClick={openFollowRequestsModal}
          className="mx-4 my-3 p-3.5 bg-[#ffffff] border border-[#d5d5d5] rounded-xl flex items-center justify-between cursor-pointer hover:bg-[#efefef]/60 transition-colors shadow-sm"
          data-testid="notification-follow-requests-banner"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-[#efefef] text-[#000000]">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[#000000]">
                Yêu cầu theo dõi
              </div>
              <div className="text-[12px] text-[#424242]">
                {pendingFollowRequestsCount > 0
                  ? `${pendingFollowRequestsCount} yêu cầu đang chờ bạn phê duyệt`
                  : 'Quản lý danh sách yêu cầu theo dõi'}
              </div>
            </div>
          </div>
          {pendingFollowRequestsCount > 0 ? (
            <span
              className="px-2.5 py-0.5 rounded-full text-[12px] font-bold bg-[#000000] text-[#fafafa]"
              data-testid="notification-follow-requests-count"
            >
              {pendingFollowRequestsCount}
            </span>
          ) : (
            <span className="text-[12px] font-medium text-[#424242]">Xem</span>
          )}
        </div>
      )}

      {/* Web Push Notification Opt-in Prompt (TASK-20) */}
      <div className="p-3 border-b border-[#d5d5d5]/60 bg-[#fafafa]">
        <WebPushToggle />
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="divide-y divide-[#d5d5d5]">
          {[1, 2, 3].map((n) => (
            <div key={n} className="p-4 flex gap-3 animate-pulse bg-[#fafafa]">
              <div className="w-10 h-10 rounded-full bg-[#efefef] shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-[#efefef] rounded w-2/3" />
                <div className="h-3 bg-[#efefef] rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="py-16 text-center text-[#969696]">
          <Bell className="w-8 h-8 mx-auto mb-2 text-[#969696]" />
          <p className="font-semibold text-[#000000] text-[15px] mb-1">
            Không có thông báo nào
          </p>
          <p className="text-[13px] text-[#424242]">
            {filter === 'UNREAD'
              ? 'Bạn đã đọc hết toàn bộ thông báo.'
              : 'Khi có người like, reply hoặc follow, thông báo sẽ hiển thị tại đây.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#d5d5d5]">
          {filteredNotifications.map((notif) => {
            const verbInfo = getVerbDetails(notif.verb);
            const Icon = verbInfo.icon;
            const isFollowRequest = notif.verb === 'FOLLOW_REQUEST';

            return (
              <div
                key={notif.id}
                onClick={() => handleNotificationClick(notif)}
                className={`flex items-start gap-3 p-4 hover:bg-[#efefef]/40 cursor-pointer transition-colors ${
                  !notif.isRead ? 'bg-[#efefef]/30' : 'bg-[#fafafa]'
                }`}
                data-testid={`notification-item-${notif.id}`}
              >
                {/* Verb icon badge */}
                <div className="relative shrink-0">
                  <img
                    src={
                      notif.actor.avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${notif.actor.username}`
                    }
                    alt={notif.actor.displayName}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-[#fafafa] border border-[#d5d5d5]">
                    <Icon className={`w-3 h-3 ${verbInfo.color}`} />
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] leading-[1.4] text-[#000000] mb-0.5">
                    <span className="font-semibold text-[#000000] hover:underline">
                      {notif.actorSummary || notif.actor.displayName}
                    </span>{' '}
                    <span className="text-[#424242]">{verbInfo.text}</span>
                    {notif.aggregatedCount > 1 && (
                      <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#efefef] text-[#424242]">
                        +{notif.aggregatedCount - 1} khác
                      </span>
                    )}
                  </div>

                  <span className="text-[13px] text-[#424242]">
                    {formatRelativeTime(notif.createdAt)}
                  </span>

                  {/* Inline Accept/Reject Buttons for FOLLOW_REQUEST */}
                  {isFollowRequest && (
                    <div
                      className="mt-2.5 flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {actionStatus[notif.id] ? (
                        <span className="text-[12px] font-semibold text-[#424242] px-3 py-1 bg-[#efefef] rounded-full border border-[#d5d5d5]">
                          {actionStatus[notif.id] === 'ACCEPTED'
                            ? 'Đã chấp nhận'
                            : 'Đã từ chối'}
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => handleInlineAccept(notif)}
                            disabled={processingMap[notif.id]}
                            data-testid={`notif-accept-${notif.id}`}
                            className="px-3.5 py-1 rounded-full bg-[#000000] text-[#fafafa] text-[12px] font-semibold hover:bg-[#000000]/85 transition-colors disabled:opacity-50 flex items-center gap-1 focus:outline-none"
                          >
                            <UserCheck className="w-3 h-3" />
                            <span>Chấp nhận</span>
                          </button>
                          <button
                            onClick={() => handleInlineReject(notif)}
                            disabled={processingMap[notif.id]}
                            data-testid={`notif-reject-${notif.id}`}
                            className="px-3.5 py-1 rounded-full border border-[#d5d5d5] hover:border-[#000000] text-[#000000] hover:bg-[#efefef] text-[12px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-1 focus:outline-none"
                          >
                            <UserX className="w-3 h-3" />
                            <span>Từ chối</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Unread indicator dot: Meta Blue #385898 */}
                {!notif.isRead && (
                  <div className="w-2 h-2 rounded-full bg-[#385898] shrink-0 mt-2" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function getFallbackNotifications(): NotificationDto[] {
  return [
    {
      id: 'mock-notif-1',
      recipientId: '11111111-1111-1111-1111-111111111111',
      actorId: '22222222-2222-2222-2222-222222222222',
      verb: 'LIKE',
      targetType: 'POST',
      targetId: 'mock-post-1',
      aggregatedCount: 3,
      actorSummary: 'Alice Nguyễn, Bob Trần và 1 người khác',
      isRead: false,
      createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      actor: {
        username: 'alice',
        displayName: 'Alice Nguyễn',
        avatarUrl:
          'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
      },
    },
    {
      id: 'mock-notif-2',
      recipientId: '11111111-1111-1111-1111-111111111111',
      actorId: '44444444-4444-4444-4444-444444444444',
      verb: 'FOLLOW',
      targetType: 'USER',
      targetId: '11111111-1111-1111-1111-111111111111',
      aggregatedCount: 1,
      actorSummary: 'Sơn Tùng M-TP',
      isRead: true,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      actor: {
        username: 'sontungmtp',
        displayName: 'Sơn Tùng M-TP',
        avatarUrl:
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
      },
    },
  ];
}
