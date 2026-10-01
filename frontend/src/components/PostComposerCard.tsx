import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { PostDto, TrendingItemDto, ReplyPrivacy } from '../types/PulseTypes';
import { VerifiedBadge } from './VerifiedBadge';
import { ReplyPrivacySelector } from './ReplyPrivacySelector';
import {
  slotKeyForComposer,
  loadDraft,
  clearDraft,
  isDraftMeaningful,
  createAutosaver,
} from '../utils/drafts';
import { Image, X, Loader2, Link as LinkIcon, BarChart2, Plus, Trash2, Lock, AlertCircle, ShieldAlert } from 'lucide-react';

interface PostComposerCardProps {
  replyToPost?: PostDto | null;
  quoteOfPost?: PostDto | null;
  onPostCreated?: (post: PostDto) => void;
  onOptimisticCreate?: (tempPost: PostDto) => void;
  onOptimisticRollback?: (tempId: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

interface AutocompleteState {
  trigger: '@' | '#';
  query: string;
  startPos: number;
  endPos: number;
}

interface UserSuggestionItem {
  kind: 'user';
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isCelebrity: boolean;
}

interface HashtagSuggestionItem {
  kind: 'hashtag';
  tag: string;
  postsCount: number;
}

type SuggestionItem = UserSuggestionItem | HashtagSuggestionItem;

const DEFAULT_TRENDING: TrendingItemDto[] = [
  { tag: 'tech', postsCount: 128 },
  { tag: 'pulse', postsCount: 95 },
  { tag: 'Sky', postsCount: 5400 },
  { tag: 'concurrency', postsCount: 42 },
  { tag: 'architecture', postsCount: 67 },
];

export const PostComposerCard: React.FC<PostComposerCardProps> = ({
  replyToPost,
  quoteOfPost,
  onPostCreated,
  onOptimisticCreate,
  onOptimisticRollback,
  placeholder = 'Có gì mới?',
  autoFocus = false,
  disabled = false,
  disabledReason,
}) => {
  const { currentUser, users, addToast } = usePulse();
  const [content, setContent] = useState('');
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [showMediaInput, setShowMediaInput] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [trendingTags, setTrendingTags] = useState<TrendingItemDto[]>(DEFAULT_TRENDING);

  // Reply privacy state
  const [replyPrivacy, setReplyPrivacy] = useState<ReplyPrivacy>('EVERYONE');
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Poll state
  const [showPollBuilder, setShowPollBuilder] = useState<boolean>(false);
  const [pollQuestion, setPollQuestion] = useState<string>('');
  const [pollChoices, setPollChoices] = useState<string[]>(['', '']);
  const [pollDurationMinutes, setPollDurationMinutes] = useState<number>(1440); // 1 day

  // Content Warning state
  const [showContentWarning, setShowContentWarning] = useState<boolean>(false);
  const [contentWarningText, setContentWarningText] = useState<string>('');
  const [isSensitive, setIsSensitive] = useState<boolean>(false);

  // Autocomplete states
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const MAX_CHARS = 280;
  const remainingChars = MAX_CHARS - content.length;
  const isOverLimit = remainingChars < 0;

  // PKG-03: Post Drafts — autosave (debounce 1s) + khôi phục khi quay lại
  const draftSlot = replyToPost
    ? slotKeyForComposer('reply', replyToPost.id)
    : quoteOfPost
      ? slotKeyForComposer('quote', quoteOfPost.id)
      : slotKeyForComposer('post');
  const draftAutosaverRef = useRef<ReturnType<typeof createAutosaver> | null>(null);
  if (!draftAutosaverRef.current) {
    draftAutosaverRef.current = createAutosaver(draftSlot, localStorage);
  }
  const draftRestoredRef = useRef(false);

  const validPollChoices = pollChoices.map((c) => c.trim()).filter((c) => c.length > 0);
  const isPollValid = !showPollBuilder || (validPollChoices.length >= 2 && validPollChoices.length <= 4);

  const canSubmit =
    !disabled &&
    (content.trim().length > 0 || mediaUrls.length > 0 || !!quoteOfPost || (showPollBuilder && validPollChoices.length >= 2)) &&
    isPollValid &&
    !isOverLimit &&
    !isSubmitting &&
    !isUploadingMedia;

  // PKG-03: khôi phục nháp một lần khi mount
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    const saved = loadDraft(draftSlot);
    if (!saved) return;
    if (!content && saved.content) {
      setContent(saved.content);
    }
    if (mediaUrls.length === 0 && saved.mediaUrls && saved.mediaUrls.length > 0) {
      setMediaUrls(saved.mediaUrls);
      setShowMediaInput(true);
    }
    if (saved.contentWarning) {
      setContentWarningText(saved.contentWarning);
      setShowContentWarning(true);
      setIsSensitive(Boolean(saved.isSensitive));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PKG-03: autosave nháp mỗi khi nội dung thay đổi (debounce 1s trong createAutosaver)
  useEffect(() => {
    const draft = {
      content,
      mediaUrls,
      pollChoices: pollChoices.filter((c) => c.trim().length > 0),
      contentWarning: contentWarningText,
      isSensitive,
      replyToId: replyToPost?.id ?? null,
    };
    if (isDraftMeaningful(draft)) {
      draftAutosaverRef.current?.save(draft);
    } else {
      draftAutosaverRef.current?.cancel();
      clearDraft(draftSlot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, mediaUrls, pollChoices, contentWarningText, isSensitive]);

  // Load trending hashtags on mount
  useEffect(() => {
    let isMounted = true;
    api
      .getTrending()
      .then((tags) => {
        if (isMounted && Array.isArray(tags) && tags.length > 0) {
          setTrendingTags(tags);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Check cursor position for autocomplete triggers (@ or #)
  const checkTrigger = useCallback((text: string, cursorPos: number) => {
    const textBefore = text.slice(0, cursorPos);
    // Matches @word or #word immediately preceding the cursor (preceded by start of string or whitespace)
    const match = textBefore.match(/(?:^|\s)([@#])([a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]*)$/);

    if (!match) {
      setAutocomplete(null);
      setSuggestions([]);
      return;
    }

    const trigger = match[1] as '@' | '#';
    const query = match[2];
    const startPos = match.index! + (match[0].startsWith(' ') ? 1 : 0);

    setAutocomplete({
      trigger,
      query,
      startPos,
      endPos: cursorPos,
    });
    setSelectedIndex(0);
  }, []);

  // Fetch suggestions based on active autocomplete state
  useEffect(() => {
    if (!autocomplete) {
      setSuggestions([]);
      return;
    }

    let isCancelled = false;
    const { trigger, query } = autocomplete;
    const lowerQuery = query.toLowerCase();

    if (trigger === '@') {
      // 1. Instant local matching from context users
      const localMatches: UserSuggestionItem[] = users
        .filter(
          (u) =>
            u.username.toLowerCase().includes(lowerQuery) ||
            u.displayName.toLowerCase().includes(lowerQuery)
        )
        .map((u) => ({
          kind: 'user',
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          isCelebrity: u.isCelebrity,
        }));

      setSuggestions(localMatches);

      // 2. Query backend search API for users
      const timer = setTimeout(() => {
        api
          .search(query || 'a', 'users')
          .then((res) => {
            if (isCancelled) return;
            const remoteUsers = res.users || [];
            const userMap = new Map<string, UserSuggestionItem>();

            // Include local matches first
            for (const item of localMatches) {
              userMap.set(item.id, item);
            }

            // Merge remote matches
            for (const u of remoteUsers) {
              if (!userMap.has(u.id)) {
                userMap.set(u.id, {
                  kind: 'user',
                  id: u.id,
                  username: u.username,
                  displayName: u.displayName,
                  avatarUrl: u.avatarUrl,
                  isCelebrity: u.isCelebrity,
                });
              }
            }

            setSuggestions(Array.from(userMap.values()).slice(0, 6));
          })
          .catch(() => {
            // Keep local matches
          });
      }, 150);

      return () => {
        isCancelled = true;
        clearTimeout(timer);
      };
    } else if (trigger === '#') {
      // Filter trending hashtags matching query
      const matched = trendingTags
        .filter((t) => !lowerQuery || t.tag.toLowerCase().includes(lowerQuery))
        .map((t): SuggestionItem => ({
          kind: 'hashtag',
          tag: t.tag,
          postsCount: t.postsCount,
        }));

      // If user typed a tag not in trending, allow choosing it
      const exactMatch = matched.some((m) => m.kind === 'hashtag' && m.tag.toLowerCase() === lowerQuery);
      if (lowerQuery && !exactMatch) {
        matched.unshift({
          kind: 'hashtag',
          tag: query,
          postsCount: 0,
        });
      }

      setSuggestions(matched.slice(0, 6));
    }
  }, [autocomplete, users, trendingTags]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setAutocomplete(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Select an autocomplete suggestion
  const selectSuggestion = (item: SuggestionItem) => {
    if (!autocomplete) return;

    const replacement = item.kind === 'user' ? `@${item.username} ` : `#${item.tag} `;
    const before = content.slice(0, autocomplete.startPos);
    const after = content.slice(autocomplete.endPos);
    const nextContent = `${before}${replacement}${after}`;

    setContent(nextContent);
    setAutocomplete(null);
    setSuggestions([]);

    const newCursor = autocomplete.startPos + replacement.length;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  // Keyboard navigation inside textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (suggestions[selectedIndex]) {
          selectSuggestion(suggestions[selectedIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setAutocomplete(null);
        return;
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = 4 - mediaUrls.length;
    if (remainingSlots <= 0) {
      addToast('Chỉ được đính kèm tối đa 4 hình ảnh', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      addToast(`Chỉ được chọn tối đa 4 hình ảnh (đã lấy ${remainingSlots} ảnh đầu)`, 'info');
    }

    setIsUploadingMedia(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) {
          addToast(`Tệp ${file.name} không phải là hình ảnh hợp lệ`, 'error');
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          addToast(`Tệp ${file.name} vượt quá dung lượng 5MB cho phép`, 'error');
          continue;
        }
        const url = await api.uploadMedia(file);
        uploadedUrls.push(url);
      }

      if (uploadedUrls.length > 0) {
        setMediaUrls((prev) => [...prev, ...uploadedUrls].slice(0, 4));
        addToast(`Đã tải lên ${uploadedUrls.length} hình ảnh`, 'success');
      }
    } catch (err: any) {
      addToast(err.message || 'Lỗi khi tải ảnh lên máy chủ', 'error');
    } finally {
      setIsUploadingMedia(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAddMedia = () => {
    if (!mediaUrlInput.trim()) return;
    if (mediaUrls.length >= 4) {
      addToast('Chỉ được đính kèm tối đa 4 hình ảnh', 'error');
      return;
    }
    try {
      new URL(mediaUrlInput.trim());
      setMediaUrls((prev) => [...prev, mediaUrlInput.trim()].slice(0, 4));
      setMediaUrlInput('');
      setShowMediaInput(false);
    } catch {
      addToast('Vui lòng nhập đường dẫn hình ảnh (URL) hợp lệ', 'error');
    }
  };

  const handleRemoveMedia = (index: number) => {
    setMediaUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const insertTag = (tag: string) => {
    setContent((prev) => {
      const space = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
      return `${prev}${space}#${tag} `;
    });
    textareaRef.current?.focus();
  };

  const handleSubmit = async () => {
    if (!canSubmit || disabled) return;

    const trimmedContent = content.trim() || (showPollBuilder && validPollChoices.length >= 2 ? (pollQuestion.trim() || 'Cuộc bình chọn') : '');
    const privacyToSend = replyToPost ? undefined : replyPrivacy;

    setIsSubmitting(true);
    setPermissionError(null);

    // Optimistic post preview
    const tempId = `temp-${Date.now()}`;
    const tempPost: PostDto = {
      id: tempId,
      authorId: currentUser.id,
      content: trimmedContent,
      mediaUrls: [...mediaUrls],
      replyToId: replyToPost?.id || null,
      rootPostId: replyToPost?.rootPostId || replyToPost?.id || null,
      repostOfId: null,
      quoteOfId: quoteOfPost?.id || null,
      replyPrivacy: privacyToSend || 'EVERYONE',
      reply_privacy: privacyToSend || 'EVERYONE',
      canReply: true,
      can_reply: true,
      likesCount: 0,
      repliesCount: 0,
      repostsCount: 0,
      quotesCount: 0,
      hashtags: [],
      mentions: [],
      isLiked: false,
      isReposted: false,
      isBookmarked: false,
      isSensitive: showContentWarning && isSensitive,
      contentWarning: showContentWarning && contentWarningText.trim() ? contentWarningText.trim() : null,
      createdAt: new Date().toISOString(),
      author: {
        id: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl,
        isCelebrity: currentUser.isCelebrity,
      },
      replyTo: replyToPost
        ? {
            id: replyToPost.id,
            author: {
              username: replyToPost.author.username,
              displayName: replyToPost.author.displayName,
            },
          }
        : null,
      quoteOf: quoteOfPost || null,
    };

    if (onOptimisticCreate) {
      onOptimisticCreate(tempPost);
    }

    const savedContent = content;
    const savedMedia = [...mediaUrls];
    const savedPollQuestion = pollQuestion;
    const savedPollChoices = [...pollChoices];
    const savedShowPoll = showPollBuilder;
    const savedShowCW = showContentWarning;
    const savedCWText = contentWarningText;
    const savedIsSensitive = isSensitive;

    // Optimistically clear inputs for smooth UX
    setContent('');
    setMediaUrls([]);
    setShowMediaInput(false);
    setAutocomplete(null);
    setShowPollBuilder(false);
    setPollQuestion('');
    setPollChoices(['', '']);
    setShowContentWarning(false);
    setContentWarningText('');
    setIsSensitive(false);

    try {
      const pollData =
        savedShowPoll && validPollChoices.length >= 2
          ? {
              question: savedPollQuestion.trim() || savedContent.trim() || 'Cuộc bình chọn',
              choices: validPollChoices,
              durationMinutes: pollDurationMinutes,
            }
          : undefined;

      const newPost = await api.createPost({
        content: trimmedContent,
        mediaUrls: savedMedia.length > 0 ? savedMedia : undefined,
        replyToId: replyToPost?.id,
        quoteOfId: quoteOfPost?.id,
        replyPrivacy: privacyToSend,
        reply_privacy: privacyToSend,
        poll: pollData,
        isSensitive: savedShowCW && savedIsSensitive,
        contentWarning: savedShowCW && savedCWText.trim() ? savedCWText.trim() : undefined,
      });

      // If backend requires explicit separate /polls endpoint call when not attached automatically
      if (pollData && !newPost.poll && newPost.id) {
        try {
          const createdPoll = await api.createPoll({
            postId: newPost.id,
            question: pollData.question,
            choices: pollData.choices,
            durationMinutes: pollData.durationMinutes,
          });
          newPost.poll = createdPoll;
        } catch (pollErr) {
          console.warn('Standalone poll creation fallback:', pollErr);
        }
      }

      setReplyPrivacy('EVERYONE');

      // PKG-03: đăng thành công → xoá nháp đã autosave cho slot này
      draftAutosaverRef.current?.cancel();
      clearDraft(draftSlot);

      addToast(
        replyToPost ? 'Đã gửi câu trả lời' : 'Đã đăng bài viết',
        'success'
      );

      if (onPostCreated) {
        onPostCreated(newPost);
      }
    } catch (err: any) {
      // Rollback optimistic update
      if (onOptimisticRollback) {
        onOptimisticRollback(tempId);
      }

      // Restore inputs so nothing is lost
      setContent(savedContent);
      setMediaUrls(savedMedia);
      setShowPollBuilder(savedShowPoll);
      setPollQuestion(savedPollQuestion);
      setPollChoices(savedPollChoices);

      const errorMsg = err.message || 'Không thể đăng bài viết';
      addToast(errorMsg, 'error');

      // Check if permission restriction
      if (
        err.code === 'REPLY_RESTRICTED' ||
        err.code === 'FORBIDDEN' ||
        /restricted|permission|chỉ người|theo dõi|nhắc đến|không có quyền|allowed/i.test(errorMsg)
      ) {
        setPermissionError(errorMsg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 bg-paper border-b border-cloud transition-all">
      {replyToPost && (
        <div className="mb-2 px-3 py-1.5 rounded-[8px] bg-mist text-[13px] text-graphite flex items-center gap-1.5">
          <span>Đang trả lời cho</span>
          <span className="font-semibold text-ink">
            @{replyToPost.author.username}
          </span>
        </div>
      )}

      {/* Disabled Banner (Informative Banner for restricted reply access) */}
      {disabled && (
        <div
          data-testid="reply-restricted-banner"
          className="mb-3 p-3.5 rounded-[12px] bg-mist border border-cloud text-ink flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-full bg-paper border border-cloud flex items-center justify-center shrink-0 text-graphite">
            <Lock className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-semibold text-ink block mb-0.5">
              Cuộc trò chuyện đã bị giới hạn người trả lời
            </span>
            <span className="text-[12px] text-graphite leading-relaxed">
              {disabledReason || 'Chỉ những người được tác giả cho phép mới có thể trả lời bài viết này.'}
            </span>
          </div>
        </div>
      )}

      {/* Inline Permission Error Banner */}
      {permissionError && (
        <div
          data-testid="composer-permission-error"
          className="mb-3 p-3 rounded-[10px] bg-[#fdf2f2] border border-[#f8b4b4] text-[#9b1c1c] text-[13px] flex items-start gap-2 animate-fade-in"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#e02424]" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold block">Không thể gửi câu trả lời</span>
            <span className="text-[12px]">{permissionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPermissionError(null)}
            className="text-[#9b1c1c] hover:text-ink p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex gap-3">
        {/* Current User Avatar (40px, full circle, no border) */}
        <img
          src={
            currentUser.avatarUrl ||
            `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
          }
          alt={currentUser.displayName}
          className="w-10 h-10 rounded-full object-cover shrink-0"
        />

        {/* Input Area */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[15px] font-semibold text-ink">
              {currentUser.displayName}
            </span>
            {currentUser.isCelebrity && (
              <VerifiedBadge size={12} title="Celebrity VIP" />
            )}
          </div>

          <div className="relative">
            <textarea
              ref={textareaRef}
              disabled={disabled || isSubmitting}
              data-testid={disabled ? 'reply-input-disabled' : undefined}
              value={content}
              onChange={(e) => {
                const val = e.target.value;
                setContent(val);
                checkTrigger(val, e.target.selectionEnd);
              }}
              onKeyUp={(e) => {
                checkTrigger(content, (e.target as HTMLTextAreaElement).selectionEnd);
              }}
              onClick={(e) => {
                checkTrigger(content, (e.target as HTMLTextAreaElement).selectionEnd);
              }}
              onKeyDown={handleKeyDown}
              placeholder={disabled ? (disabledReason || 'Bạn không thể trả lời bài viết này') : placeholder}
              autoFocus={disabled ? false : autoFocus}
              rows={2}
              className={`w-full bg-transparent text-ink placeholder-ash text-[15px] leading-[1.4] resize-none focus:outline-none focus:ring-0 ${
                disabled ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            />

            {/* Autocomplete Dropdown: Threads Light Theme */}
            {autocomplete && suggestions.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute left-0 top-full mt-1 z-50 w-full max-w-sm bg-paper border border-cloud rounded-[8px] shadow-md max-h-56 overflow-y-auto overflow-x-hidden animate-fade-in divide-y divide-mist"
              >
                {suggestions.map((item, idx) => {
                  const isHighlighted = idx === selectedIndex;
                  if (item.kind === 'user') {
                    return (
                      <div
                        key={item.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestion(item);
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                          isHighlighted
                            ? 'bg-mist'
                            : 'bg-paper hover:bg-mist'
                        }`}
                      >
                        <img
                          src={
                            item.avatarUrl ||
                            `https://api.dicebear.com/7.x/bottts/svg?seed=${item.username}`
                          }
                          alt={item.displayName}
                          className="w-7 h-7 rounded-full object-cover shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[14px] font-semibold text-ink truncate">
                              {item.displayName}
                            </span>
                            {item.isCelebrity && (
                              <VerifiedBadge size={11} title="VIP" />
                            )}
                          </div>
                          <span className="text-[12px] text-graphite block truncate">
                            @{item.username}
                          </span>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div
                        key={item.tag}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestion(item);
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                          isHighlighted
                            ? 'bg-mist'
                            : 'bg-paper hover:bg-mist'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-mist flex items-center justify-center text-meta font-bold text-[12px] shrink-0">
                            #
                          </span>
                          <span className="text-[14px] font-semibold text-ink truncate">
                            #{item.tag}
                          </span>
                        </div>
                        {item.postsCount > 0 ? (
                          <span className="text-[12px] text-graphite shrink-0 ml-2">
                            {item.postsCount} bài viết
                          </span>
                        ) : (
                          <span className="text-[11px] text-ash shrink-0 ml-2">
                            Mới
                          </span>
                        )}
                      </div>
                    );
                  }
                })}
              </div>
            )}
          </div>

          {/* Media Previews (8px radius, 1px #d5d5d5 border) */}
          {(mediaUrls.length > 0 || isUploadingMedia) && (
            <div className="flex flex-wrap gap-2 my-2.5">
              {mediaUrls.map((url, idx) => (
                <div
                  key={idx}
                  className="relative rounded-[8px] overflow-hidden border border-cloud w-24 h-24 bg-mist"
                >
                  <img
                    src={url}
                    alt={`Ảnh đính kèm ${idx + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveMedia(idx)}
                    className="absolute top-1 right-1 p-1 bg-ink/75 hover:bg-ink text-white rounded-full transition-colors"
                    title="Xóa ảnh"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {isUploadingMedia && (
                <div className="w-24 h-24 rounded-[8px] border border-dashed border-cloud bg-mist/60 flex flex-col items-center justify-center gap-1">
                  <Loader2 className="w-5 h-5 animate-spin text-ink" />
                  <span className="text-[11px] text-graphite">Đang tải...</span>
                </div>
              )}
            </div>
          )}

          {/* Media URL Input Box (optional manual link entry) */}
          {showMediaInput && (
            <div className="flex items-center gap-2 my-2 p-2 bg-mist border border-cloud rounded-[8px]">
              <input
                type="url"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="Dán link ảnh (https://...)"
                className="flex-1 bg-transparent text-[13px] text-ink placeholder-ash focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMedia();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleAddMedia}
                className="px-3 py-1 text-[13px] font-semibold bg-ink text-paper rounded-full transition-colors"
              >
                Thêm
              </button>
              <button
                type="button"
                onClick={() => setShowMediaInput(false)}
                className="p-1 text-ash hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Embedded Quote Preview */}
          {quoteOfPost && (
            <div className="my-2 p-3 rounded-[8px] border border-cloud bg-paper text-[13px]">
              <div className="flex items-center gap-1.5 mb-1 text-graphite">
                <span className="font-semibold text-ink">
                  {quoteOfPost.author.displayName}
                </span>
                {quoteOfPost.author.isCelebrity && (
                  <VerifiedBadge size={11} title="VIP" />
                )}
                <span>@{quoteOfPost.author.username}</span>
              </div>
              <p className="text-[14px] text-ink line-clamp-2">
                {quoteOfPost.content}
              </p>
            </div>
          )}

          {/* Hashtag suggestions (1000px pill, #d5d5d5 border) */}
          <div className="flex items-center gap-1.5 my-2 flex-wrap text-[12px]">
            <span className="text-graphite">Gợi ý:</span>
            {trendingTags.slice(0, 5).map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => insertTag(t.tag)}
                className="px-2.5 py-0.5 rounded-full border border-cloud hover:border-meta text-graphite hover:text-meta transition-colors cursor-pointer"
              >
                #{t.tag}
              </button>
            ))}
          </div>

          {/* Poll Builder Card */}
          {showPollBuilder && (
            <div className="my-2.5 p-3.5 rounded-xl border border-meta/30 bg-meta/5 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-meta flex items-center gap-1.5">
                  <BarChart2 className="w-4 h-4" />
                  <span>Tạo cuộc bình chọn (2-4 lựa chọn)</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowPollBuilder(false)}
                  className="text-ash hover:text-ink p-1 rounded-full hover:bg-black/5 transition-colors"
                  title="Xóa bình chọn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Optional Poll Question override */}
              <input
                type="text"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="Câu hỏi bình chọn (để trống sẽ dùng nội dung bài viết)..."
                className="w-full mb-2.5 px-3 py-1.5 rounded-lg border border-cloud bg-card text-[13px] text-ink placeholder-ash focus:outline-none focus:border-meta"
              />

              {/* Poll Choices */}
              <div className="flex flex-col gap-2">
                {pollChoices.map((choice, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={choice}
                      onChange={(e) => {
                        const next = [...pollChoices];
                        next[idx] = e.target.value;
                        setPollChoices(next);
                      }}
                      placeholder={`Lựa chọn ${idx + 1}`}
                      maxLength={80}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-cloud bg-card text-[13px] text-ink placeholder-ash focus:outline-none focus:border-meta"
                    />
                    {pollChoices.length > 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPollChoices(pollChoices.filter((_, i) => i !== idx));
                        }}
                        className="p-1.5 text-ash hover:text-[#dc2626] rounded-full hover:bg-black/5 transition-colors"
                        title="Xóa lựa chọn"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Choice & Duration Controls */}
              <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-meta/15 flex-wrap gap-2">
                {pollChoices.length < 4 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (pollChoices.length < 4) {
                        setPollChoices([...pollChoices, '']);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-meta hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm lựa chọn ({pollChoices.length}/4)</span>
                  </button>
                ) : (
                  <span className="text-[12px] text-ash">Đã đạt tối đa 4 lựa chọn</span>
                )}

                <div className="flex items-center gap-1.5 text-[12px] text-graphite">
                  <span>Thời lượng:</span>
                  <select
                    value={pollDurationMinutes}
                    onChange={(e) => setPollDurationMinutes(Number(e.target.value))}
                    className="px-2 py-1 rounded border border-cloud bg-card text-[12px] text-ink focus:outline-none focus:border-meta"
                  >
                    <option value={5}>5 phút</option>
                    <option value={15}>15 phút</option>
                    <option value={60}>1 giờ</option>
                    <option value={360}>6 giờ</option>
                    <option value={1440}>1 ngày</option>
                    <option value={4320}>3 ngày</option>
                    <option value={10080}>7 ngày</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Content Warning Input Box */}
          {showContentWarning && (
            <div
              data-testid="composer-content-warning-box"
              className="my-2.5 p-3 rounded-xl border border-[#b45309]/30 bg-[#fef3c7]/30 space-y-2 animate-fade-in"
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[#92400e] flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Cảnh báo nội dung (Content Warning)</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowContentWarning(false);
                    setContentWarningText('');
                    setIsSensitive(false);
                  }}
                  className="text-ash hover:text-ink p-1 rounded-full hover:bg-black/5 transition-colors"
                  title="Hủy cảnh báo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <input
                type="text"
                data-testid="composer-content-warning-input"
                value={contentWarningText}
                onChange={(e) => setContentWarningText(e.target.value)}
                placeholder="Nhập lý do cảnh báo (ví dụ: Tiết lộ cốt truyện Avatar, Nội dung nhạy cảm...)"
                maxLength={100}
                className="w-full px-3 py-1.5 rounded-lg border border-cloud bg-white text-[13px] text-ink placeholder-ash focus:outline-none focus:border-[#92400e]"
              />

              <label className="flex items-center gap-2 text-[12px] text-graphite cursor-pointer pt-0.5">
                <input
                  type="checkbox"
                  data-testid="composer-is-sensitive-checkbox"
                  checked={isSensitive}
                  onChange={(e) => setIsSensitive(e.target.checked)}
                  className="w-3.5 h-3.5 accent-ink rounded cursor-pointer"
                />
                <span>Đánh dấu toàn bộ bài viết / hình ảnh là nhạy cảm</span>
              </label>
            </div>
          )}

          {/* Reply Privacy Selector: only shown for top-level posts and quotes */}
          {!replyToPost && (
            <div className="pt-2 pb-1">
              <ReplyPrivacySelector
                value={replyPrivacy}
                onChange={setReplyPrivacy}
                disabled={disabled || isSubmitting}
              />
            </div>
          )}

          {/* Bottom Toolbar & Action Bar */}
          <div className="flex items-center justify-between pt-2 border-t border-cloud/60 mt-2">
            <div className="flex items-center gap-1.5">
              {/* Hidden File Input for Image Upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => {
                  if (mediaUrls.length >= 4) {
                    addToast('Chỉ được đính kèm tối đa 4 hình ảnh', 'error');
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={mediaUrls.length >= 4 || isUploadingMedia || isSubmitting}
                className="p-1.5 rounded-full text-ash hover:text-ink hover:bg-mist transition-colors focus:outline-none disabled:opacity-40 cursor-pointer"
                title={
                  mediaUrls.length >= 4
                    ? 'Đã đạt giới hạn 4 ảnh'
                    : 'Tải lên hình ảnh (tối đa 4 ảnh)'
                }
              >
                {isUploadingMedia ? (
                  <Loader2 className="w-5 h-5 animate-spin text-ink" />
                ) : (
                  <Image className="w-5 h-5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowMediaInput((prev) => !prev)}
                disabled={mediaUrls.length >= 4 || isUploadingMedia || isSubmitting}
                className="p-1.5 rounded-full text-ash hover:text-ink hover:bg-mist transition-colors focus:outline-none disabled:opacity-40 cursor-pointer"
                title="Dán đường dẫn ảnh URL"
              >
                <LinkIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowPollBuilder((prev) => !prev)}
                disabled={isUploadingMedia || isSubmitting}
                className={`p-1.5 rounded-full transition-colors focus:outline-none disabled:opacity-40 cursor-pointer ${
                  showPollBuilder
                    ? 'text-meta bg-meta/10'
                    : 'text-ash hover:text-ink hover:bg-mist'
                }`}
                title={showPollBuilder ? 'Hủy bình chọn' : 'Tạo cuộc bình chọn'}
              >
                <BarChart2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                data-testid="toggle-content-warning-btn"
                onClick={() => setShowContentWarning((prev) => !prev)}
                disabled={isUploadingMedia || isSubmitting}
                className={`p-1.5 rounded-full transition-colors focus:outline-none disabled:opacity-40 cursor-pointer ${
                  showContentWarning
                    ? 'text-[#b45309] bg-[#fef3c7]'
                    : 'text-ash hover:text-ink hover:bg-mist'
                }`}
                title={
                  showContentWarning
                    ? 'Hủy cảnh báo nội dung'
                    : 'Thêm cảnh báo nội dung (Content Warning)'
                }
              >
                <ShieldAlert className="w-5 h-5" />
              </button>

              {mediaUrls.length > 0 && (
                <span className="text-[12px] text-graphite ml-1">
                  {mediaUrls.length}/4
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Character Counter (13px/400 Graphite #424242) */}
              <span
                className={`text-[13px] tabular-nums font-normal ${
                  isOverLimit ? 'text-ink font-bold' : 'text-graphite'
                }`}
              >
                {remainingChars}
              </span>

              {/* Primary Action Button: Pill (1000px), bg #000000, text #fafafa, 15px/600, padding 8px 16px. No border. */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`px-4 py-1.5 rounded-full text-[15px] font-semibold transition-all duration-150 ${
                  canSubmit
                    ? 'bg-ink hover:bg-ink/85 text-paper cursor-pointer active:scale-95'
                    : 'bg-ink/20 text-paper/60 cursor-not-allowed'
                }`}
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-paper/40 border-t-paper rounded-full animate-spin" />
                ) : (
                  <span>{replyToPost ? 'Trả lời' : 'Đăng'}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
