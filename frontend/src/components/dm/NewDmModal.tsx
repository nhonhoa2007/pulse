import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePulse } from '../../context/PulseContext';
import { api } from '../../api/PulseApiClient';
import { UserDto, DmConversationDto } from '../../types/PulseTypes';
import { VerifiedBadge } from '../VerifiedBadge';
import { X, Search, MessageSquare, Loader2, AlertCircle } from 'lucide-react';

interface NewDmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConversationCreated: (conversation: DmConversationDto) => void;
}

export const NewDmModal: React.FC<NewDmModalProps> = ({
  isOpen,
  onClose,
  onConversationCreated,
}) => {
  const { currentUser, users, addToast } = usePulse();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedUserId(null);
      setErrorMessage(null);
      setTimeout(() => {
        searchInputRef.current?.focus();
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

  // Filter available users (exclude current user)
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return users.filter((u) => {
      if (u.id === currentUser.id) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        (u.bio && u.bio.toLowerCase().includes(q))
      );
    });
  }, [users, currentUser.id, searchQuery]);

  if (!isOpen) return null;

  const handleStartConversation = async (targetUser: UserDto) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setSelectedUserId(targetUser.id);
    setErrorMessage(null);

    try {
      const conv = await api.getOrCreateDmConversation(targetUser.id);
      addToast(`Đã mở cuộc trò chuyện với ${targetUser.displayName}`, 'success');
      onConversationCreated(conv);
      onClose();
    } catch (err: any) {
      console.error('Failed to create/open DM conversation:', err);
      const msg = err.message || 'Không thể tạo cuộc trò chuyện với người dùng này.';
      setErrorMessage(msg);
      addToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
      setSelectedUserId(null);
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
      aria-labelledby="new-dm-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md bg-paper border border-cloud rounded-[18px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-up"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cloud">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-mist flex items-center justify-center text-meta">
              <MessageSquare className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h2 id="new-dm-title" className="text-[17px] font-semibold text-ink">
              Tin nhắn mới
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ash hover:text-ink hover:bg-mist transition-colors focus:outline-none"
            aria-label="Đóng modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input bar */}
        <div className="p-4 border-b border-cloud bg-paper">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-ash absolute left-3 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo tên hoặc @username..."
              className="w-full pl-9 pr-8 py-2 bg-mist text-[14px] text-ink placeholder-ash rounded-full border border-transparent focus:border-meta focus:bg-paper focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 text-ash hover:text-ink"
                aria-label="Xóa tìm kiếm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Error banner if any */}
        {errorMessage && (
          <div className="mx-4 mt-3 p-3 rounded-[10px] bg-[#fdf2f2] border border-[#f8b4b4] text-[#9b1c1c] text-[13px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Users list */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-mist">
          {filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-ash">
              <Search className="w-8 h-8 mx-auto mb-2 stroke-[1.5] text-ash/60" />
              <p className="text-[14px] font-medium text-graphite">Không tìm thấy người dùng nào</p>
              <p className="text-[12px] mt-0.5">Thử tìm với từ khóa khác</p>
            </div>
          ) : (
            filteredUsers.map((user) => {
              const isCurrentSelected = selectedUserId === user.id;
              const isTargetBlocked = !!user.isBlocked;

              return (
                <button
                  key={user.id}
                  disabled={isSubmitting || isTargetBlocked}
                  onClick={() => handleStartConversation(user)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-all ${
                    isTargetBlocked
                      ? 'opacity-50 cursor-not-allowed bg-mist/40'
                      : 'hover:bg-mist active:scale-[0.99] cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={
                        user.avatarUrl ||
                        `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                      }
                      alt={user.displayName}
                      className="w-11 h-11 rounded-full object-cover shrink-0 border border-cloud"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-semibold text-ink truncate">
                          {user.displayName}
                        </span>
                        {user.isCelebrity && (
                          <VerifiedBadge size={13} title="VIP Verified" />
                        )}
                        {isTargetBlocked && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-md font-medium">
                            Đã chặn
                          </span>
                        )}
                      </div>
                      <span className="text-[12px] text-graphite block truncate">
                        @{user.username}
                      </span>
                      {user.bio && (
                        <p className="text-[12px] text-ash line-clamp-1 mt-0.5">
                          {user.bio}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 ml-3">
                    {isCurrentSelected ? (
                      <Loader2 className="w-5 h-5 text-meta animate-spin" />
                    ) : (
                      <div className="px-3 py-1.5 rounded-full bg-ink hover:bg-graphite text-paper text-[12px] font-semibold transition-colors">
                        Nhắn tin
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-cloud bg-paper text-center">
          <p className="text-[12px] text-ash">
            Chọn một người dùng để bắt đầu cuộc trò chuyện trực tiếp 1-1 an toàn.
          </p>
        </div>
      </div>
    </div>
  );
};
