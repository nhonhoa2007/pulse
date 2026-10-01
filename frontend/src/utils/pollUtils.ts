import type { PollChoiceDto, PollDto } from '../types/PulseTypes';

export interface TimeRemainingResult {
  isExpired: boolean;
  formatted: string;
  totalSecondsRemaining: number;
}

/**
 * Normalizes choice items which might be strings or objects with snake_case / camelCase.
 */
export function normalizePollChoices(
  rawChoices: Array<any>,
  userChoiceIndex?: number | null
): PollChoiceDto[] {
  if (!Array.isArray(rawChoices)) return [];

  return rawChoices.map((choice, index) => {
    if (typeof choice === 'string') {
      return {
        id: `choice-${index}`,
        index,
        text: choice,
        voteCount: 0,
        percentage: 0,
        isUserChoice: userChoiceIndex === index,
      };
    }

    const voteCount = Number(
      choice.voteCount ?? choice.vote_count ?? choice.votes ?? 0
    );

    const isUserChoice = Boolean(
      choice.isUserChoice ??
      choice.is_user_choice ??
      choice.selected ??
      (userChoiceIndex !== undefined && userChoiceIndex !== null && userChoiceIndex === index)
    );

    return {
      id: choice.id || `choice-${index}`,
      index: choice.index !== undefined ? choice.index : index,
      text: choice.text || choice.label || '',
      voteCount: isNaN(voteCount) ? 0 : voteCount,
      percentage: typeof choice.percentage === 'number' ? choice.percentage : 0,
      isUserChoice,
    };
  });
}

/**
 * Calculates total votes and percentage per choice.
 * Handles edge cases:
 * - 0 total votes -> 0% each
 * - Equal votes (e.g. 25%/25%/25%/25% or 50%/50%)
 */
export function computePollPercentages(choices: PollChoiceDto[]): {
  choicesWithPercentages: PollChoiceDto[];
  totalVotes: number;
} {
  const totalVotes = choices.reduce((sum, c) => sum + (c.voteCount || 0), 0);

  if (totalVotes === 0) {
    const choicesWithPercentages = choices.map((c) => ({
      ...c,
      percentage: 0,
    }));
    return { choicesWithPercentages, totalVotes: 0 };
  }

  const choicesWithPercentages = choices.map((c) => {
    const rawPct = (c.voteCount / totalVotes) * 100;
    const rounded = Math.round(rawPct);
    return {
      ...c,
      percentage: rounded,
    };
  });

  return { choicesWithPercentages, totalVotes };
}

/**
 * Calculates countdown time remaining from expires_at timestamp.
 * Accurate to the second.
 * When timer hits zero, returns 'Poll closed' and isExpired: true.
 */
export function computePollTimeRemaining(
  expiresAtInput?: string | number | Date | null
): TimeRemainingResult {
  if (!expiresAtInput) {
    return { isExpired: false, formatted: '', totalSecondsRemaining: 0 };
  }

  const expiryTime = new Date(expiresAtInput).getTime();
  if (isNaN(expiryTime)) {
    return { isExpired: false, formatted: '', totalSecondsRemaining: 0 };
  }

  const now = Date.now();
  const diffMs = expiryTime - now;

  if (diffMs <= 0) {
    return {
      isExpired: true,
      formatted: 'Poll closed',
      totalSecondsRemaining: 0,
    };
  }

  const totalSeconds = Math.round(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let formatted = '';
  if (days > 0) {
    formatted = `${days}d ${hours}h remaining`;
  } else if (hours > 0) {
    formatted = `${hours}h ${minutes}m remaining`;
  } else if (minutes > 0) {
    formatted = `${minutes}m ${seconds}s remaining`;
  } else {
    formatted = `${seconds}s remaining`;
  }

  return {
    isExpired: false,
    formatted,
    totalSecondsRemaining: totalSeconds,
  };
}

/**
 * Normalizes a Poll object supporting both snake_case and camelCase attributes.
 */
export function normalizePollObject(rawPoll: any): PollDto {
  const id = rawPoll.id || '';
  const postId = rawPoll.postId || rawPoll.post_id;
  const question = rawPoll.question || '';
  const expiresAt = rawPoll.expiresAt || rawPoll.expires_at || '';
  const userHasVoted = Boolean(
    rawPoll.userHasVoted ?? rawPoll.user_has_voted ?? false
  );
  const userChoiceIndex =
    rawPoll.userVotedChoiceIndex !== undefined
      ? rawPoll.userVotedChoiceIndex
      : rawPoll.user_voted_choice_index !== undefined
      ? rawPoll.user_voted_choice_index
      : rawPoll.userChoiceIndex !== undefined
      ? rawPoll.userChoiceIndex
      : rawPoll.user_choice_index !== undefined
      ? rawPoll.user_choice_index
      : null;
  const isActive =
    rawPoll.isActive !== undefined
      ? Boolean(rawPoll.isActive)
      : rawPoll.is_active !== undefined
      ? Boolean(rawPoll.is_active)
      : true;

  const rawChoices = rawPoll.choices || [];
  const normalizedChoices = normalizePollChoices(rawChoices, userChoiceIndex);
  const { choicesWithPercentages, totalVotes } = computePollPercentages(
    normalizedChoices
  );

  return {
    id,
    postId,
    post_id: postId,
    question,
    choices: choicesWithPercentages,
    expiresAt,
    expires_at: expiresAt,
    userHasVoted,
    user_has_voted: userHasVoted,
    userChoiceIndex,
    user_choice_index: userChoiceIndex,
    userVotedChoiceIndex: userChoiceIndex,
    user_voted_choice_index: userChoiceIndex,
    isActive,
    is_active: isActive,
    totalVotes: rawPoll.totalVotes ?? rawPoll.total_votes ?? totalVotes,
    total_votes: rawPoll.total_votes ?? rawPoll.totalVotes ?? totalVotes,
    createdAt: rawPoll.createdAt || rawPoll.created_at,
    created_at: rawPoll.created_at || rawPoll.createdAt,
  };
}
