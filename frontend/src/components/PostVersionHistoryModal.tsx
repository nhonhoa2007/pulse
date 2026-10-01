import React, { useState, useEffect } from 'react';
import { PostVersionsResponse, PostVersionDto } from '../types/PulseTypes';
import { api } from '../api/PulseApiClient';
import { formatRelativeTime } from '../utils/formatters';
import { X, History, AlertCircle, EyeOff, Loader2 } from 'lucide-react';

export interface PostVersionHistoryModalProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const PostVersionHistoryModal: React.FC<PostVersionHistoryModalProps> = ({
  postId,
  isOpen,
  onClose,
}) => {
  const [data, setData] = useState<PostVersionsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !postId) return;

    let ignore = false;
    setIsLoading(true);
    setError(null);

    api
      .getPostVersions(postId)
      .then((res) => {
        if (!ignore) {
          setData(res);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error('Failed to fetch post versions:', err);
          setError(err.message || 'Không thể tải lịch sử chỉnh sửa.');
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [isOpen, postId]);

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

  if (!isOpen) return null;

  // Combine and sort versions chronologically (version 1, 2, 3...)
  const historicalVersions: PostVersionDto[] = data?.versions
    ? [...data.versions].sort((a, b) => a.versionNumber - b.versionNumber)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 md:pt-20 px-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        data-testid="version-history-modal"
        className="w-full max-w-lg bg-[#fafafa] border border-[#d5d5d5] rounded-[18px] shadow-2xl overflow-hidden animate-scale-up max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-[#d5d5d5] bg-[#fafafa] shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[#000000]" />
            <span className="text-[15px] font-semibold text-[#000000]">
              Lịch sử chỉnh sửa
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

        {/* Content list */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-[#71717a] gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#000000]" />
              <span className="text-[13px]">Đang tải lịch sử phiên bản...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-[12px] bg-[#fee2e2] border border-[#fecaca] text-[#991b1b] text-center space-y-2">
              <AlertCircle className="w-6 h-6 mx-auto text-[#dc2626]" />
              <p className="text-[13px]">{error}</p>
              <button
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  api.getPostVersions(postId).then(setData).catch(e => setError(e.message)).finally(() => setIsLoading(false));
                }}
                className="px-3 py-1 bg-white text-[12px] font-semibold rounded-full border border-[#fecaca] shadow-xs hover:bg-gray-50"
              >
                Thử lại
              </button>
            </div>
          ) : historicalVersions.length === 0 && !data?.current ? (
            <div className="py-12 text-center text-[#71717a] text-[13px]">
              Chưa có phiên bản chỉnh sửa nào được ghi lại.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Historical versions list (version 1, 2, ...) */}
              {historicalVersions.map((version) => (
                <div
                  key={version.id}
                  data-testid={`version-item-${version.versionNumber}`}
                  className="p-3.5 rounded-[12px] border border-[#d5d5d5] bg-white space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span
                      data-testid={`version-badge-${version.versionNumber}`}
                      className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#efefef] text-[#000000] border border-[#d5d5d5]"
                    >
                      Phiên bản {version.versionNumber}
                    </span>
                    <time
                      dateTime={version.createdAt}
                      className="text-[12px] text-[#71717a]"
                    >
                      {formatRelativeTime(version.createdAt)}
                    </time>
                  </div>

                  {version.contentWarning && (
                    <div className="flex items-center gap-1.5 text-[12px] text-[#b45309] bg-[#fef3c7] px-2.5 py-1 rounded-[8px] font-medium">
                      <EyeOff className="w-3.5 h-3.5 shrink-0" />
                      <span>Cảnh báo: {version.contentWarning}</span>
                    </div>
                  )}

                  <p className="text-[14px] leading-[1.4] text-[#000000] whitespace-pre-line break-words font-normal">
                    {version.content}
                  </p>
                </div>
              ))}

              {/* Current Version */}
              {data?.current && (
                <div
                  data-testid="current-version-item"
                  className="p-3.5 rounded-[12px] border-2 border-[#000000]/30 bg-white space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span
                      data-testid="current-version-badge"
                      className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#000000] text-[#fafafa]"
                    >
                      Phiên bản {data.current.versionNumber} (Hiện tại)
                    </span>
                    {data.current.editedAt && (
                      <time
                        dateTime={data.current.editedAt}
                        className="text-[12px] text-[#71717a]"
                      >
                        {formatRelativeTime(data.current.editedAt)}
                      </time>
                    )}
                  </div>

                  {data.current.contentWarning && (
                    <div className="flex items-center gap-1.5 text-[12px] text-[#b45309] bg-[#fef3c7] px-2.5 py-1 rounded-[8px] font-medium">
                      <EyeOff className="w-3.5 h-3.5 shrink-0" />
                      <span>Cảnh báo: {data.current.contentWarning}</span>
                    </div>
                  )}

                  <p className="text-[14px] leading-[1.4] text-[#000000] whitespace-pre-line break-words font-normal">
                    {data.current.content}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
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
