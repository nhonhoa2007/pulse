import React, { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { getContentWarningLabel, shouldShieldPost } from '../utils/trustSafety';

export interface ContentWarningShieldProps {
  isSensitive?: boolean;
  contentWarning?: string | null;
  children: React.ReactNode;
  className?: string;
  defaultRevealed?: boolean;
  onToggleReveal?: (revealed: boolean) => void;
}

export const ContentWarningShield: React.FC<ContentWarningShieldProps> = ({
  isSensitive = false,
  contentWarning = null,
  children,
  className = '',
  defaultRevealed = false,
  onToggleReveal,
}) => {
  const [isRevealed, setIsRevealed] = useState<boolean>(defaultRevealed);

  const isShielded = shouldShieldPost({ isSensitive, contentWarning });

  if (!isShielded) {
    return <div className={className}>{children}</div>;
  }

  const warningLabel = getContentWarningLabel(contentWarning, isSensitive) || 'Cảnh báo: Nội dung nhạy cảm';

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextRevealed = !isRevealed;
    setIsRevealed(nextRevealed);
    onToggleReveal?.(nextRevealed);
  };

  return (
    <div
      data-testid="content-warning-shield"
      data-state={isRevealed ? 'revealed' : 'collapsed'}
      className={`relative my-2 rounded-[12px] overflow-hidden border border-[#d5d5d5] bg-[#fafafa] transition-all ${className}`}
      onClick={(e) => {
        // Prevent accidental card navigation when clicking shield banner
        if (!isRevealed) {
          e.stopPropagation();
        }
      }}
    >
      {/* Protective Shield Banner */}
      <div
        data-testid="shield-banner"
        className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#efefef] border-b border-[#d5d5d5]/60 select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <EyeOff className="w-4 h-4 text-[#71717a] shrink-0" aria-hidden="true" />
          <span
            data-testid="shield-warning-label"
            className="text-[13px] font-semibold text-[#424242] truncate"
          >
            {warningLabel}
          </span>
        </div>

        <button
          type="button"
          data-testid="shield-toggle-button"
          onClick={handleToggle}
          className="shrink-0 text-[13px] font-semibold text-[#000000] hover:text-[#385898] bg-[#fafafa] hover:bg-white px-3 py-1 rounded-full border border-[#d5d5d5] transition-all focus:outline-none shadow-xs cursor-pointer"
        >
          {isRevealed ? 'Ẩn bài viết' : 'Xem bài viết'}
        </button>
      </div>

      {/* Content Container (Blurred when collapsed, visible when revealed) */}
      <div
        data-testid="shield-content-wrapper"
        data-state={isRevealed ? 'revealed' : 'collapsed'}
        className={`p-3 transition-all duration-200 ${
          isRevealed
            ? 'filter-none opacity-100 pointer-events-auto'
            : 'filter blur-md backdrop-blur-md select-none pointer-events-none opacity-40 max-h-36 overflow-hidden'
        }`}
      >
        {children}
      </div>
    </div>
  );
};
