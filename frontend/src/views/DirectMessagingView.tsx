import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import {
  DmConversationDto,
  GroupConversationDto,
  GroupMemberDto,
  RealtimeEvent,
} from '../types/PulseTypes';
import { DmConversationListItem } from '../components/dm/DmConversationListItem';
import { DmChatWindow } from '../components/dm/DmChatWindow';
import { NewDmModal } from '../components/dm/NewDmModal';
import { GroupConversationListItem } from '../components/dm/GroupConversationListItem';
import { GroupDmConversationView } from '../components/dm/GroupDmConversationView';
import { CreateGroupModal } from '../components/dm/CreateGroupModal';
import {
  MessageSquare,
  SquarePen,
  Search,
  X,
  Loader2,
  AlertCircle,
  Plus,
  Users,
} from 'lucide-react';

export const DirectMessagingView: React.FC = () => {
  const { currentUser, viewParams, refreshDmUnreadCount, addToast } = usePulse();

  // Tab: 'direct' (1-1) vs 'group'
  const [activeDmTab, setActiveDmTab] = useState<'direct' | 'group'>('direct');

  // 1-1 Conversations state
  const [conversations, setConversations] = useState<DmConversationDto[]>([]);
  const [activeConversation, setActiveConversation] = useState<DmConversationDto | null>(null);

  // Group Conversations state
  const [groupConversations, setGroupConversations] = useState<GroupConversationDto[]>([]);
  const [activeGroup, setActiveGroup] = useState<GroupConversationDto | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [isNewDmModalOpen, setIsNewDmModalOpen] = useState(false);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load 1-1 conversations
  const loadConversations = useCallback(async () => {
    try {
      const res = await api.getDmConversations({ limit: 50 });
      const list = res.conversations || [];
      setConversations(list);

      // Handle viewParams.conversationId if provided
      if (viewParams.conversationId) {
        const found = list.find((c: DmConversationDto) => c.id === viewParams.conversationId);
        if (found) {
          setActiveConversation(found);
          setActiveGroup(null);
          setActiveDmTab('direct');
        }
      }
    } catch (err: any) {
      console.error('Failed to load DM conversations:', err);
      setError(err.message || 'Không thể tải danh sách cuộc trò chuyện.');
    }
  }, [viewParams.conversationId]);

  // Load group conversations
  const loadGroups = useCallback(async () => {
    try {
      const res = await api.listGroupConversations({ limit: 50 });
      const list = res.groups || [];
      setGroupConversations(list);

      // Handle viewParams.groupId if provided
      if (viewParams.groupId) {
        const foundGroup = list.find((g: GroupConversationDto) => g.id === viewParams.groupId);
        if (foundGroup) {
          setActiveGroup(foundGroup);
          setActiveConversation(null);
          setActiveDmTab('group');
        }
      }
    } catch (err: any) {
      console.warn('Failed to load group conversations:', err);
    }
  }, [viewParams.groupId]);

  // Load both on mount
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      setError(null);
      await Promise.all([loadConversations(), loadGroups()]);
      setIsLoading(false);
    };
    init();
  }, [loadConversations, loadGroups]);

  // Handle viewParams.recipientId (auto-open or create conversation with recipient)
  useEffect(() => {
    const handleRecipientParam = async () => {
      if (viewParams.recipientId && currentUser.id) {
        if (viewParams.recipientId === currentUser.id) {
          addToast('Bạn không thể tự gửi tin nhắn cho chính mình.', 'error');
          return;
        }

        try {
          const conv = await api.getOrCreateDmConversation(viewParams.recipientId);
          setActiveConversation(conv);
          setActiveGroup(null);
          setActiveDmTab('direct');
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === conv.id);
            return exists ? prev.map((c) => (c.id === conv.id ? conv : c)) : [conv, ...prev];
          });
        } catch (err: any) {
          addToast(err.message || 'Không thể mở cuộc trò chuyện với người này.', 'error');
        }
      }
    };

    handleRecipientParam();
  }, [viewParams.recipientId, currentUser.id, addToast]);

  // Real-time SSE listener for 1-1 and Group DMs
  useEffect(() => {
    if (!currentUser.id) return;

    const unsubscribe = api.subscribeRealtimeEvents(
      currentUser.id,
      (event: RealtimeEvent) => {
        // 1-1 DM events
        if (event.type === 'dm.message.new') {
          const { conversationId, message } = event.data || {};
          if (!conversationId || !message) return;

          setConversations((prev) => {
            const existingIndex = prev.findIndex((c) => c.id === conversationId);
            const isActive = activeConversation?.id === conversationId;

            if (existingIndex !== -1) {
              const updated = {
                ...prev[existingIndex],
                lastMessage: message,
                updatedAt: message.createdAt,
                unreadCount: isActive
                  ? 0
                  : (prev[existingIndex].unreadCount || 0) + (message.senderId !== currentUser.id ? 1 : 0),
              };
              const remaining = prev.filter((_, idx) => idx !== existingIndex);
              return [updated, ...remaining];
            } else {
              loadConversations();
              return prev;
            }
          });
        } else if (event.type === 'dm.read_receipt.updated') {
          const { conversationId, userId } = event.data || {};
          if (conversationId && userId === currentUser.id) {
            setConversations((prev) =>
              prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
            );
            refreshDmUnreadCount();
          }
        }

        // Group DM events (TASK-20)
        else if (event.type === 'dm.group.message.new') {
          const { conversationId, message } = event.data || {};
          if (!conversationId || !message) return;

          setGroupConversations((prev) => {
            const existingIndex = prev.findIndex((g) => g.id === conversationId);
            const isActive = activeGroup?.id === conversationId;

            if (existingIndex !== -1) {
              const updated = {
                ...prev[existingIndex],
                lastMessage: message,
                updatedAt: message.createdAt,
                unreadCount: isActive
                  ? 0
                  : (prev[existingIndex].unreadCount || 0) + (message.senderId !== currentUser.id ? 1 : 0),
              };
              const remaining = prev.filter((_, idx) => idx !== existingIndex);
              return [updated, ...remaining];
            } else {
              loadGroups();
              return prev;
            }
          });
        } else if (event.type === 'dm.group.member.joined' || event.type === 'dm.group.member.left') {
          loadGroups();
        } else if (event.type === 'dm.group.read_receipt.updated') {
          const { conversationId, userId } = event.data || {};
          if (conversationId && userId === currentUser.id) {
            setGroupConversations((prev) =>
              prev.map((g) => (g.id === conversationId ? { ...g, unreadCount: 0 } : g))
            );
          }
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [
    currentUser.id,
    activeConversation?.id,
    activeGroup?.id,
    loadConversations,
    loadGroups,
    refreshDmUnreadCount,
  ]);

  // Filter 1-1 conversations
  const filteredConversations = useMemo(() => {
    const q = searchFilter.toLowerCase().trim();
    if (!q) return conversations;

    return conversations.filter((c) => {
      const name = c.otherUser.displayName.toLowerCase();
      const username = c.otherUser.username.toLowerCase();
      const lastMsg = c.lastMessage?.content.toLowerCase() || '';
      return name.includes(q) || username.includes(q) || lastMsg.includes(q);
    });
  }, [conversations, searchFilter]);

  // Filter group conversations
  const filteredGroups = useMemo(() => {
    const q = searchFilter.toLowerCase().trim();
    if (!q) return groupConversations;

    return groupConversations.filter((g) => {
      const title = g.title.toLowerCase();
      const lastMsg = g.lastMessage?.content.toLowerCase() || '';
      const hasMember = g.members?.some(
        (m: GroupMemberDto) =>
          m.user.displayName.toLowerCase().includes(q) ||
          m.user.username.toLowerCase().includes(q)
      );
      return title.includes(q) || lastMsg.includes(q) || hasMember;
    });
  }, [groupConversations, searchFilter]);

  // Select 1-1 conversation
  const handleSelectConversation = (conv: DmConversationDto) => {
    setActiveConversation(conv);
    setActiveGroup(null);
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
    );
  };

  // Select Group conversation
  const handleSelectGroup = (group: GroupConversationDto) => {
    setActiveGroup(group);
    setActiveConversation(null);
    setGroupConversations((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, unreadCount: 0 } : g))
    );
  };

  const handleConversationUpdated = (updated: DmConversationDto) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === updated.id);
      if (idx !== -1) {
        const remaining = prev.filter((_, i) => i !== idx);
        return [updated, ...remaining];
      }
      return [updated, ...prev];
    });
  };

  const handleGroupUpdated = (updated: GroupConversationDto) => {
    setActiveGroup(updated);
    setGroupConversations((prev) => {
      const idx = prev.findIndex((g) => g.id === updated.id);
      if (idx !== -1) {
        const remaining = prev.filter((_, i) => i !== idx);
        return [updated, ...remaining];
      }
      return [updated, ...prev];
    });
  };

  const isChatActive = !!(activeConversation || activeGroup);

  const totalDirectUnread = useMemo(
    () => conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    [conversations]
  );
  const totalGroupUnread = useMemo(
    () => groupConversations.reduce((acc, g) => acc + (g.unreadCount || 0), 0),
    [groupConversations]
  );

  return (
    <div className="flex h-[calc(100vh-1rem)] md:h-[calc(100vh-2rem)] bg-paper overflow-hidden">
      {/* LEFT COLUMN: Conversations List */}
      <aside
        className={`w-full md:w-80 lg:w-[340px] flex flex-col border-r border-cloud bg-paper shrink-0 ${
          isChatActive ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-cloud flex items-center justify-between bg-paper">
          <h1 className="text-[20px] font-bold text-ink tracking-tight">
            Tin nhắn
          </h1>

          <div className="flex items-center gap-1">
            {activeDmTab === 'direct' ? (
              <button
                onClick={() => setIsNewDmModalOpen(true)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-ink hover:bg-mist transition-colors focus:outline-none"
                title="Soạn tin nhắn mới"
                aria-label="Soạn tin nhắn mới"
                data-testid="new-dm-btn"
              >
                <SquarePen className="w-5 h-5 stroke-[2]" />
              </button>
            ) : (
              <button
                onClick={() => setIsCreateGroupModalOpen(true)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-ink hover:bg-mist transition-colors focus:outline-none"
                title="Tạo nhóm mới"
                aria-label="Tạo nhóm mới"
                data-testid="create-group-modal-btn"
              >
                <Plus className="w-5 h-5 stroke-[2]" />
              </button>
            )}
          </div>
        </div>

        {/* Dual Tab Switcher: Cá nhân (Direct) vs Nhóm (Groups) */}
        <div className="p-2 border-b border-cloud/60 bg-paper">
          <div
            className="flex p-1 bg-mist rounded-full border border-cloud/50"
            role="tablist"
            aria-label="Loại tin nhắn"
          >
            <button
              role="tab"
              aria-selected={activeDmTab === 'direct'}
              onClick={() => setActiveDmTab('direct')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-[13px] font-semibold transition-all focus:outline-none ${
                activeDmTab === 'direct'
                  ? 'bg-ink text-paper shadow-sm'
                  : 'text-graphite hover:text-ink'
              }`}
              data-testid="dm-tab-direct"
            >
              <span>Cá nhân</span>
              {totalDirectUnread > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    activeDmTab === 'direct'
                      ? 'bg-white text-black'
                      : 'bg-meta text-white'
                  }`}
                >
                  {totalDirectUnread}
                </span>
              )}
            </button>

            <button
              role="tab"
              aria-selected={activeDmTab === 'group'}
              onClick={() => setActiveDmTab('group')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-[13px] font-semibold transition-all focus:outline-none ${
                activeDmTab === 'group'
                  ? 'bg-ink text-paper shadow-sm'
                  : 'text-graphite hover:text-ink'
              }`}
              data-testid="dm-tab-group"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Nhóm</span>
              {totalGroupUnread > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    activeDmTab === 'group'
                      ? 'bg-white text-black'
                      : 'bg-meta text-white'
                  }`}
                >
                  {totalGroupUnread}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search filter input */}
        <div className="px-4 py-2.5 border-b border-cloud bg-paper">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-ash absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder={
                activeDmTab === 'direct'
                  ? 'Tìm kiếm cuộc trò chuyện cá nhân...'
                  : 'Tìm kiếm nhóm trò chuyện...'
              }
              className="w-full pl-9 pr-8 py-1.5 bg-mist text-[13.5px] text-ink placeholder-ash rounded-full border border-transparent focus:border-meta focus:bg-paper focus:outline-none transition-all"
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                className="absolute right-3 text-ash hover:text-ink"
                aria-label="Xóa bộ lọc"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Conversations List Scrollable */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-ash">
              <Loader2 className="w-6 h-6 animate-spin text-meta" />
              <span className="text-[13px]">Đang tải danh sách...</span>
            </div>
          ) : error ? (
            <div className="p-4 text-center">
              <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" />
              <p className="text-[13px] text-ink mb-2">{error}</p>
              <button
                onClick={() => {
                  loadConversations();
                  loadGroups();
                }}
                className="px-3 py-1 bg-ink text-white text-[12px] rounded-full font-semibold"
              >
                Thử lại
              </button>
            </div>
          ) : activeDmTab === 'direct' ? (
            /* 1-1 DM List */
            filteredConversations.length === 0 ? (
              <div className="py-16 px-4 text-center text-ash">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 stroke-[1.5] text-ash/60" />
                <p className="text-[15px] font-semibold text-ink mb-1">
                  {searchFilter ? 'Không tìm thấy kết quả' : 'Chưa có tin nhắn nào'}
                </p>
                <p className="text-[13px] text-graphite mb-4">
                  {searchFilter
                    ? 'Thử tìm với tên hoặc từ khóa khác'
                    : 'Bắt đầu cuộc trò chuyện với bạn bè hoặc người bạn theo dõi.'}
                </p>
                {!searchFilter && (
                  <button
                    onClick={() => setIsNewDmModalOpen(true)}
                    className="px-4 py-2 bg-ink hover:bg-graphite text-white text-[13px] font-semibold rounded-full transition-all inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Bắt đầu cuộc trò chuyện</span>
                  </button>
                )}
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <DmConversationListItem
                  key={conv.id}
                  conversation={conv}
                  isSelected={activeConversation?.id === conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  currentUserId={currentUser.id}
                />
              ))
            )
          ) : (
            /* Group DM List */
            filteredGroups.length === 0 ? (
              <div className="py-16 px-4 text-center text-ash">
                <Users className="w-10 h-10 mx-auto mb-3 stroke-[1.5] text-ash/60" />
                <p className="text-[15px] font-semibold text-ink mb-1">
                  {searchFilter ? 'Không tìm thấy nhóm phù hợp' : 'Chưa tham gia nhóm nào'}
                </p>
                <p className="text-[13px] text-graphite mb-4">
                  {searchFilter
                    ? 'Thử tìm với tên nhóm khác'
                    : 'Tạo nhóm trò chuyện để kết nối nhiều thành viên cùng lúc.'}
                </p>
                {!searchFilter && (
                  <button
                    onClick={() => setIsCreateGroupModalOpen(true)}
                    className="px-4 py-2 bg-ink hover:bg-graphite text-white text-[13px] font-semibold rounded-full transition-all inline-flex items-center gap-1.5"
                    data-testid="empty-create-group-btn"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tạo nhóm trò chuyện</span>
                  </button>
                )}
              </div>
            ) : (
              filteredGroups.map((group) => (
                <GroupConversationListItem
                  key={group.id}
                  group={group}
                  isSelected={activeGroup?.id === group.id}
                  onClick={() => handleSelectGroup(group)}
                  currentUserId={currentUser.id}
                />
              ))
            )
          )}
        </div>
      </aside>

      {/* RIGHT COLUMN: Chat Window or Empty Placeholder */}
      <main
        className={`flex-1 flex flex-col min-w-0 h-full bg-paper ${
          !isChatActive ? 'hidden md:flex' : 'flex'
        }`}
      >
        {activeGroup ? (
          <GroupDmConversationView
            group={activeGroup}
            onBack={() => setActiveGroup(null)}
            onGroupUpdated={handleGroupUpdated}
            onLeaveGroup={() => {
              setActiveGroup(null);
              loadGroups();
            }}
          />
        ) : activeConversation ? (
          <DmChatWindow
            conversation={activeConversation}
            onBack={() => setActiveConversation(null)}
            onConversationUpdated={handleConversationUpdated}
          />
        ) : (
          /* Empty placeholder when no conversation is selected */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-paper">
            <div className="w-16 h-16 rounded-full bg-mist flex items-center justify-center text-ink mb-4 shadow-sm">
              <MessageSquare className="w-8 h-8 stroke-[1.8]" />
            </div>
            <h3 className="text-[18px] font-bold text-ink mb-1">
              Tin nhắn & Nhóm trò chuyện
            </h3>
            <p className="text-[14px] text-graphite max-w-sm mb-6 leading-relaxed">
              Gửi tin nhắn riêng tư hoặc tạo nhóm trao đổi thời gian thực cùng bạn bè trên Pulse.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsNewDmModalOpen(true)}
                className="px-5 py-2.5 bg-ink hover:bg-graphite text-white text-[14px] font-semibold rounded-full transition-all shadow-sm hover:scale-105 active:scale-95"
              >
                Soạn tin nhắn mới
              </button>

              <button
                onClick={() => setIsCreateGroupModalOpen(true)}
                className="px-5 py-2.5 bg-mist hover:bg-cloud/60 text-ink text-[14px] font-semibold rounded-full transition-all border border-cloud"
              >
                Tạo nhóm mới
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 1-1 New DM Modal */}
      <NewDmModal
        isOpen={isNewDmModalOpen}
        onClose={() => setIsNewDmModalOpen(false)}
        onConversationCreated={(newConv: DmConversationDto) => {
          setActiveConversation(newConv);
          setActiveGroup(null);
          setActiveDmTab('direct');
          setConversations((prev) => {
            const exists = prev.some((c: DmConversationDto) => c.id === newConv.id);
            return exists ? prev.map((c) => (c.id === newConv.id ? newConv : c)) : [newConv, ...prev];
          });
        }}
      />

      {/* Create Group Modal (TASK-20) */}
      <CreateGroupModal
        isOpen={isCreateGroupModalOpen}
        onClose={() => setIsCreateGroupModalOpen(false)}
        onGroupCreated={(newGroup: GroupConversationDto) => {
          setActiveGroup(newGroup);
          setActiveConversation(null);
          setActiveDmTab('group');
          setGroupConversations((prev) => {
            const exists = prev.some((g: GroupConversationDto) => g.id === newGroup.id);
            return exists ? prev.map((g) => (g.id === newGroup.id ? newGroup : g)) : [newGroup, ...prev];
          });
        }}
      />
    </div>
  );
};
