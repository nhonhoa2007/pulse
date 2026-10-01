import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Check, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { PollDto, PollChoiceDto } from '../types/PulseTypes';
import {
  computePollPercentages,
  computePollTimeRemaining,
  normalizePollObject,
} from '../utils/pollUtils';
import { api } from '../api/PulseApiClient';
import { usePulse } from '../context/PulseContext';

export interface PollComponentProps {
  poll?: any;
  // Direct props support
  id?: string;
  question?: string;
  choices?: Array<any>;
  expires_at?: string;
  expiresAt?: string;
  user_has_voted?: boolean;
  userHasVoted?: boolean;
  user_choice_index?: number | null;
  userChoiceIndex?: number | null;
  is_active?: boolean;
  isActive?: boolean;
  total_votes?: number;
  totalVotes?: number;
  onVote?: (choiceIndex: number) => Promise<any> | void;
  className?: string;
  readOnly?: boolean;
}

export const PollComponent: React.FC<PollComponentProps> = (props) => {
  const { addToast } = usePulse ? usePulse() : { addToast: () => {} };

  // Support both props.poll and direct props
  const initialPollData = useMemo(() => {
    const source = props.poll ? props.poll : props;
    return normalizePollObject(source);
  }, [props.poll, props]);

  const [poll, setPoll] = useState<PollDto>(initialPollData);
  const [isSubmittingVote, setIsSubmittingVote] = useState<boolean>(false);
  const [votingChoiceIndex, setVotingChoiceIndex] = useState<number | null>(null);
  const [srAnnouncement, setSrAnnouncement] = useState<string>('');

  // Sync state if props change externally
  useEffect(() => {
    setPoll(initialPollData);
  }, [initialPollData]);

  const expiresAt = poll.expiresAt || poll.expires_at;
  const isServerActive = poll.isActive && poll.is_active;

  // Countdown timer state
  const [timeInfo, setTimeInfo] = useState(() => computePollTimeRemaining(expiresAt));
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!expiresAt) {
      setTimeInfo({ isExpired: false, formatted: '', totalSecondsRemaining: 0 });
      return;
    }

    const checkTime = () => {
      const remaining = computePollTimeRemaining(expiresAt);
      setTimeInfo(remaining);
      if (remaining.isExpired) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    checkTime();
    timerRef.current = setInterval(checkTime, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [expiresAt]);

  const isPollClosed = !isServerActive || timeInfo.isExpired;
  const hasUserVoted = poll.userHasVoted || poll.user_has_voted;
  const showResults = hasUserVoted || isPollClosed || props.readOnly;

  // Real-time updates subscription via SSE / WebSocket
  useEffect(() => {
    if (!poll.id) return;

    // Listen for real-time events on this poll
    const unsubscribe = (api as any).subscribePollEvents?.(
      poll.id,
      (updatedPayload: Partial<PollDto>) => {
        setPoll((prev) => {
          const merged = { ...prev, ...updatedPayload };
          if (updatedPayload.choices) {
            const { choicesWithPercentages, totalVotes } = computePollPercentages(
              updatedPayload.choices
            );
            merged.choices = choicesWithPercentages;
            merged.totalVotes = updatedPayload.totalVotes ?? totalVotes;
            merged.total_votes = updatedPayload.total_votes ?? totalVotes;
          }
          return merged;
        });

        // Screen reader announcement for live update
        setSrAnnouncement(`Bình chọn đã cập nhật kết quả mới.`);
      },
      (err: any) => {
        console.warn('Real-time poll subscription warning:', err);
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [poll.id]);

  // Handle Voting with Optimistic UI Update & Reconciliation
  const handleVote = useCallback(
    async (choiceIndex: number) => {
      if (isPollClosed || hasUserVoted || isSubmittingVote) {
        return;
      }

      const previousPoll = { ...poll };
      const targetChoice = poll.choices[choiceIndex];
      const choiceText = targetChoice ? targetChoice.text : `Lựa chọn ${choiceIndex + 1}`;

      // 1. Optimistic Update
      setIsSubmittingVote(true);
      setVotingChoiceIndex(choiceIndex);

      const optimisticChoices: PollChoiceDto[] = poll.choices.map((c, idx) => {
        const isChosen = idx === choiceIndex;
        const currentCount = c.voteCount || 0;
        return {
          ...c,
          voteCount: isChosen ? currentCount + 1 : currentCount,
          vote_count: isChosen ? currentCount + 1 : currentCount,
          isUserChoice: isChosen,
        };
      });

      const { choicesWithPercentages, totalVotes } = computePollPercentages(
        optimisticChoices
      );

      const optimisticPoll: PollDto = {
        ...poll,
        choices: choicesWithPercentages,
        totalVotes,
        total_votes: totalVotes,
        userHasVoted: true,
        user_has_voted: true,
        userChoiceIndex: choiceIndex,
        user_choice_index: choiceIndex,
      };

      setPoll(optimisticPoll);
      setSrAnnouncement(
        `Bạn đã bình chọn cho: ${choiceText}. Tỷ lệ hiện tại là ${
          choicesWithPercentages[choiceIndex]?.percentage ?? 0
        }%.`
      );

      // 2. Server Request & Reconciliation
      try {
        let serverResponse: PollDto | null = null;
        if (props.onVote) {
          serverResponse = await props.onVote(choiceIndex);
        } else if (poll.id && (api as any).castVote) {
          serverResponse = await (api as any).castVote(poll.id, choiceIndex);
        }

        if (serverResponse && serverResponse.choices) {
          // Reconcile with verified server response
          const normalized = normalizePollObject(serverResponse);
          setPoll(normalized);
        }
      } catch (err: any) {
        // Roll back on error
        setPoll(previousPoll);
        const errorMsg =
          err?.message || 'Không thể gửi bình chọn. Vui lòng thử lại sau.';
        addToast(errorMsg, 'error');
        setSrAnnouncement(`Lỗi: ${errorMsg}`);
      } finally {
        setIsSubmittingVote(false);
        setVotingChoiceIndex(null);
      }
    },
    [isPollClosed, hasUserVoted, isSubmittingVote, poll, props, addToast]
  );

  // Determine user selected choice index
  const currentUserChoiceIndex =
    poll.userChoiceIndex !== undefined && poll.userChoiceIndex !== null
      ? poll.userChoiceIndex
      : poll.user_choice_index !== undefined && poll.user_choice_index !== null
      ? poll.user_choice_index
      : poll.choices.findIndex((c) => c.isUserChoice);

  // Leading choice index (highest votes)
  const maxVotes = useMemo(() => {
    return Math.max(...poll.choices.map((c) => c.voteCount || 0), 0);
  }, [poll.choices]);

  const totalVotesCount = poll.totalVotes ?? poll.total_votes ?? poll.choices.reduce((s, c) => s + (c.voteCount || 0), 0);

  return (
    <div
      role="region"
      aria-label={`Cuộc bình chọn: ${poll.question}`}
      className={`w-full my-3 p-3.5 rounded-xl border border-cloud bg-card transition-all select-none ${
        props.className || ''
      }`}
    >
      {/* Screen Reader Live Announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {srAnnouncement}
      </div>

      {/* Poll Question */}
      <div className="mb-3">
        <h4 className="text-[15px] font-semibold text-ink leading-snug break-words">
          {poll.question}
        </h4>
      </div>

      {/* Choices Container - Zero Layout Shift (Height & Padding strictly match between states) */}
      <div
        role={showResults ? 'list' : 'radiogroup'}
        aria-label={poll.question}
        className="flex flex-col gap-2 w-full"
      >
        {poll.choices.map((choice, index) => {
          const isUserSelected =
            choice.isUserChoice || currentUserChoiceIndex === index;
          const percentage = choice.percentage ?? 0;
          const isHighest = totalVotesCount > 0 && choice.voteCount === maxVotes;
          const isThisSubmitting = isSubmittingVote && votingChoiceIndex === index;

          if (!showResults) {
            // ================= PRE-VOTE STATE (Clickable Choice Button) =================
            return (
              <button
                key={choice.id || `choice-${index}`}
                type="button"
                role="radio"
                aria-checked="false"
                aria-label={`Bình chọn cho: ${choice.text}`}
                disabled={isSubmittingVote || isPollClosed}
                onClick={() => handleVote(index)}
                className={`relative min-h-[44px] h-[44px] w-full px-4 rounded-lg border border-meta/40 bg-paper hover:bg-meta/10 active:scale-[0.99] text-meta font-medium text-[14px] flex items-center justify-between transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-meta disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <span className="truncate pr-2 text-left text-ink font-medium">
                  {choice.text}
                </span>

                {isThisSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-meta shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-meta/60 shrink-0 flex items-center justify-center group-hover:border-meta" />
                )}
              </button>
            );
          }

          // ================= POST-VOTE / RESULTS STATE (Animated Progress Bar) =================
          return (
            <div
              key={choice.id || `result-${index}`}
              role="listitem"
              className={`relative min-h-[44px] h-[44px] w-full rounded-lg overflow-hidden border transition-colors flex items-center ${
                isUserSelected
                  ? 'border-meta bg-[#f0f4f8]'
                  : 'border-cloud bg-[#f8fafc]'
              }`}
            >
              {/* Animated Progress Bar Fill (Smooth width transition) */}
              <div
                role="progressbar"
                aria-valuenow={percentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`${choice.text}: ${percentage}%, ${choice.voteCount} lượt bình chọn${
                  isUserSelected ? ' (Lựa chọn của bạn)' : ''
                }`}
                className={`absolute inset-y-0 left-0 transition-all duration-500 ease-out z-0 ${
                  isUserSelected
                    ? 'bg-meta/25'
                    : isHighest
                    ? 'bg-[#cbd5e1]'
                    : 'bg-cloud'
                }`}
                style={{ width: `${percentage}%` }}
              />

              {/* Foreground Label & Percentage */}
              <div className="relative z-10 w-full px-4 flex items-center justify-between text-[14px]">
                <div className="flex items-center gap-1.5 min-w-0 pr-2">
                  <span
                    className={`truncate text-left ${
                      isUserSelected
                        ? 'font-bold text-[#1e293b]'
                        : isHighest
                        ? 'font-semibold text-[#1e293b]'
                        : 'font-medium text-[#334155]'
                    }`}
                    title={choice.text}
                  >
                    {choice.text}
                  </span>

                  {isUserSelected && (
                    <span
                      title="Lựa chọn của bạn"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-meta text-card shrink-0 ml-1"
                    >
                      <Check className="w-3 h-3 stroke-[2.5]" />
                      <span>Đã chọn</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`font-bold tabular-nums text-[14px] ${
                      isUserSelected
                        ? 'text-meta'
                        : isHighest
                        ? 'text-[#0f172a]'
                        : 'text-graphite'
                    }`}
                  >
                    {percentage}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: Vote Count & Expiration Timer */}
      <div className="mt-3 flex items-center justify-between text-[12px] text-[#64748b] border-t border-[#f1f5f9] pt-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-graphite">
            {totalVotesCount} {totalVotesCount === 1 ? 'lượt bình chọn' : 'lượt bình chọn'}
          </span>
          {showResults && hasUserVoted && (
            <>
              <span>•</span>
              <span className="text-meta font-medium">Đã bình chọn</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isPollClosed ? (
            <span className="font-semibold text-[#dc2626] flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Poll closed</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 font-medium text-graphite">
              <Clock className="w-3.5 h-3.5 text-[#94a3b8]" />
              <span>{timeInfo.formatted || 'Đang diễn ra'}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// Aliases for flexibility and easy importing
export const PollCard = PollComponent;
export const Poll = PollComponent;
export default PollComponent;
