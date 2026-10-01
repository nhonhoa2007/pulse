import { Poll, PollChoice, PollVote } from '@prisma/client';
import { PollDto, PollChoiceDto } from '../../contracts/ApiContracts.js';

export type PollWithRelations = Poll & {
  choices: PollChoice[];
  votes?: PollVote[];
};

export function formatPollDto(
  poll: PollWithRelations,
  currentUserId?: string | null
): PollDto {
  const sortedChoices = [...poll.choices].sort((a, b) => a.index - b.index);
  const totalVotes = sortedChoices.reduce((sum, c) => sum + c.voteCount, 0);

  let userVotedChoiceIndex: number | null = null;
  if (currentUserId && poll.votes) {
    const userVote = poll.votes.find((v) => v.userId === currentUserId);
    if (userVote !== undefined) {
      userVotedChoiceIndex = userVote.choiceIndex;
    }
  }

  const choices: PollChoiceDto[] = sortedChoices.map((choice) => {
    const percentage =
      totalVotes > 0
        ? Math.round((choice.voteCount / totalVotes) * 1000) / 10
        : 0;

    return {
      id: choice.id,
      index: choice.index,
      text: choice.text,
      voteCount: choice.voteCount,
      vote_count: choice.voteCount,
      percentage,
    };
  });

  const hasVoted = userVotedChoiceIndex !== null;

  return {
    id: poll.id,
    postId: poll.postId,
    post_id: poll.postId,
    question: poll.question,
    choices,
    totalVotes,
    total_votes: totalVotes,
    createdAt: poll.createdAt.toISOString(),
    created_at: poll.createdAt.toISOString(),
    expiresAt: poll.expiresAt.toISOString(),
    expires_at: poll.expiresAt.toISOString(),
    isActive: poll.isActive,
    is_active: poll.isActive,
    userVotedChoiceIndex,
    user_voted_choice_index: userVotedChoiceIndex,
    userHasVoted: hasVoted,
    user_has_voted: hasVoted,
  };
}
