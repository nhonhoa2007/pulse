import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ReplyPrivacy } from '../types/PulseTypes';
import {
  REPLY_PRIVACY_OPTIONS,
  getReplyPrivacyOption,
} from '../utils/privacy';
import { Globe, Users, AtSign, ChevronDown, Check } from 'lucide-react';

interface ReplyPrivacySelectorProps {
  value: ReplyPrivacy;
  onChange: (value: ReplyPrivacy) => void;
  disabled?: boolean;
  className?: string;
}

export const ReplyPrivacySelector: React.FC<ReplyPrivacySelectorProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentOption = getReplyPrivacyOption(value);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Sync highlighted index with current value when opening
  useEffect(() => {
    if (isOpen) {
      const idx = REPLY_PRIVACY_OPTIONS.findIndex((opt) => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, value]);

  const selectOption = useCallback(
    (optValue: ReplyPrivacy) => {
      onChange(optValue);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
  );

  // Keyboard navigation for dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % REPLY_PRIVACY_OPTIONS.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          (prev - 1 + REPLY_PRIVACY_OPTIONS.length) % REPLY_PRIVACY_OPTIONS.length
        );
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectOption(REPLY_PRIVACY_OPTIONS[highlightedIndex].value);
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  const renderIcon = (privacyValue: ReplyPrivacy, iconClassName = 'w-4 h-4') => {
    switch (privacyValue) {
      case 'EVERYONE':
        return <Globe className={iconClassName} />;
      case 'FOLLOWING':
        return <Users className={iconClassName} />;
      case 'MENTIONED':
        return <AtSign className={iconClassName} />;
      default:
        return <Globe className={iconClassName} />;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-block text-left ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Hidden native select for full programmatic & form testing compatibility */}
      <select
        data-testid="reply-privacy-select"
        name="reply_privacy"
        value={value}
        onChange={(e) => onChange(e.target.value as ReplyPrivacy)}
        disabled={disabled}
        aria-hidden="true"
        className="sr-only"
        tabIndex={-1}
      >
        {REPLY_PRIVACY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.englishLabel}
          </option>
        ))}
      </select>

      {/* Interactive Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        data-testid="reply-privacy-selector"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Quyền riêng tư trả lời: ${currentOption.label} (${currentOption.englishLabel})`}
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium transition-all ${
          isOpen
            ? 'bg-mist text-ink ring-1 ring-cloud'
            : 'text-meta hover:bg-mist hover:text-ink'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className="shrink-0 text-meta">
          {renderIcon(value, 'w-3.5 h-3.5')}
        </span>
        <span
          data-testid="selected-privacy-label"
          className="truncate max-w-[200px] sm:max-w-none text-meta"
        >
          {currentOption.label} ({currentOption.englishLabel}) có thể trả lời
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-meta transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Popover Menu / Modal */}
      {isOpen && (
        <div
          ref={dropdownRef}
          data-testid="reply-privacy-dropdown"
          role="menu"
          aria-orientation="vertical"
          aria-label="Tùy chọn ai có thể trả lời"
          className="absolute left-0 bottom-full mb-2 z-50 w-80 sm:w-88 bg-paper border border-cloud rounded-[16px] shadow-2xl p-3 animate-scale-up"
        >
          {/* Header */}
          <div className="px-2 pt-1 pb-2 border-b border-mist mb-1.5">
            <h4 className="text-[14px] font-bold text-ink">
              Ai có thể trả lời?
            </h4>
            <p className="text-[12px] text-graphite mt-0.5 leading-snug">
              Chọn người có thể trả lời bài viết này. Bất kỳ ai được nhắc đến đều luôn có thể trả lời.
            </p>
          </div>

          {/* Options List */}
          <div className="space-y-1" role="radiogroup">
            {REPLY_PRIVACY_OPTIONS.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;

              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  data-testid={`privacy-option-${opt.value.toLowerCase()}`}
                  onClick={() => selectOption(opt.value)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-[12px] text-left transition-colors cursor-pointer ${
                    isHighlighted || isSelected
                      ? 'bg-mist'
                      : 'hover:bg-mist/60'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 pr-2">
                    {/* Option Icon Circle */}
                    <div className="w-8 h-8 rounded-full bg-mist border border-cloud flex items-center justify-center shrink-0 text-ink mt-0.5">
                      {renderIcon(opt.value, 'w-4 h-4 text-ink')}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[14px] font-semibold text-ink">
                          {opt.label}
                        </span>
                        <span className="text-[12px] text-graphite">
                          ({opt.englishLabel})
                        </span>
                      </div>
                      <p className="text-[12px] text-graphite leading-tight mt-0.5">
                        {opt.description}
                      </p>
                    </div>
                  </div>

                  {/* Selected checkmark */}
                  {isSelected && (
                    <div
                      data-testid="privacy-option-selected"
                      className="shrink-0 text-ink pl-1"
                    >
                      <Check className="w-4 h-4 stroke-[2.5]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
