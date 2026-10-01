import React, { useState, useEffect, useRef } from 'react';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { X, Upload, Loader2, AlertCircle, Lock } from 'lucide-react';

export const EditProfileModal: React.FC = () => {
  const {
    currentUser,
    isEditProfileOpen,
    setIsEditProfileOpen,
    updateProfile,
    addToast,
  } = usePulse();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_BIO_LENGTH = 160;

  // Initialize form fields when opened
  useEffect(() => {
    if (isEditProfileOpen && currentUser) {
      setDisplayName(currentUser.displayName || '');
      setBio(currentUser.bio || '');
      setAvatarUrl(currentUser.avatarUrl || null);
      setIsPrivate(Boolean(currentUser.isPrivate));
      setErrorMessage(null);
      setIsSaving(false);
      setIsUploading(false);
    }
  }, [isEditProfileOpen, currentUser]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isEditProfileOpen && !isSaving && !isUploading) {
        setIsEditProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditProfileOpen, isSaving, isUploading, setIsEditProfileOpen]);

  if (!isEditProfileOpen) return null;

  const handleClose = () => {
    if (isSaving || isUploading) return;
    setIsEditProfileOpen(false);
    setErrorMessage(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      addToast('Vui lòng chọn một tệp hình ảnh hợp lệ.', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      addToast('Kích thước ảnh không được vượt quá 5MB.', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);

    try {
      const uploadedUrl = await api.uploadMedia(file);
      setAvatarUrl(uploadedUrl);
      addToast('Tải ảnh đại diện mới thành công!', 'success');
    } catch (err: any) {
      console.error('Failed to upload avatar:', err);
      setErrorMessage(err.message || 'Không thể tải ảnh lên. Vui lòng thử lại.');
      addToast('Tải ảnh đại diện thất bại', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isUploading) return;

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setErrorMessage('Tên hiển thị không được để trống.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await updateProfile({
        displayName: trimmedName,
        bio: bio.trim(),
        avatarUrl: avatarUrl || undefined,
        isPrivate,
      });
      // updateProfile sets currentUser and closes modal inside context
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setErrorMessage(err.message || 'Cập nhật hồ sơ thất bại. Vui lòng thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
    >
      <div className="w-full max-w-lg bg-paper border border-cloud rounded-[18px] shadow-[0_0_24px_rgba(0,0,0,0.12)] overflow-hidden animate-scale-up">
        {/* Modal Header (~53px tall, Paper White #fafafa, border-b border-cloud) */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-cloud bg-paper">
          <div className="w-8" />
          <h2 id="edit-profile-title" className="text-[15px] font-semibold text-ink">
            Chỉnh sửa hồ sơ
          </h2>
          <button
            onClick={handleClose}
            disabled={isSaving || isUploading}
            className="w-8 h-8 flex items-center justify-center text-ash hover:text-ink rounded-full hover:bg-mist transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-mist border border-cloud rounded-xl flex items-start gap-2.5 text-[13px] text-ink">
            <AlertCircle className="w-4 h-4 text-ink shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Avatar Editor */}
          <div className="flex items-center gap-4 p-3.5 bg-card border border-cloud rounded-xl">
            <div className="relative">
              <img
                src={
                  avatarUrl ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
                }
                alt={displayName || currentUser.username}
                className="w-16 h-16 rounded-full object-cover border border-cloud bg-mist"
              />
              {isUploading && (
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-paper animate-spin" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-ink truncate">
                {currentUser.displayName}
              </div>
              <div className="text-[13px] text-ash truncate">
                @{currentUser.username}
              </div>
            </div>

            <div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isSaving}
                className="px-4 py-1.5 rounded-full border border-cloud hover:border-ink text-[13px] font-semibold text-ink hover:bg-mist transition-colors flex items-center gap-1.5 focus:outline-none disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang tải...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Thay đổi ảnh</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Display Name Input */}
          <div>
            <label
              htmlFor="edit-display-name"
              className="block text-[13px] font-semibold text-ink mb-1.5"
            >
              Tên hiển thị
            </label>
            <input
              id="edit-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tên của bạn"
              maxLength={50}
              disabled={isSaving || isUploading}
              className="w-full px-3.5 py-2.5 bg-card border border-cloud rounded-xl text-[15px] text-ink placeholder-ash focus:outline-none focus:border-ink focus:ring-1 focus:ring-ink transition-colors"
            />
          </div>

          {/* Bio Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="edit-bio"
                className="text-[13px] font-semibold text-ink"
              >
                Tiểu sử
              </label>
              <span className="text-[12px] text-ash">
                {bio.length} / {MAX_BIO_LENGTH}
              </span>
            </div>
            <textarea
              id="edit-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Viết một vài dòng giới thiệu về bản thân..."
              maxLength={MAX_BIO_LENGTH}
              rows={3}
              disabled={isSaving || isUploading}
              className="w-full px-3.5 py-2.5 bg-card border border-cloud rounded-xl text-[15px] text-ink placeholder-ash focus:outline-none focus:border-ink focus:ring-1 focus:ring-ink transition-colors resize-none"
            />
          </div>

          {/* TASK-21: Privacy Settings */}
          <div className="pt-2 border-t border-cloud/80">
            <div className="text-[13px] font-semibold text-ink mb-2 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-ink" />
              <span>Cài đặt quyền riêng tư</span>
            </div>
            <div className="flex items-center justify-between p-3.5 bg-card border border-cloud rounded-xl">
              <div className="flex-1 pr-4">
                <label
                  htmlFor="edit-is-private"
                  className="text-[14px] font-semibold text-ink block cursor-pointer"
                >
                  Tài khoản riêng tư
                </label>
                <p className="text-[12px] text-graphite leading-snug mt-0.5">
                  Khi bật, chỉ những người bạn phê duyệt mới xem được bài viết của bạn.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input
                  id="edit-is-private"
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  disabled={isSaving || isUploading}
                  className="sr-only peer"
                  data-testid="edit-profile-private-toggle"
                />
                <div className="w-11 h-6 bg-mist peer-focus:outline-none rounded-full peer border border-cloud peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ink peer-checked:border-ink"></div>
              </label>
            </div>
          </div>

          {/* Pill "Lưu thay đổi" button */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSaving || isUploading}
              className="px-5 py-2 rounded-full border border-cloud hover:border-ink text-[13px] font-semibold text-ink hover:bg-mist transition-colors focus:outline-none disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSaving || isUploading}
              className="px-6 py-2 rounded-full bg-ink text-paper text-[13px] font-semibold hover:bg-ink/85 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2 focus:outline-none"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-paper" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <span>Lưu thay đổi</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
