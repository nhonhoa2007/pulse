import React, { useState, useEffect, useCallback } from 'react';
import {
  UserMuteDto,
  KeywordMuteDto,
  MuteMatchType,
  MuteContext,
} from '../types/PulseTypes';
import { api } from '../api/PulseApiClient';
import { usePulse } from '../context/PulseContext';
import {
  formatMuteDuration,
  formatMuteContext,
  formatMatchType,
} from '../utils/trustSafety';
import {
  X,
  VolumeX,
  UserX,
  Tag,
  Plus,
  Trash2,
  Loader2,
  Clock,
} from 'lucide-react';

export interface MuteManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'users' | 'keywords';
}

export const MuteManagementModal: React.FC<MuteManagementModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'users',
}) => {
  const { addToast } = usePulse();

  const [activeTab, setActiveTab] = useState<'users' | 'keywords'>(defaultTab);

  // Muted Users State
  const [mutedUsers, setMutedUsers] = useState<UserMuteDto[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState<boolean>(false);
  const [unmutingUserId, setUnmutingUserId] = useState<string | null>(null);

  // Muted Keywords State
  const [mutedKeywords, setMutedKeywords] = useState<KeywordMuteDto[]>([]);
  const [isKeywordsLoading, setIsKeywordsLoading] = useState<boolean>(false);
  const [deletingKeywordId, setDeletingKeywordId] = useState<string | null>(null);

  // Form: Add Keyword
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [matchType, setMatchType] = useState<MuteMatchType>('CONTAINS');
  const [muteContext, setMuteContext] = useState<MuteContext>('ALL');
  const [durationOption, setDurationOption] = useState<string>('forever'); // '1', '7', '30', 'forever'
  const [isAddingKeyword, setIsAddingKeyword] = useState<boolean>(false);

  // Sync tab on open
  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
    }
  }, [isOpen, defaultTab]);

  // Load Muted Users
  const loadMutedUsers = useCallback(async () => {
    setIsUsersLoading(true);
    try {
      const users = await api.getMutedUsers();
      setMutedUsers(users);
    } catch (err: any) {
      console.error('Failed to load muted users:', err);
      addToast(err.message || 'Không thể tải danh sách tài khoản bị tắt tiếng', 'error');
    } finally {
      setIsUsersLoading(false);
    }
  }, [addToast]);

  // Load Muted Keywords
  const loadMutedKeywords = useCallback(async () => {
    setIsKeywordsLoading(true);
    try {
      const keywords = await api.getMutedKeywords();
      setMutedKeywords(keywords);
    } catch (err: any) {
      console.error('Failed to load muted keywords:', err);
      addToast(err.message || 'Không thể tải danh sách từ khóa bị tắt tiếng', 'error');
    } finally {
      setIsKeywordsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'users') {
        loadMutedUsers();
      } else {
        loadMutedKeywords();
      }
    }
  }, [isOpen, activeTab, loadMutedUsers, loadMutedKeywords]);

  // Handle Unmute User
  const handleUnmute = async (userId: string, username: string) => {
    setUnmutingUserId(userId);
    try {
      await api.unmuteUser(userId);
      setMutedUsers((prev) => prev.filter((item) => item.mutedId !== userId && item.mutedUser?.id !== userId));
      addToast(`Đã bỏ tắt tiếng @${username}`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Không thể bỏ tắt tiếng người dùng', 'error');
    } finally {
      setUnmutingUserId(null);
    }
  };

  // Handle Add Keyword
  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newKeyword.trim();
    if (!trimmed) return;

    setIsAddingKeyword(true);
    try {
      const durationDays =
        durationOption === 'forever' ? undefined : parseInt(durationOption, 10);

      const created = await api.createMutedKeyword({
        keyword: trimmed,
        matchType,
        muteContext,
        durationDays,
      });

      setMutedKeywords((prev) => [created, ...prev]);
      setNewKeyword('');
      addToast(`Đã thêm từ khóa "${trimmed}" vào danh sách tắt tiếng`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Không thể thêm từ khóa tắt tiếng', 'error');
    } finally {
      setIsAddingKeyword(false);
    }
  };

  // Handle Delete Keyword
  const handleDeleteKeyword = async (keywordId: string, kwText: string) => {
    setDeletingKeywordId(keywordId);
    try {
      await api.deleteMutedKeyword(keywordId);
      setMutedKeywords((prev) => prev.filter((k) => k.id !== keywordId));
      addToast(`Đã xóa từ khóa "${kwText}" khỏi danh sách tắt tiếng`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Không thể xóa từ khóa tắt tiếng', 'error');
    } finally {
      setDeletingKeywordId(null);
    }
  };

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 md:pt-18 px-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        data-testid="mute-management-modal"
        className="w-full max-w-xl bg-[#fafafa] border border-[#d5d5d5] rounded-[18px] shadow-2xl overflow-hidden animate-scale-up max-h-[88vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-[#d5d5d5] bg-[#fafafa] shrink-0">
          <div className="flex items-center gap-2">
            <VolumeX className="w-5 h-5 text-[#000000]" />
            <span className="text-[15px] font-semibold text-[#000000]">
              Quản lý tắt tiếng (Mute Management)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#969696] hover:text-[#000000] rounded-full hover:bg-[#efefef] transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-2 border-b border-[#d5d5d5] bg-[#fafafa] text-center text-[14px] shrink-0">
          <button
            type="button"
            data-testid="tab-muted-users"
            onClick={() => setActiveTab('users')}
            className={`py-3 relative font-semibold transition-colors flex items-center justify-center gap-2 focus:outline-none ${
              activeTab === 'users' ? 'text-[#000000]' : 'text-[#71717a] hover:text-[#000000]'
            }`}
          >
            <UserX className="w-4 h-4" />
            <span>Người dùng bị tắt tiếng</span>
            {activeTab === 'users' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-20 h-0.5 bg-[#000000]" />
            )}
          </button>

          <button
            type="button"
            data-testid="tab-muted-keywords"
            onClick={() => setActiveTab('keywords')}
            className={`py-3 relative font-semibold transition-colors flex items-center justify-center gap-2 focus:outline-none ${
              activeTab === 'keywords' ? 'text-[#000000]' : 'text-[#71717a] hover:text-[#000000]'
            }`}
          >
            <Tag className="w-4 h-4" />
            <span>Từ khóa bị tắt tiếng</span>
            {activeTab === 'keywords' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-20 h-0.5 bg-[#000000]" />
            )}
          </button>
        </div>

        {/* Modal Tab Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: MUTED USERS */}
          {activeTab === 'users' && (
            <div className="space-y-3">
              <p className="text-[13px] text-[#71717a]">
                Bài viết và thông báo từ những người dùng này sẽ bị ẩn âm thầm khỏi bảng tin và hộp thư của bạn. Họ sẽ không biết mình bị tắt tiếng.
              </p>

              {isUsersLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-[#71717a] gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#000000]" />
                  <span className="text-[13px]">Đang tải danh sách người dùng...</span>
                </div>
              ) : mutedUsers.length === 0 ? (
                <div className="py-12 text-center text-[#71717a]">
                  <UserX className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-[14px] font-semibold text-[#000000]">
                    Chưa có tài khoản nào bị tắt tiếng
                  </p>
                  <p className="text-[12px] text-[#71717a] mt-1">
                    Bạn có thể tắt tiếng người dùng từ menu 3 chấm trên bài viết của họ.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#d5d5d5] border border-[#d5d5d5] rounded-[14px] bg-white overflow-hidden">
                  {mutedUsers.map((mute) => {
                    const user = mute.mutedUser || {
                      id: mute.mutedId,
                      username: 'user',
                      displayName: 'Người dùng',
                      avatarUrl: null,
                    };
                    const isUnmuting = unmutingUserId === user.id;

                    return (
                      <div
                        key={mute.id}
                        data-testid={`muted-user-item-${user.username}`}
                        className="flex items-center justify-between p-3.5 hover:bg-[#efefef]/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={
                              user.avatarUrl ||
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                            }
                            alt={user.displayName}
                            className="w-10 h-10 rounded-full object-cover shrink-0 border border-[#d5d5d5]"
                          />
                          <div className="min-w-0">
                            <h4 className="text-[14px] font-semibold text-[#000000] truncate">
                              {user.displayName}
                            </h4>
                            <p className="text-[12px] text-[#71717a] truncate">
                              @{user.username}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          data-testid={`unmute-btn-${user.username}`}
                          disabled={isUnmuting}
                          onClick={() => handleUnmute(user.id, user.username)}
                          className="px-3.5 py-1.5 rounded-full border border-[#d5d5d5] text-[13px] font-semibold text-[#000000] hover:bg-[#efefef] transition-all shrink-0 focus:outline-none"
                        >
                          {isUnmuting ? 'Đang gỡ...' : 'Bỏ tắt tiếng'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MUTED KEYWORDS */}
          {activeTab === 'keywords' && (
            <div className="space-y-4">
              {/* Form Add Keyword */}
              <form
                onSubmit={handleAddKeyword}
                data-testid="add-keyword-mute-form"
                className="p-4 rounded-[14px] bg-[#efefef]/60 border border-[#d5d5d5] space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-[#000000]" />
                  <h4 className="text-[14px] font-semibold text-[#000000]">
                    Thêm từ khóa hoặc hashtag cần tắt tiếng
                  </h4>
                </div>

                <div>
                  <input
                    type="text"
                    data-testid="keyword-mute-input"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="Nhập từ khóa hoặc #hashtag (ví dụ: crypto, spoiler...)"
                    className="w-full px-3 py-2 text-[14px] bg-white border border-[#d5d5d5] rounded-[10px] text-[#000000] focus:outline-none focus:ring-1 focus:ring-[#000000]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[13px]">
                  {/* Match Type */}
                  <div>
                    <label className="block text-[12px] font-medium text-[#71717a] mb-1">
                      Loại khớp:
                    </label>
                    <select
                      data-testid="match-type-select"
                      value={matchType}
                      onChange={(e) => setMatchType(e.target.value as MuteMatchType)}
                      className="w-full px-2.5 py-1.5 bg-white border border-[#d5d5d5] rounded-[8px] text-[#000000] focus:outline-none"
                    >
                      <option value="CONTAINS">Khớp một phần (CONTAINS)</option>
                      <option value="EXACT_WORD">Khớp toàn bộ từ (EXACT_WORD)</option>
                    </select>
                  </div>

                  {/* Context */}
                  <div>
                    <label className="block text-[12px] font-medium text-[#71717a] mb-1">
                      Áp dụng cho:
                    </label>
                    <select
                      data-testid="mute-context-select"
                      value={muteContext}
                      onChange={(e) => setMuteContext(e.target.value as MuteContext)}
                      className="w-full px-2.5 py-1.5 bg-white border border-[#d5d5d5] rounded-[8px] text-[#000000] focus:outline-none"
                    >
                      <option value="ALL">Tất cả</option>
                      <option value="HOME_TIMELINE">Chỉ Bảng tin (Home)</option>
                      <option value="NOTIFICATIONS">Chỉ Thông báo</option>
                    </select>
                  </div>

                  {/* Duration */}
                  <div>
                    <label className="block text-[12px] font-medium text-[#71717a] mb-1">
                      Thời hạn:
                    </label>
                    <select
                      data-testid="mute-duration-select"
                      value={durationOption}
                      onChange={(e) => setDurationOption(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-[#d5d5d5] rounded-[8px] text-[#000000] focus:outline-none"
                    >
                      <option value="1">24 giờ (1 ngày)</option>
                      <option value="7">7 ngày</option>
                      <option value="30">30 ngày</option>
                      <option value="forever">Vĩnh viễn</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    data-testid="submit-add-keyword-btn"
                    disabled={isAddingKeyword || !newKeyword.trim()}
                    className={`flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-semibold rounded-full transition-all focus:outline-none ${
                      isAddingKeyword || !newKeyword.trim()
                        ? 'bg-[#d5d5d5] text-[#969696] cursor-not-allowed'
                        : 'bg-[#000000] text-[#fafafa] hover:bg-[#000000]/85 cursor-pointer shadow-xs'
                    }`}
                  >
                    {isAddingKeyword ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    <span>Thêm từ khóa</span>
                  </button>
                </div>
              </form>

              {/* Keywords List */}
              {isKeywordsLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-[#71717a] gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#000000]" />
                  <span className="text-[13px]">Đang tải danh sách từ khóa...</span>
                </div>
              ) : mutedKeywords.length === 0 ? (
                <div className="py-12 text-center text-[#71717a]">
                  <Tag className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-[14px] font-semibold text-[#000000]">
                    Chưa có từ khóa nào bị tắt tiếng
                  </p>
                  <p className="text-[12px] text-[#71717a] mt-1">
                    Nhập từ khóa phía trên để tự động lọc bài viết chứa từ khóa đó.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#d5d5d5] border border-[#d5d5d5] rounded-[14px] bg-white overflow-hidden">
                  {mutedKeywords.map((kw) => {
                    const isDeleting = deletingKeywordId === kw.id;
                    const durationText = formatMuteDuration(kw.expiresAt);

                    return (
                      <div
                        key={kw.id}
                        data-testid={`muted-keyword-item-${kw.keyword}`}
                        className="flex items-center justify-between p-3.5 hover:bg-[#efefef]/40 transition-colors gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[14px] font-semibold text-[#000000]">
                              {kw.keyword}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#efefef] text-[#424242] border border-[#d5d5d5]">
                              {formatMatchType(kw.matchType)}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#efefef] text-[#424242] border border-[#d5d5d5]">
                              {formatMuteContext(kw.muteContext)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[12px] text-[#71717a]">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{durationText}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          data-testid={`delete-keyword-btn-${kw.keyword}`}
                          disabled={isDeleting}
                          onClick={() => handleDeleteKeyword(kw.id, kw.keyword)}
                          className="p-2 text-[#71717a] hover:text-[#dc2626] hover:bg-[#fee2e2] rounded-full transition-colors focus:outline-none shrink-0"
                          title="Xóa từ khóa"
                        >
                          {isDeleting ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[#dc2626]" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-3 border-t border-[#d5d5d5] bg-[#fafafa] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] font-semibold text-[#fafafa] bg-[#000000] hover:bg-[#000000]/85 rounded-full transition-all focus:outline-none"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
