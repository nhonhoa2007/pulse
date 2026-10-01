import React, { useState } from 'react';
import { usePulse } from '../../context/PulseContext';
import { api } from '../../api/PulseApiClient';
import { GroupConversationDto, UserDto } from '../../types/PulseTypes';
import {
  X,
  Users,
  Shield,
  UserPlus,
  UserMinus,
  LogOut,
  Loader2,
  AlertCircle,
  Search,
} from 'lucide-react';

interface GroupMembersModalProps {
  group: GroupConversationDto;
  isOpen: boolean;
  onClose: () => void;
  onGroupUpdated: (updated: GroupConversationDto) => void;
  onLeftGroup: () => void;
}

export const GroupMembersModal: React.FC<GroupMembersModalProps> = ({
  group,
  isOpen,
  onClose,
  onGroupUpdated,
  onLeftGroup,
}) => {
  const { currentUser, users, addToast } = usePulse();
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'add'>('list');
  const [searchMemberQuery, setSearchMemberQuery] = useState('');
  const [searchAddQuery, setSearchAddQuery] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentMember = group.members.find((m) => m.userId === currentUser.id);
  const isAdmin = currentMember?.role === 'ADMIN' || group.creatorId === currentUser.id;

  // Existing member IDs in group
  const existingMemberIds = new Set(group.members.map((m) => m.userId));

  // Users eligible to be added (exclude current members)
  const eligibleUsersToAdd = users.filter((u) => !existingMemberIds.has(u.id));

  // Filter existing members
  const filteredMembers = group.members.filter((m) => {
    const q = searchMemberQuery.toLowerCase().trim();
    if (!q) return true;
    const name = m.user.displayName.toLowerCase();
    const uname = m.user.username.toLowerCase();
    return name.includes(q) || uname.includes(q);
  });

  // Filter users to add
  const filteredUsersToAdd = eligibleUsersToAdd.filter((u) => {
    const q = searchAddQuery.toLowerCase().trim();
    if (!q) return true;
    const name = u.displayName.toLowerCase();
    const uname = u.username.toLowerCase();
    return name.includes(q) || uname.includes(q);
  });

  // Handle Remove / Kick member
  const handleKickMember = async (userId: string, displayName: string) => {
    if (!window.confirm(`Bạn có chắc muốn xóa "${displayName}" khỏi nhóm?`)) {
      return;
    }

    setActionLoadingId(userId);
    setErrorMessage(null);

    try {
      await api.removeGroupMember(group.id, userId);
      addToast(`Đã xóa "${displayName}" khỏi nhóm`, 'info');

      // Update local state
      const updatedMembers = group.members.filter((m) => m.userId !== userId);
      onGroupUpdated({
        ...group,
        members: updatedMembers,
      });
    } catch (err: any) {
      console.error('Failed to kick member:', err);
      const msg = err.message || 'Không thể xóa thành viên khỏi nhóm.';
      setErrorMessage(msg);
      addToast(msg, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle Add Member
  const handleAddMember = async (user: UserDto) => {
    setActionLoadingId(user.id);
    setErrorMessage(null);

    try {
      const addedMember = await api.addGroupMember(group.id, {
        userId: user.id,
      });

      addToast(`Đã thêm "${user.displayName}" vào nhóm`, 'success');

      // Refresh or append member
      const memberItem = addedMember || {
        id: `member-${user.id}`,
        conversationId: group.id,
        userId: user.id,
        role: 'MEMBER' as const,
        joinedAt: new Date().toISOString(),
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
      };

      const updatedMembers = [...group.members, memberItem];
      onGroupUpdated({
        ...group,
        members: updatedMembers,
      });

      setActiveSubTab('list');
    } catch (err: any) {
      console.error('Failed to add member:', err);
      const msg = err.message || 'Không thể thêm thành viên vào nhóm.';
      setErrorMessage(msg);
      addToast(msg, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle Leave Group
  const handleLeaveGroup = async () => {
    if (!window.confirm(`Bạn có chắc muốn rời khỏi nhóm "${group.title}" không?`)) {
      return;
    }

    setIsLeaving(true);
    setErrorMessage(null);

    try {
      await api.leaveGroup(group.id);
      addToast(`Bạn đã rời khỏi nhóm "${group.title}"`, 'info');
      onLeftGroup();
      onClose();
    } catch (err: any) {
      console.error('Failed to leave group:', err);
      const msg = err.message || 'Không thể rời nhóm. Vui lòng thử lại.';
      setErrorMessage(msg);
      addToast(msg, 'error');
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-members-title"
    >
      <div className="w-full max-w-md bg-[#fafafa] border border-[#d5d5d5] rounded-[18px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-up">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#d5d5d5]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#efefef] flex items-center justify-center text-[#000000]">
              <Users className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h2 id="group-members-title" className="text-[17px] font-semibold text-[#000000]">
                Thành viên nhóm
              </h2>
              <p className="text-[12px] text-[#737373]">
                {group.title} ({group.members.length} người)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#969696] hover:text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-tab Navigation: List vs Add (if Admin) */}
        {isAdmin && (
          <div className="flex border-b border-[#d5d5d5] bg-[#fafafa]">
            <button
              onClick={() => setActiveSubTab('list')}
              className={`flex-1 py-2.5 text-center text-[13px] font-semibold transition-colors focus:outline-none ${
                activeSubTab === 'list'
                  ? 'text-[#000000] border-b-2 border-[#000000]'
                  : 'text-[#969696] hover:text-[#000000]'
              }`}
            >
              Danh sách ({group.members.length})
            </button>
            <button
              onClick={() => setActiveSubTab('add')}
              className={`flex-1 py-2.5 text-center text-[13px] font-semibold transition-colors focus:outline-none flex items-center justify-center gap-1.5 ${
                activeSubTab === 'add'
                  ? 'text-[#000000] border-b-2 border-[#000000]'
                  : 'text-[#969696] hover:text-[#000000]'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Thêm thành viên</span>
            </button>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-[12px] flex items-center gap-2 text-red-700 text-[13px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Tab 1: Member List View */}
        {activeSubTab === 'list' ? (
          <>
            {/* Search Filter in List */}
            {group.members.length > 5 && (
              <div className="px-4 py-2 border-b border-[#d5d5d5]/50">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-[#969696] absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={searchMemberQuery}
                    onChange={(e) => setSearchMemberQuery(e.target.value)}
                    placeholder="Tìm thành viên trong nhóm..."
                    className="w-full pl-8 pr-3 py-1.5 bg-[#efefef] text-[13px] rounded-full border border-transparent focus:border-[#385898] focus:bg-[#fafafa] focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Scrollable Members List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 divide-y divide-[#d5d5d5]/40">
              {filteredMembers.map((member) => {
                const isMemberAdmin = member.role === 'ADMIN' || member.userId === group.creatorId;
                const isMe = member.userId === currentUser.id;
                const canKick = isAdmin && !isMe;
                const isLoadingAction = actionLoadingId === member.userId;

                return (
                  <div
                    key={member.id || member.userId}
                    className="flex items-center justify-between py-2.5 px-2 hover:bg-[#efefef]/50 rounded-xl transition-colors"
                    data-testid={`member-row-${member.userId}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={
                          member.user.avatarUrl ||
                          `https://api.dicebear.com/7.x/bottts/svg?seed=${member.user.username}`
                        }
                        alt={member.user.displayName}
                        className="w-10 h-10 rounded-full object-cover border border-[#d5d5d5]"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-semibold text-[#000000] truncate">
                            {member.user.displayName}
                          </span>
                          {isMe && (
                            <span className="text-[11px] text-[#737373] bg-[#efefef] px-1.5 py-0.2 rounded-full">
                              Bạn
                            </span>
                          )}
                        </div>
                        <span className="text-[12px] text-[#969696] truncate block">
                          @{member.user.username}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role Badge */}
                      {isMemberAdmin ? (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#000000] text-white"
                          title="Trưởng nhóm"
                        >
                          <Shield className="w-3 h-3" />
                          <span>Admin</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium text-[#737373] bg-[#efefef] border border-[#d5d5d5]/50">
                          Thành viên
                        </span>
                      )}

                      {/* Kick Button for Admin */}
                      {canKick && (
                        <button
                          type="button"
                          onClick={() => handleKickMember(member.userId, member.user.displayName)}
                          disabled={isLoadingAction}
                          className="p-1.5 text-[#969696] hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                          title={`Xóa ${member.user.displayName} khỏi nhóm`}
                          aria-label={`Xóa ${member.user.displayName} khỏi nhóm`}
                          data-testid={`kick-member-${member.userId}`}
                        >
                          {isLoadingAction ? (
                            <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                          ) : (
                            <UserMinus className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Leave Group Action Footer */}
            <div className="p-3 border-t border-[#d5d5d5] bg-[#fafafa] flex items-center justify-between">
              <button
                type="button"
                onClick={handleLeaveGroup}
                disabled={isLeaving}
                className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50 rounded-full transition-colors"
                data-testid="leave-group-btn"
              >
                {isLeaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                <span>Rời nhóm</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 text-[13px] font-semibold text-[#424242] hover:text-[#000000] rounded-full hover:bg-[#efefef] transition-colors"
              >
                Đóng
              </button>
            </div>
          </>
        ) : (
          /* Tab 2: Add New Member View */
          <>
            <div className="p-3 border-b border-[#d5d5d5]/50">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[#969696] absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchAddQuery}
                  onChange={(e) => setSearchAddQuery(e.target.value)}
                  placeholder="Tìm người dùng để thêm vào nhóm..."
                  className="w-full pl-8 pr-3 py-1.5 bg-[#efefef] text-[13px] rounded-full border border-transparent focus:border-[#385898] focus:bg-[#fafafa] focus:outline-none"
                  data-testid="add-member-search-input"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1 divide-y divide-[#d5d5d5]/40">
              {filteredUsersToAdd.length === 0 ? (
                <div className="py-8 text-center text-[#969696] text-[13px]">
                  Không tìm thấy người dùng khả dụng để thêm
                </div>
              ) : (
                filteredUsersToAdd.map((user) => {
                  const isAdding = actionLoadingId === user.id;
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between py-2 px-2 hover:bg-[#efefef]/50 rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={
                            user.avatarUrl ||
                            `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                          }
                          alt={user.displayName}
                          className="w-9 h-9 rounded-full object-cover border border-[#d5d5d5]"
                        />
                        <div className="min-w-0">
                          <span className="text-[13.5px] font-semibold text-[#000000] truncate block">
                            {user.displayName}
                          </span>
                          <span className="text-[11.5px] text-[#969696] truncate block">
                            @{user.username}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddMember(user)}
                        disabled={isAdding}
                        className="px-3 py-1 bg-[#000000] hover:bg-[#424242] text-white text-[12px] font-semibold rounded-full transition-all flex items-center gap-1.5"
                        data-testid={`add-user-btn-${user.id}`}
                      >
                        {isAdding ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5" />
                        )}
                        <span>Thêm</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-3 border-t border-[#d5d5d5] bg-[#fafafa] flex justify-end">
              <button
                type="button"
                onClick={() => setActiveSubTab('list')}
                className="px-4 py-1.5 text-[13px] font-semibold text-[#424242] hover:text-[#000000] rounded-full hover:bg-[#efefef] transition-colors"
              >
                Quay lại danh sách
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
