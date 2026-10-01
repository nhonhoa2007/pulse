import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePulse } from '../../context/PulseContext';
import { api } from '../../api/PulseApiClient';
import { GroupConversationDto } from '../../types/PulseTypes';
import { VerifiedBadge } from '../VerifiedBadge';
import { X, Search, Users, Loader2, Check, AlertCircle } from 'lucide-react';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated: (group: GroupConversationDto) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  onGroupCreated,
}) => {
  const { currentUser, users, addToast } = usePulse();
  const [groupTitle, setGroupTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setGroupTitle('');
      setSearchQuery('');
      setSelectedUserIds(new Set());
      setErrorMessage(null);
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Available users (exclude current user)
  const availableUsers = useMemo(() => {
    return users.filter((u) => u.id !== currentUser.id);
  }, [users, currentUser.id]);

  // Filter users by search query
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return availableUsers;
    return availableUsers.filter((u) => {
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        (u.bio && u.bio.toLowerCase().includes(q))
      );
    });
  }, [availableUsers, searchQuery]);

  // Selected user objects for chip display
  const selectedUsers = useMemo(() => {
    return availableUsers.filter((u) => selectedUserIds.has(u.id));
  }, [availableUsers, selectedUserIds]);

  if (!isOpen) return null;

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
    setErrorMessage(null);
  };

  const removeSelectedUser = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  const isFormValid = groupTitle.trim().length > 0 && selectedUserIds.size >= 1;

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    const trimmedTitle = groupTitle.trim();
    if (trimmedTitle.length === 0) {
      setErrorMessage('Vui lòng nhập tên nhóm.');
      return;
    }

    if (trimmedTitle.length > 100) {
      setErrorMessage('Tên nhóm không được vượt quá 100 ký tự.');
      return;
    }

    if (selectedUserIds.size === 0) {
      setErrorMessage('Vui lòng chọn ít nhất 1 thành viên để tạo nhóm.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const created = await api.createGroupConversation({
        title: trimmedTitle,
        memberIds: Array.from(selectedUserIds),
      });

      addToast(`Đã tạo nhóm "${trimmedTitle}" thành công! 🎉`, 'success');
      onGroupCreated(created);
      onClose();
    } catch (err: any) {
      console.error('Failed to create group conversation:', err);
      const msg = err.message || 'Không thể tạo nhóm trò chuyện. Vui lòng thử lại.';
      setErrorMessage(msg);
      addToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
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
      aria-labelledby="create-group-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg bg-[#fafafa] border border-[#d5d5d5] rounded-[18px] shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-scale-up"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#d5d5d5]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#efefef] flex items-center justify-center text-[#000000]">
              <Users className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h2 id="create-group-title" className="text-[17px] font-semibold text-[#000000]">
              Tạo nhóm trò chuyện
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#969696] hover:text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCreateGroup} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-4 border-b border-[#d5d5d5]/60">
            {/* Group Name Field */}
            <div>
              <label
                htmlFor="group-name-input"
                className="block text-[13px] font-semibold text-[#000000] mb-1.5"
              >
                Tên nhóm <span className="text-red-500">*</span>
              </label>
              <input
                id="group-name-input"
                ref={titleInputRef}
                type="text"
                value={groupTitle}
                onChange={(e) => {
                  setGroupTitle(e.target.value);
                  setErrorMessage(null);
                }}
                maxLength={100}
                placeholder="Ví dụ: Team Dự Án, Hội Lập Trình Viên..."
                className="w-full px-3.5 py-2.5 bg-[#efefef] text-[14px] text-[#000000] placeholder-[#969696] rounded-[12px] border border-transparent focus:border-[#385898] focus:bg-[#fafafa] focus:outline-none transition-all"
                data-testid="group-title-input"
              />
              <div className="flex justify-between items-center mt-1 text-[11px] text-[#969696]">
                <span>Tên nhóm sẽ hiển thị với tất cả thành viên</span>
                <span>{groupTitle.length}/100</span>
              </div>
            </div>

            {/* Selected Members Chips */}
            {selectedUsers.length > 0 && (
              <div>
                <div className="flex items-center justify-between text-[12px] text-[#737373] mb-1.5">
                  <span className="font-semibold text-[#000000]">
                    Đã chọn ({selectedUsers.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedUserIds(new Set())}
                    className="text-[#385898] hover:underline"
                  >
                    Bỏ chọn tất cả
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 bg-[#efefef]/40 rounded-[12px] border border-[#d5d5d5]/50">
                  {selectedUsers.map((user) => (
                    <div
                      key={user.id}
                      className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-[#fafafa] border border-[#d5d5d5] rounded-full text-[12px] shadow-sm animate-scale-up"
                    >
                      <img
                        src={
                          user.avatarUrl ||
                          `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                        }
                        alt={user.displayName}
                        className="w-4 h-4 rounded-full object-cover"
                      />
                      <span className="font-semibold text-[#000000] truncate max-w-[110px]">
                        {user.displayName}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => removeSelectedUser(user.id, e)}
                        className="p-0.5 text-[#969696] hover:text-[#000000] rounded-full"
                        aria-label={`Xóa ${user.displayName}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Member Search Bar */}
            <div>
              <label className="block text-[13px] font-semibold text-[#000000] mb-1.5">
                Thêm thành viên từ danh sách theo dõi
              </label>
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-[#969696] absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm người dùng theo tên hoặc @username..."
                  className="w-full pl-9 pr-8 py-2 bg-[#efefef] text-[13.5px] text-[#000000] placeholder-[#969696] rounded-full border border-transparent focus:border-[#385898] focus:bg-[#fafafa] focus:outline-none transition-all"
                  data-testid="member-search-input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 text-[#969696] hover:text-[#000000]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="mx-5 my-2 p-3 bg-red-50 border border-red-200 rounded-[12px] flex items-center gap-2 text-red-700 text-[13px]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Members List Scrollable */}
          <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-[#d5d5d5]/50">
            {filteredUsers.length === 0 ? (
              <div className="py-8 text-center text-[#969696] text-[13px]">
                Không tìm thấy người dùng phù hợp
              </div>
            ) : (
              filteredUsers.map((user) => {
                const isSelected = selectedUserIds.has(user.id);
                return (
                  <div
                    key={user.id}
                    onClick={() => toggleUserSelection(user.id)}
                    className="flex items-center justify-between py-2.5 px-2 hover:bg-[#efefef]/60 rounded-xl cursor-pointer transition-colors select-none"
                    data-testid={`user-row-${user.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={
                          user.avatarUrl ||
                          `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                        }
                        alt={user.displayName}
                        className="w-10 h-10 rounded-full object-cover border border-[#d5d5d5]"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[14px] font-semibold text-[#000000] truncate">
                            {user.displayName}
                          </span>
                          {user.isCelebrity && (
                            <VerifiedBadge size={13} title="Verified" />
                          )}
                        </div>
                        <span className="text-[12px] text-[#969696] truncate block">
                          @{user.username}
                        </span>
                      </div>
                    </div>

                    {/* Checkbox indicator */}
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all ${
                        isSelected
                          ? 'bg-[#000000] border-[#000000] text-white'
                          : 'border-[#d5d5d5] bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Modal Footer Actions */}
          <div className="p-4 border-t border-[#d5d5d5] flex items-center justify-between bg-[#fafafa]">
            <span className="text-[12px] text-[#737373]">
              {selectedUserIds.size === 0
                ? 'Hãy chọn ít nhất 1 thành viên'
                : `Đã chọn ${selectedUserIds.size} thành viên`}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-[13px] font-semibold text-[#424242] hover:text-[#000000] hover:bg-[#efefef] rounded-full transition-colors"
              >
                Hủy
              </button>

              <button
                type="submit"
                disabled={!isFormValid || isSubmitting}
                className={`px-5 py-2 text-[13px] font-semibold rounded-full flex items-center gap-2 transition-all ${
                  isFormValid && !isSubmitting
                    ? 'bg-[#000000] hover:bg-[#424242] text-white shadow-sm'
                    : 'bg-[#efefef] text-[#969696] cursor-not-allowed'
                }`}
                data-testid="create-group-submit-btn"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Tạo nhóm</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
